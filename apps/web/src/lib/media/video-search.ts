/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  validateInfo,
  validatePlayback,
  type ContentKey,
  type Playback,
  type Scope,
  type Track
} from './contracts.js';
import type { Replica } from './replica.js';

export interface VideoTitleHit {
  key: ContentKey;
  title: string;
  duration: number;
  addedAt: number;
}

export interface VideoTranscriptHit {
  key: ContentKey;
  title: string;
  trackId: string;
  trackLabel: string;
  language: string;
  cueId: string;
  time: number;
  end: number;
  text: string;
}

export interface VideoTranscriptBatch {
  hits: VideoTranscriptHit[];
  failed: number;
  truncated: boolean;
  scanned: number;
  total: number;
}

export interface VideoSearchStore {
  records(
    scope: Scope,
    kind: 'video_info' | 'video_resume',
    signal?: AbortSignal
  ): Promise<Replica[]>;
  trackManifests?(scope: Scope, signal?: AbortSignal): Promise<Replica[]>;
  tracks(
    scope: Scope,
    mediaKey: ContentKey,
    signal?: AbortSignal,
    manifestSnapshot?: readonly Replica[]
  ): Promise<Track[]>;
}

const foldSearch = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\u03c2/g, '\u03c3');

const boundaryBefore = (value: string, index: number) =>
  index > 0 && /[\s\p{P}\p{S}]/u.test(Array.from(value.slice(0, index)).at(-1) ?? '');

interface SearchMatchKey {
  tier: number;
  index: number;
  length: number;
  folded: string;
}

function matchKey(value: string, needle: string): SearchMatchKey {
  const folded = foldSearch(value);
  const index = folded.indexOf(needle);
  return {
    tier:
      index < 0
        ? 4
        : folded === needle
          ? 0
          : index === 0
            ? 1
            : boundaryBefore(folded, index)
              ? 2
              : 3,
    index: index < 0 ? Number.MAX_SAFE_INTEGER : index,
    length: Array.from(folded).length,
    folded
  };
}

const compareStableText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function compareKeys(a: SearchMatchKey, b: SearchMatchKey): number {
  return (
    a.tier - b.tier ||
    a.index - b.index ||
    a.length - b.length ||
    compareStableText(a.folded, b.folded)
  );
}

const MAX_TITLE_RESULTS = 300;
const MAX_TRANSCRIPT_RESULTS = 300;
const MAX_MATCHES_PER_VIDEO = 24;
const MAX_EXCERPT_CODEPOINTS = 360;

const aborted = (error: unknown, signal: AbortSignal) =>
  signal.aborted || (error instanceof DOMException && error.name === 'AbortError');

function clip(text: string): string {
  const points = Array.from(text);
  return points.length <= MAX_EXCERPT_CODEPOINTS
    ? text
    : `${points.slice(0, MAX_EXCERPT_CODEPOINTS - 1).join('')}…`;
}

function videoInfoRows(rows: Replica[]): VideoTitleHit[] {
  return rows.flatMap((row) => {
    if (row.kind !== 'video_info' || row.payload === null || row.id !== row.mediaKey) return [];
    try {
      const info = validateInfo(row.payload);
      return [
        {
          key: row.mediaKey,
          title: info.title,
          duration: info.duration,
          addedAt: info.addedAt
        }
      ];
    } catch {
      return [];
    }
  });
}

function playbackRows(rows: Replica[]): Map<ContentKey, Playback> {
  const output = new Map<ContentKey, Playback>();
  for (const row of rows) {
    if (row.kind !== 'video_resume' || row.payload === null || row.id !== row.mediaKey) continue;
    try {
      const state = validatePlayback(row.payload);
      if (state.mediaKey === row.mediaKey) output.set(row.mediaKey, state);
    } catch {
      // One invalid resume record must not make saved transcript text unsearchable.
    }
  }
  return output;
}

function trackOrder(a: Track, b: Track): number {
  const kind = Number(a.kind === 'translation') - Number(b.kind === 'translation');
  if (kind) return kind;
  const origin = (value: Track['origin']) =>
    value === 'sidecar' ? 0 : value === 'embedded' ? 1 : 2;
  return (
    origin(a.origin) - origin(b.origin) || b.createdAt - a.createdAt || a.id.localeCompare(b.id)
  );
}

export async function searchVideoTitles(
  store: VideoSearchStore,
  scope: Scope,
  query: string,
  signal: AbortSignal
): Promise<{ hits: VideoTitleHit[]; truncated: boolean }> {
  signal.throwIfAborted();
  const needle = foldSearch(query.trim());
  if (!needle) return { hits: [], truncated: false };
  const rows = await store.records(scope, 'video_info', signal);
  signal.throwIfAborted();
  const matches = videoInfoRows(rows)
    .map((item, order) => ({ item, order, key: matchKey(item.title, needle) }))
    .filter(({ key }) => key.tier < 4)
    .sort(
      (a, b) =>
        compareKeys(a.key, b.key) ||
        compareStableText(a.item.key, b.item.key) ||
        a.order - b.order
    )
    .map(({ item }) => item);
  return {
    hits: matches.slice(0, MAX_TITLE_RESULTS),
    truncated: matches.length > MAX_TITLE_RESULTS
  };
}

/**
 * Searches only already-published transcript tracks. It never resolves video
 * sources, downloads cloud media, starts transcription, or mutates playback.
 */
export async function searchVideoTranscripts(
  store: VideoSearchStore,
  scope: Scope,
  query: string,
  signal: AbortSignal,
  receive?: (batch: VideoTranscriptBatch) => void
): Promise<VideoTranscriptBatch> {
  signal.throwIfAborted();
  const needle = foldSearch(query.trim());
  if (!needle) return { hits: [], failed: 0, truncated: false, scanned: 0, total: 0 };

  const [metadataRows, resumeRows, manifestSnapshot] = await Promise.all([
    store.records(scope, 'video_info', signal),
    store.records(scope, 'video_resume', signal),
    store.trackManifests ? store.trackManifests(scope, signal) : Promise.resolve(undefined)
  ]);
  signal.throwIfAborted();

  const videos = videoInfoRows(metadataRows).sort(
    (a, b) => b.addedAt - a.addedAt || a.title.localeCompare(b.title) || a.key.localeCompare(b.key)
  );
  const playback = playbackRows(resumeRows);
  const manifestsByVideo = new Map<ContentKey, Replica[]>();
  if (manifestSnapshot)
    for (const manifest of manifestSnapshot) {
      const current = manifestsByVideo.get(manifest.mediaKey);
      if (current) current.push(manifest);
      else manifestsByVideo.set(manifest.mediaKey, [manifest]);
    }
  const hits: VideoTranscriptHit[] = [];
  let failed = 0;
  let truncated = false;
  let scanned = 0;

  const publish = () => {
    signal.throwIfAborted();
    receive?.({
      hits: [...hits],
      failed,
      truncated,
      scanned,
      total: videos.length
    });
  };

  for (const video of videos) {
    signal.throwIfAborted();
    const videoManifests = manifestSnapshot ? manifestsByVideo.get(video.key) : undefined;
    if (manifestSnapshot && !videoManifests?.length) {
      scanned++;
      publish();
      continue;
    }
    let tracks: Track[];
    try {
      tracks = await store.tracks(scope, video.key, signal, videoManifests);
    } catch (error) {
      if (aborted(error, signal)) throw error;
      failed++;
      scanned++;
      publish();
      continue;
    }
    signal.throwIfAborted();

    let matchesForVideo = 0;
    const seen = new Set<string>();
    for (const track of [...tracks].filter((item) => item.complete).sort(trackOrder)) {
      const delay = playback.get(video.key)?.delays[track.id] ?? 0;
      for (const cue of track.cues) {
        const foldedText = foldSearch(cue.text);
        if (!foldedText.includes(needle)) continue;
        const identity = `${cue.start}\u0000${cue.end}\u0000${foldedText}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        if (matchesForVideo >= MAX_MATCHES_PER_VIDEO) {
          truncated = true;
          continue;
        }
        if (hits.length >= MAX_TRANSCRIPT_RESULTS) {
          truncated = true;
          break;
        }
        matchesForVideo++;
        hits.push({
          key: video.key,
          title: video.title,
          trackId: track.id,
          trackLabel: track.label,
          language: track.language,
          cueId: cue.id,
          time: Math.max(0, cue.start + delay),
          end: Math.max(0, cue.end + delay),
          text: clip(cue.text)
        });
      }
      if (hits.length >= MAX_TRANSCRIPT_RESULTS) break;
    }
    scanned++;
    publish();
    if (hits.length >= MAX_TRANSCRIPT_RESULTS) break;
  }

  if (scanned < videos.length) truncated = true;
  const result = { hits, failed, truncated, scanned, total: videos.length };
  receive?.({ ...result, hits: [...hits] });
  return result;
}

export function mediaScope(userId: string | null): Scope {
  return userId ? `account:${userId}` : 'guest';
}
