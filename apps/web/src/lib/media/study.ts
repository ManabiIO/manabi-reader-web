/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Cue } from './contracts.js';

export interface StudySpan {
  start: number;
  end: number;
  cues: readonly Cue[];
}

/** Overlapping speakers form one listening unit. Touching turns remain distinct. */
export function studySpans(cues: readonly Cue[], delay = 0): StudySpan[] {
  if (!Number.isFinite(delay)) return [];
  const spans: StudySpan[] = [];
  for (const cue of [...cues].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const start = cue.start + delay,
      end = cue.end + delay;
    if (![start, end].every(Number.isFinite) || end <= 0 || end <= start) continue;
    const previous = spans.at(-1);
    if (previous && start < previous.end) {
      previous.end = Math.max(end, previous.end);
      (previous.cues as Cue[]).push(cue);
    } else spans.push({ start: Math.max(0, start), end, cues: [cue] });
  }
  return spans;
}

/** Last span that started at/before time. -1 before the first span. */
export function spanIndex(spans: readonly StudySpan[], time: number): number {
  if (!Number.isFinite(time)) return -1;
  let lo = 0,
    hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (spans[mid].start <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function seekSpan(
  spans: readonly StudySpan[],
  time: number,
  direction: -1 | 0 | 1
): StudySpan | undefined {
  const index = spanIndex(spans, time);
  if (direction === 1) return spans[index + 1];
  if (direction === 0) return spans[Math.max(0, index)];
  // In a gap, Previous means the line just heard, not the one before it.
  const active = index >= 0 && time < spans[index].end;
  return spans[index < 0 ? -1 : active ? index - 1 : index];
}

/** Boundary detector, independent of frame cadence. Seeking resets the anchor;
 * resuming after an automatic pause cannot immediately pause on the same end.
 * It never seeks backwards, truncates the last syllable, or claims sample accuracy.
 */
export class LinePause {
  private previous?: number;
  private target?: StudySpan;
  held?: StudySpan;
  reset() {
    this.previous = undefined;
    this.target = undefined;
    this.held = undefined;
  }
  sample(time: number, playing: boolean, spans: readonly StudySpan[]): StudySpan | undefined {
    if (!Number.isFinite(time) || !playing) return undefined;
    this.held = undefined;
    if (
      this.previous !== undefined &&
      time >= this.previous &&
      this.target &&
      this.previous < this.target.end &&
      time >= this.target.end
    ) {
      const ended = this.target;
      this.previous = time;
      this.target = undefined;
      this.held = ended;
      return ended;
    }
    const index = spanIndex(spans, time);
    this.target = index >= 0 && time < spans[index].end ? spans[index] : spans[index + 1];
    this.previous = time;
    return undefined;
  }
}
