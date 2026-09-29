/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Cue } from './contracts.js';
import { joinBoundary } from './moss-progressive.js';
import {
  sparseBounds,
  joinSparseBoundary,
  SPARSE_CONTEXT_SECONDS,
  SPARSE_CORE_SECONDS,
  type SparseState
} from './sparse-transcription.js';

/** Read-only compatibility for the old derived draft cache. Original hypotheses
 * remain authoritative; only an exact old projection may be upgraded on reload.
 */
export function legacySparseCues(
  state: SparseState,
  duration: number,
  suppressConflictingInterior = true,
  sharedHalo = false
): Cue[] {
  const join = sharedHalo ? joinSparseBoundary : joinBoundary;
  const interior = state.windows.flatMap((window, index) => {
    if (!window || state.repairs[index] || state.repairs[index - 1]) return [];
    if (
      suppressConflictingInterior &&
      index > 0 &&
      state.windows[index - 1] &&
      !join(
        state.windows[index - 1]!.cues.slice(-16),
        window.cues.slice(0, 16),
        index * SPARSE_CORE_SECONDS
      )
    )
      return [];
    const bounds = sparseBounds(index, duration);
    const left = index === 0 ? 0 : bounds.coreStart + SPARSE_CONTEXT_SECONDS;
    const right =
      index === state.windows.length - 1 ? duration : bounds.coreEnd - SPARSE_CONTEXT_SECONDS;
    return window.cues.filter((cue) => cue.start >= left && cue.end <= right);
  });
  const seams: Cue[] = [];
  for (let index = 0; index < state.windows.length - 1; index++) {
    if (state.repairs[index]) {
      const left =
        index === 0 ? 0 : sparseBounds(index, duration).coreStart + SPARSE_CONTEXT_SECONDS;
      const right =
        index + 1 === state.windows.length - 1
          ? duration
          : sparseBounds(index + 1, duration).coreEnd - SPARSE_CONTEXT_SECONDS;
      seams.push(...state.repairs[index]!.filter((cue) => cue.start >= left && cue.end <= right));
      continue;
    }
    if (state.repairs[index - 1] || state.repairs[index + 1]) continue;
    const left = state.windows[index],
      right = state.windows[index + 1];
    if (!left || !right) continue;
    const seam = (index + 1) * SPARSE_CORE_SECONDS;
    const joined = join(left.cues.slice(-16), right.cues.slice(0, 16), seam);
    if (!joined) continue;
    seams.push(
      ...joined.filter((cue) =>
        sharedHalo
          ? cue.start < seam + SPARSE_CONTEXT_SECONDS && cue.end > seam - SPARSE_CONTEXT_SECONDS
          : cue.start >= seam - SPARSE_CONTEXT_SECONDS && cue.end <= seam + SPARSE_CONTEXT_SECONDS
      )
    );
  }
  return [...new Map([...interior, ...seams].map((cue) => [cue.id, cue])).values()].sort(
    (a, b) => a.start - b.start
  );
}

/** Exact old publication-cache interpretation, used only to admit a verified
 * failed/paused publication retry. Completed portable tracks are not rewritten.
 */
export function legacyAssembleSparse(state: SparseState, sharedHalo = false): Cue[] | undefined {
  const join = sharedHalo ? joinSparseBoundary : joinBoundary;
  if (state.windows.some((window) => !window)) return undefined;
  let cues: Cue[] = [];
  for (let index = 0; index < state.windows.length; ) {
    const repair = state.repairs[index];
    const current = repair ?? state.windows[index]!.cues;
    if (!cues.length) cues = [...current];
    else {
      const tail = cues.slice(-16);
      const joined = join(tail, current, index * SPARSE_CORE_SECONDS);
      if (!joined) return undefined;
      cues = [...cues.slice(0, -tail.length), ...joined];
    }
    index += repair ? 2 : 1;
  }
  return cues;
}
