/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  finite,
  isContentKey,
  isDigest,
  isUUID,
  language,
  LIMITS,
  onlyKeys,
  validateCue,
  record,
  string,
  type ContentKey,
  type Cue
} from './contracts.js';
import { digestText } from './hash.js';

export const WORD_ALIGNMENT_REVISION = 'qwen3-packed-v2';
export const DEFAULT_ALIGNMENT_PADDING_SECONDS = 1.25;
export const DEFAULT_ALIGNMENT_BRIDGE_SECONDS = 1.5;
export const DEFAULT_ALIGNMENT_MAX_BATCH_SECONDS = 180;
export const DEFAULT_ALIGNMENT_MAX_BATCH_CUES = 512;
export const ALIGNMENT_SAMPLE_RATE = 16_000;

export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export interface AlignmentSourceSegment {
  cueId: string;
  mediaStart: number;
  mediaEnd: number;
  packedStart: number;
  packedEnd: number;
}

export interface AlignmentBatchPlan {
  id: string;
  mediaStart: number;
  mediaEnd: number;
  packedDuration: number;
  cues: Cue[];
  segments: AlignmentSourceSegment[];
}

export interface AlignmentBatchResult {
  batchId: string;
  words: WordTiming[];
  completedAt: number;
}

export interface WordAlignmentJob {
  version: 2;
  revision: number;
  plannedBatchIds: string[];
  id: string;
  mediaKey: ContentKey;
  trackId: string;
  trackDigest: string;
  audioTrack: string;
  language: string;
  engine: 'qwen3-forced-aligner';
  engineRevision: string;
  model: string;
  modelRevision: string;
  modelSha256: string;
  status: 'queued' | 'running' | 'paused' | 'complete' | 'failed';
  createdAt: number;
  updatedAt: number;
  completedBatchIds: string[];
  results: AlignmentBatchResult[];
  error?: string;
}

export interface PlanOptions {
  paddingSeconds?: number;
  bridgeSeconds?: number;
  maximumBatchSeconds?: number;
  maximumBatchCues?: number;
  mediaDuration?: number;
}

export const ALIGNMENT_LIMITS = {
  batches: 50000,
  wordsPerBatch: 16000,
  wordsPerJob: 200000,
  jobBytes: 16 * 1024 * 1024
} as const;

const utf8 = new TextEncoder();
const jsonBytes = (value: unknown) => utf8.encode(JSON.stringify(value)).byteLength;
const sampleTime = (sample: number) => sample / ALIGNMENT_SAMPLE_RATE;

/**
 * Plan bounded per-cue contexts; this is not a qualified packed-inference runtime.
 * Durations are accumulated as integer samples. Padded contexts deliberately remain
 * separate: merging them requires a different transcript/aligner context contract.
 */
export function planWordAlignmentBatches(
  cues: readonly Cue[],
  options: PlanOptions = {}
): AlignmentBatchPlan[] {
  if (!Array.isArray(cues) || cues.length > LIMITS.cues)
    throw new Error('Invalid alignment cue count');
  const padding = finite(options.paddingSeconds ?? DEFAULT_ALIGNMENT_PADDING_SECONDS, 0, 5);
  const bridge = finite(options.bridgeSeconds ?? DEFAULT_ALIGNMENT_BRIDGE_SECONDS, 0, 30);
  const maximum = finite(
    options.maximumBatchSeconds ?? DEFAULT_ALIGNMENT_MAX_BATCH_SECONDS,
    1,
    180
  );
  const maximumSamples = Math.floor(maximum * ALIGNMENT_SAMPLE_RATE);
  const bridgeSamples = Math.floor(bridge * ALIGNMENT_SAMPLE_RATE);
  const maximumCues = options.maximumBatchCues ?? DEFAULT_ALIGNMENT_MAX_BATCH_CUES;
  if (!Number.isSafeInteger(maximumCues) || maximumCues < 1 || maximumCues > 512)
    throw new Error('Invalid alignment cue limit');
  const duration = finite(options.mediaDuration ?? LIMITS.duration, 0, LIMITS.duration);
  const durationSamples = Math.floor(duration * ALIGNMENT_SAMPLE_RATE);
  const seen = new Set<string>();
  let transcriptBytes = 2;
  // Validate BEFORE padding; padding must not repair a reversed/negative cue.
  // Array.from also visits holes. Snapshot text and identity before exposing plans.
  const ordered = Array.from(cues, (raw, order) => {
    const cue = validateCue(raw);
    if (!cue.text.trim() || cue.end > duration || seen.has(cue.id))
      throw new Error('Invalid, outside-media or duplicate alignment cue');
    seen.add(cue.id);
    const start = Math.max(0, Math.floor((cue.start - padding) * ALIGNMENT_SAMPLE_RATE));
    const end = Math.min(durationSamples, Math.ceil((cue.end + padding) * ALIGNMENT_SAMPLE_RATE));
    if (end <= start) throw new Error('Invalid alignment cue window');
    if (end - start > maximumSamples) throw new Error('One alignment cue exceeds the batch limit');
    const entry = { cue, order, start, end };
    transcriptBytes += jsonBytes(entry) + 1;
    if (transcriptBytes > LIMITS.trackBytes)
      throw new Error('Alignment transcript exceeds the byte limit');
    return entry;
  }).sort((a, b) => a.start - b.start || a.cue.start - b.cue.start || a.order - b.order);

  const batches: AlignmentBatchPlan[] = [];
  let entries: typeof ordered = [];
  let mediaStart = 0,
    mediaEnd = 0,
    packedSamples = 0;
  const flush = () => {
    if (!entries.length) return;
    let at = 0;
    const segments = entries.map(({ cue, start, end }) => {
      const packedStart = at;
      at += end - start;
      return {
        cueId: cue.id,
        mediaStart: sampleTime(start),
        mediaEnd: sampleTime(end),
        packedStart: sampleTime(packedStart),
        packedEnd: sampleTime(at)
      };
    });
    const batchCues = entries.map(({ cue }) => cue);
    // Delimiter-based first/last IDs collide and omit text, ranges and middle cues.
    const id = digestText(
      JSON.stringify([
        WORD_ALIGNMENT_REVISION,
        ALIGNMENT_SAMPLE_RATE,
        padding,
        bridge,
        maximumSamples,
        maximumCues,
        durationSamples,
        entries.map(({ cue, start, end }) => [
          cue.id,
          cue.start,
          cue.end,
          cue.text,
          cue.speaker ?? null,
          start,
          end
        ])
      ])
    );
    batches.push({
      id,
      mediaStart: sampleTime(mediaStart),
      mediaEnd: sampleTime(mediaEnd),
      packedDuration: sampleTime(at),
      cues: batchCues,
      segments
    });
    entries = [];
    packedSamples = 0;
  };
  for (const entry of ordered) {
    const nextEnd = Math.max(mediaEnd, entry.end);
    if (
      entries.length &&
      (entry.start > mediaEnd + bridgeSamples ||
        nextEnd - mediaStart > maximumSamples ||
        packedSamples + entry.end - entry.start > maximumSamples ||
        entries.length >= maximumCues)
    )
      flush();
    if (!entries.length) {
      mediaStart = entry.start;
      mediaEnd = entry.end;
    } else mediaEnd = nextEnd;
    entries.push(entry);
    packedSamples += entry.end - entry.start;
  }
  flush();
  return batches;
}

export function validateWordTiming(value: unknown): WordTiming {
  const word = record(value);
  onlyKeys(word, ['text', 'start', 'end']);
  const start = finite(word.start, 0, LIMITS.duration);
  const end = finite(word.end, 0, LIMITS.duration);
  const text = string(word.text, 1024);
  if (end <= start || !text.trim()) throw new Error('Invalid word timing');
  return { text, start, end };
}

export function validateAlignmentBatchResult(value: unknown): AlignmentBatchResult {
  const result = record(value);
  onlyKeys(result, ['batchId', 'words', 'completedAt']);
  if (
    !isDigest(result.batchId) ||
    !Array.isArray(result.words) ||
    !result.words.length ||
    result.words.length > ALIGNMENT_LIMITS.wordsPerBatch
  )
    throw new Error('Invalid alignment batch result');
  let bytes = 256;
  const words = Array.from(result.words, (raw) => {
    const word = validateWordTiming(raw);
    bytes += jsonBytes(word) + 1;
    if (bytes > ALIGNMENT_LIMITS.jobBytes)
      throw new Error('Alignment result exceeds the byte limit');
    return word;
  });
  return {
    batchId: result.batchId,
    words,
    completedAt: finite(result.completedAt, 0, Number.MAX_SAFE_INTEGER)
  };
}

export function validateWordAlignmentJob(value: unknown): WordAlignmentJob {
  const job = record(value);
  onlyKeys(job, [
    'version',
    'revision',
    'plannedBatchIds',
    'id',
    'mediaKey',
    'trackId',
    'trackDigest',
    'audioTrack',
    'language',
    'engine',
    'engineRevision',
    'model',
    'modelRevision',
    'modelSha256',
    'status',
    'createdAt',
    'updatedAt',
    'completedBatchIds',
    'results',
    'error'
  ]);
  if (
    job.version !== 2 ||
    !Number.isSafeInteger(job.revision) ||
    (job.revision as number) < 0 ||
    !isUUID(job.id) ||
    !isContentKey(job.mediaKey) ||
    !isUUID(job.trackId) ||
    !isDigest(job.trackDigest) ||
    !isDigest(job.modelSha256) ||
    job.engine !== 'qwen3-forced-aligner' ||
    typeof job.status !== 'string' ||
    !['queued', 'running', 'paused', 'complete', 'failed'].includes(job.status) ||
    typeof job.modelRevision !== 'string' ||
    !/^[a-f0-9]{40}$/.test(job.modelRevision) ||
    !Array.isArray(job.plannedBatchIds) ||
    !job.plannedBatchIds.length ||
    job.plannedBatchIds.length > ALIGNMENT_LIMITS.batches ||
    !Array.isArray(job.completedBatchIds) ||
    !Array.isArray(job.results) ||
    job.completedBatchIds.length > job.plannedBatchIds.length ||
    job.results.length > job.plannedBatchIds.length
  )
    throw new Error('Invalid word-alignment job');
  const ids = (values: unknown[]): string[] =>
    Array.from(values, (id) => {
      if (!isDigest(id)) throw new Error('Invalid alignment batch identity');
      return id;
    });
  const plannedBatchIds = ids(job.plannedBatchIds);
  const planned = new Set(plannedBatchIds);
  if (planned.size !== plannedBatchIds.length) throw new Error('Duplicate planned alignment batch');
  const completedBatchIds = ids(job.completedBatchIds);
  const completed = new Set(completedBatchIds);
  if (completed.size !== completedBatchIds.length)
    throw new Error('Duplicate completed alignment batch');
  let count = 0;
  let resultBytes = 0;
  const results = Array.from(job.results, (raw) => {
    const candidate = record(raw);
    if (
      !Array.isArray(candidate.words) ||
      (count += candidate.words.length) > ALIGNMENT_LIMITS.wordsPerJob
    )
      throw new Error('Alignment word count exceeds the limit');
    const result = validateAlignmentBatchResult(candidate);
    resultBytes += jsonBytes(result) + 1;
    if (resultBytes > ALIGNMENT_LIMITS.jobBytes)
      throw new Error('Alignment job exceeds the byte limit');
    return result;
  });
  if (new Set(results.map((item) => item.batchId)).size !== results.length)
    throw new Error('Duplicate alignment result');
  if (results.length !== completed.size || results.some((item) => !completed.has(item.batchId)))
    throw new Error('Completed alignment batches must match durable results');
  if (completedBatchIds.some((id) => !planned.has(id)))
    throw new Error('Alignment result is not in the frozen plan');
  if (job.status === 'complete' && completed.size !== planned.size)
    throw new Error('Alignment cannot complete with missing batches');
  const createdAt = finite(job.createdAt, 0, Number.MAX_SAFE_INTEGER);
  const updatedAt = finite(job.updatedAt, createdAt, Number.MAX_SAFE_INTEGER);
  const result: WordAlignmentJob = {
    version: 2,
    revision: job.revision as number,
    plannedBatchIds,
    id: job.id,
    mediaKey: job.mediaKey,
    trackId: job.trackId,
    trackDigest: job.trackDigest,
    audioTrack: string(job.audioTrack, 128),
    language: language(job.language),
    engine: 'qwen3-forced-aligner',
    engineRevision: string(job.engineRevision, 128),
    model: string(job.model, 256),
    modelRevision: job.modelRevision,
    modelSha256: job.modelSha256,
    status: job.status as WordAlignmentJob['status'],
    createdAt,
    updatedAt,
    completedBatchIds,
    results,
    ...(job.error === undefined ? {} : { error: string(job.error, 2048) })
  };
  if (jsonBytes(result) > ALIGNMENT_LIMITS.jobBytes)
    throw new Error('Alignment job exceeds the byte limit');
  return result;
}

/** Compare immutable inputs, not merely the database key. */
export function alignmentJobIdentity(job: WordAlignmentJob): string {
  return JSON.stringify([
    job.id,
    job.mediaKey,
    job.trackId,
    job.trackDigest,
    job.audioTrack,
    job.language,
    job.engine,
    job.engineRevision,
    job.model,
    job.modelRevision,
    job.modelSha256,
    job.createdAt,
    job.plannedBatchIds
  ]);
}

/**
 * Validate the entire edit map before mapping any output. Equal source/packed
 * lengths and contiguous, nonoverlapping packed sample intervals are mandatory.
 * Rounded public seconds encode integer sample boundaries; model times stay precise.
 */
export function mapPackedWordsToMedia(
  words: readonly WordTiming[],
  segments: readonly AlignmentSourceSegment[]
): WordTiming[] {
  if (
    !Array.isArray(words) ||
    words.length > ALIGNMENT_LIMITS.wordsPerBatch ||
    !Array.isArray(segments) ||
    segments.length > 512
  )
    throw new Error('Invalid packed alignment size');
  const sample = (value: unknown) => {
    const scaled = finite(value, 0, LIMITS.duration) * ALIGNMENT_SAMPLE_RATE;
    const rounded = Math.round(scaled);
    if (Math.abs(rounded - scaled) > 0.0001) throw new Error('Map boundary is not sample-aligned');
    return rounded;
  };
  let previousEnd = 0;
  const ids = new Set<string>();
  const map = Array.from(segments, (raw) => {
    const segment = record(raw);
    onlyKeys(segment, ['cueId', 'mediaStart', 'mediaEnd', 'packedStart', 'packedEnd']);
    const id = string(segment.cueId, 160);
    const mediaStart = sample(segment.mediaStart),
      mediaEnd = sample(segment.mediaEnd);
    const start = sample(segment.packedStart),
      end = sample(segment.packedEnd);
    if (
      ids.has(id) ||
      start !== previousEnd ||
      end <= start ||
      mediaEnd - mediaStart !== end - start ||
      end > 180 * ALIGNMENT_SAMPLE_RATE
    )
      throw new Error('Invalid packed-audio mapping');
    ids.add(id);
    previousEnd = end;
    return { mediaStart, start, end };
  });
  const mapped: WordTiming[] = [];
  let previousStart = -1;
  for (const raw of words) {
    const word = validateWordTiming(raw);
    if (word.start < previousStart) throw new Error('Packed words are out of order');
    previousStart = word.start;
    // Binary search avoids one complete segment scan per returned word.
    let low = 0,
      high = map.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (sampleTime(map[mid].end) <= word.start) low = mid + 1;
      else high = mid;
    }
    const owner = map[low];
    if (!owner || word.start < sampleTime(owner.start) || word.end > sampleTime(owner.end))
      throw new Error('Alignment word crosses a packed-audio splice');
    const offset = sampleTime(owner.mediaStart - owner.start);
    mapped.push({ text: word.text, start: word.start + offset, end: word.end + offset });
  }
  return mapped;
}

/** Smooth visual fill inside an acoustically measured word interval. */
export function karaokeWordProgress(word: WordTiming, mediaTime: number): number {
  if (!Number.isFinite(mediaTime)) return 0;
  if (mediaTime <= word.start) return 0;
  if (mediaTime >= word.end) return 1;
  return (mediaTime - word.start) / (word.end - word.start);
}

/**
 * Reprioritize unfinished batches around the playhead. The near-future window
 * wins first, then earlier unfinished work, then distant future work.
 */
export function prioritizeAlignmentBatches(
  batches: readonly AlignmentBatchPlan[],
  completed: ReadonlySet<string>,
  playhead: number,
  lookAheadSeconds = 120
): AlignmentBatchPlan[] {
  const now = Number.isFinite(playhead) ? Math.max(0, playhead) : 0;
  const horizon = now + finite(lookAheadSeconds, 1, LIMITS.duration);
  const score = (batch: AlignmentBatchPlan) => {
    if (batch.mediaEnd >= now && batch.mediaStart <= horizon)
      return [0, Math.abs(batch.mediaStart - now)];
    if (batch.mediaEnd < now) return [1, now - batch.mediaEnd];
    return [2, batch.mediaStart - horizon];
  };
  return batches
    .filter((batch) => !completed.has(batch.id))
    .sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      return sa[0] - sb[0] || sa[1] - sb[1] || a.mediaStart - b.mediaStart;
    });
}
