/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { cueDigest } from './captions.js';
import type { ContentKey, Track } from './contracts.js';

type Metadata = Pick<Track, 'origin' | 'kind' | 'language' | 'forced' | 'complete'>;

/** Labels and filenames are presentation, not authored-caption identity. Keep
 * publication deduplication and temporary-player handoff on the same contract.
 */
export function authoredTrackIdentity(track: Metadata, digest: string): string | undefined {
  if (!track.complete || (track.origin !== 'embedded' && track.origin !== 'sidecar'))
    return undefined;
  return JSON.stringify([track.origin, track.kind, track.language, track.forced, digest]);
}

/** Only a unique equivalent saved version (or the exact already-saved ID) can
 * inherit a temporary selection. Foreign media and incomplete/generated tracks
 * never acquire it. Existing ambiguous duplicates remain available for choice.
 */
export function temporaryTrackReplacements(
  temporary: readonly Track[],
  published: readonly Track[],
  verifiedKey?: ContentKey
): Map<string, string> {
  const replacements = new Map<string, string>();
  if (!verifiedKey || !temporary.length) return replacements;
  const candidates = new Map<string, Track[]>();
  for (const track of published) {
    if (track.mediaKey !== verifiedKey) continue;
    const identity = authoredTrackIdentity(track, cueDigest(track.cues));
    if (identity !== undefined) {
      const group = candidates.get(identity) ?? [];
      group.push(track);
      candidates.set(identity, group);
    }
  }
  for (const track of temporary) {
    const identity = authoredTrackIdentity(track, cueDigest(track.cues));
    const matches = identity === undefined ? [] : (candidates.get(identity) ?? []);
    const selected =
      matches.find((candidate) => candidate.id === track.id) ??
      (matches.length === 1 ? matches[0] : undefined);
    if (selected) replacements.set(track.id, selected.id);
  }
  return replacements;
}
