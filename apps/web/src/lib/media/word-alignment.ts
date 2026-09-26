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
  record,
  string,
  type ContentKey,
  type Cue
} from './contracts.js';

export const WORD_ALIGNMENT_REVISION = 'qwen3-packed-v1';
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
  version: 1;
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
}

const roundSample = (seconds: number) =>
  Math.round(seconds * ALIGNMENT_SAMPLE_RATE) / ALIGNMENT_SAMPLE_RATE;

function cueWindow(cue: Cue, padding: number) {
  return {
    start: Math.max(0, roundSample(cue.start - padding)),
    end: roundSample(cue.end + padding)
  };
}

/**
 * Plan sparse forced-alignment work from the already-known MOSS cue envelope.
 * Nearby cues are packed together; long silent gaps are intentionally omitted.
 * The packed timeline is an implementation detail. Every segment retains an
 * exact mapping back to media time, which is the only timeline we persist.
 */
export function planWordAlignmentBatches(
  cues: readonly Cue[],
  options: PlanOptions = {}
): AlignmentBatchPlan[] {
  const padding = finite(options.paddingSeconds ?? DEFAULT_ALIGNMENT_PADDING_SECONDS, 0, 5);
  const bridge = finite(options.bridgeSeconds ?? DEFAULT_ALIGNMENT_BRIDGE_SECONDS, 0, 30);
  const maximum = finite(
    options.maximumBatchSeconds ?? DEFAULT_ALIGNMENT_MAX_BATCH_SECONDS,
    1,
    600
  );
  const maximumCues = options.maximumBatchCues ?? DEFAULT_ALIGNMENT_MAX_BATCH_CUES;
  if (!Number.isSafeInteger(maximumCues) || maximumCues < 1 || maximumCues > 5000)
    throw new Error('Invalid alignment cue limit');

  const ordered = [...cues]
    .map((cue) => ({ cue, window: cueWindow(cue, padding) }))
    .sort(
      (a, b) =>
        a.window.start - b.window.start ||
        a.cue.start - b.cue.start ||
        a.cue.id.localeCompare(b.cue.id)
    );
  const seen = new Set<string>();
  const batches: AlignmentBatchPlan[] = [];

  let current:
    | { mediaStart: number; mediaEnd: number; packedDuration: number; cues: Cue[] }
    | undefined;
  const flush = () => {
    if (!current) return;
    let packed = 0;
    const segments: AlignmentSourceSegment[] = [];
    for (const cue of current.cues) {
      const window = cueWindow(cue, padding);
      const length = window.end - window.start;
      segments.push({
        cueId: cue.id,
        mediaStart: window.start,
        mediaEnd: window.end,
        packedStart: packed,
        packedEnd: packed + length
      });
      packed += length;
    }
    const id = `${current.cues[0].id}..${current.cues[current.cues.length - 1].id}`;
    batches.push({
      id,
      mediaStart: current.mediaStart,
      mediaEnd: current.mediaEnd,
      packedDuration: packed,
      cues: current.cues,
      segments
    });
    current = undefined;
  };

  for (const entry of ordered) {
    if (seen.has(entry.cue.id)) throw new Error('Duplicate cue identity');
    seen.add(entry.cue.id);
    if (!(entry.window.end > entry.window.start)) throw new Error('Invalid alignment cue window');
    if (entry.window.end - entry.window.start > maximum)
      throw new Error('One alignment cue exceeds the batch limit');

    if (!current) {
      current = {
        mediaStart: entry.window.start,
        mediaEnd: entry.window.end,
        packedDuration: entry.window.end - entry.window.start,
        cues: [entry.cue]
      };
      continue;
    }
    const candidateEnd = Math.max(current.mediaEnd, entry.window.end);
    // Overlapping padded windows are packed separately and consume inference
    // time even when the source-media envelope does not grow.
    const candidatePackedDuration =
      current.packedDuration + (entry.window.end - entry.window.start);
    const closeEnough = entry.window.start <= current.mediaEnd + bridge;
    if (
      !closeEnough ||
      candidateEnd - current.mediaStart > maximum ||
      candidatePackedDuration > maximum ||
      current.cues.length >= maximumCues
    ) {
      flush();
      current = {
        mediaStart: entry.window.start,
        mediaEnd: entry.window.end,
        packedDuration: entry.window.end - entry.window.start,
        cues: [entry.cue]
      };
    } else {
      current.mediaEnd = candidateEnd;
      current.packedDuration = candidatePackedDuration;
      current.cues.push(entry.cue);
    }
  }
  flush();
  return batches;
}

export function validateWordTiming(value: unknown): WordTiming {
  const word = record(value);
  const start = finite(word.start, 0, 604800);
  const end = finite(word.end, 0, 604800);
  if (end <= start) throw new Error('Word timing must end after it starts');
  return { text: string(word.text, 1024), start, end };
}

export function validateWordAlignmentJob(value: unknown): WordAlignmentJob {
  const job = record(value);
  if (
    job.version !== 1 ||
    !isUUID(job.id) ||
    !isContentKey(job.mediaKey) ||
    !isUUID(job.trackId) ||
    !isDigest(job.trackDigest) ||
    !isDigest(job.modelSha256) ||
    job.engine !== 'qwen3-forced-aligner' ||
    !['queued', 'running', 'paused', 'complete', 'failed'].includes(String(job.status)) ||
    !Array.isArray(job.completedBatchIds) ||
    !Array.isArray(job.results)
  )
    throw new Error('Invalid word-alignment job');
  const completedBatchIds = job.completedBatchIds.map((id) => string(id, 320));
  if (new Set(completedBatchIds).size !== completedBatchIds.length)
    throw new Error('Duplicate completed alignment batch');
  const results = job.results.map((item) => {
    const result = record(item);
    if (!Array.isArray(result.words)) throw new Error('Invalid aligned words');
    return {
      batchId: string(result.batchId, 320),
      words: result.words.map(validateWordTiming),
      completedAt: finite(result.completedAt, 0, Number.MAX_SAFE_INTEGER)
    };
  });
  if (new Set(results.map((item) => item.batchId)).size !== results.length)
    throw new Error('Duplicate alignment result');
  return {
    version: 1,
    id: job.id as string,
    mediaKey: job.mediaKey as ContentKey,
    trackId: job.trackId as string,
    trackDigest: job.trackDigest as string,
    audioTrack: string(job.audioTrack, 128),
    language: language(job.language),
    engine: 'qwen3-forced-aligner',
    engineRevision: string(job.engineRevision, 128),
    model: string(job.model, 256),
    modelRevision: string(job.modelRevision, 128),
    modelSha256: job.modelSha256 as string,
    status: job.status as WordAlignmentJob['status'],
    createdAt: finite(job.createdAt, 0, Number.MAX_SAFE_INTEGER),
    updatedAt: finite(job.updatedAt, 0, Number.MAX_SAFE_INTEGER),
    completedBatchIds,
    results,
    ...(job.error === undefined ? {} : { error: string(job.error, 2048) })
  };
}

/**
 * Map aligner output from packed speech time back to the source movie. Results
 * that touch a synthetic splice are rejected; never interpolate across silence
 * or claim timing the model did not observe continuously.
 */
export function mapPackedWordsToMedia(
  words: readonly WordTiming[],
  segments: readonly AlignmentSourceSegment[]
): WordTiming[] {
  const mapped: WordTiming[] = [];
  for (const raw of words) {
    const word = validateWordTiming(raw);
    const owner = segments.find(
      (segment) => word.start >= segment.packedStart - 1e-6 && word.end <= segment.packedEnd + 1e-6
    );
    if (!owner) throw new Error('Alignment word crosses a packed-audio splice');
    const start = owner.mediaStart + (word.start - owner.packedStart);
    const end = owner.mediaStart + (word.end - owner.packedStart);
    if (start < owner.mediaStart - 1e-6 || end > owner.mediaEnd + 1e-6 || end <= start)
      throw new Error('Mapped word falls outside its source interval');
    mapped.push({ text: word.text, start, end });
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
  const horizon = now + Math.max(1, lookAheadSeconds);
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
