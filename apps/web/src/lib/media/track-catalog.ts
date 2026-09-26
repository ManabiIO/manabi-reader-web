/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { CueTimeline } from './captions.js';
import type { Cue, Track } from './contracts.js';

type Entry = { timeline: CueTimeline; display: string };
const sameCue = (a: Cue, b: Cue) =>
  a.id === b.id &&
  a.start === b.start &&
  a.end === b.end &&
  a.text === b.text &&
  a.speaker === b.speaker;

/** Keep listening state tied to cue content, not IndexedDB object identity.
 * Refreshes often return new objects for unchanged transcripts. Replacing their
 * timelines would discard auto-pause boundaries and the currently held line.
 */
export class TrackCatalog {
  private entries = new Map<string, Entry>();

  timeline(id: string): CueTimeline | undefined {
    return this.entries.get(id)?.timeline;
  }

  replace(tracks: readonly Track[]): boolean {
    const next = new Map<string, Entry>();
    const oldIds = [...this.entries.keys()];
    let changed = tracks.length !== oldIds.length;
    for (const [index, track] of tracks.entries()) {
      if (next.has(track.id)) throw new Error('Duplicate subtitle track identity');
      const old = this.entries.get(track.id);
      // Stable sorting preserves A/B/A order when starts are equal.
      const cues = [...track.cues].sort((a, b) => a.start - b.start);
      const same =
        old &&
        cues.length === old.timeline.cues.length &&
        cues.every((cue, i) => sameCue(cue, old.timeline.cues[i]));
      // Detach primitive cue records: a caller mutating its input cannot silently
      // mutate the old comparison baseline or an active listening unit.
      const timeline = same ? old.timeline : new CueTimeline(cues.map((cue) => ({ ...cue })));
      const display = JSON.stringify([
        track.label,
        track.language,
        track.complete,
        track.forced,
        track.derivedFrom?.trackId,
        track.derivedFrom?.digest
      ]);
      if (oldIds[index] !== track.id || !old || !same || display !== old.display) changed = true;
      next.set(track.id, { timeline, display });
    }
    // A malformed replacement cannot partially mutate the current catalog.
    this.entries = next;
    return changed;
  }
}
