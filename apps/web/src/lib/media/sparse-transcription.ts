/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { finite, onlyKeys, record, validateCue, type Cue } from './contracts.js';
import { joinBoundary } from './moss-progressive.js';

/** A fixed 26-second core keeps each input within MOSS's 30-second budget. */
export const SPARSE_CORE_SECONDS = 26;
export const SPARSE_CONTEXT_SECONDS = 2;
export interface SparseWindow {
  cues: Cue[];
  inferenceMs: number;
}
export interface SparseState {
  policy: 'overlap-sparse-v1';
  windows: (SparseWindow | null)[];
  /** A failed seam keeps both original hypotheses until an explicit repair succeeds. */
  repairs: (Cue[] | null)[];
  targetSeconds: number;
}
export function sparseBounds(index: number, duration: number) {
  const coreStart = index * SPARSE_CORE_SECONDS;
  const coreEnd = Math.min(duration, coreStart + SPARSE_CORE_SECONDS);
  return {
    start: Math.max(0, coreStart - SPARSE_CONTEXT_SECONDS),
    end: Math.min(duration, coreEnd + SPARSE_CONTEXT_SECONDS),
    coreStart,
    coreEnd
  };
}
export function newSparseState(duration: number, targetSeconds = 0): SparseState {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 604800 ||
    !Number.isFinite(targetSeconds)
  )
    throw new Error('Invalid sparse transcription duration');
  const count = Math.ceil(duration / SPARSE_CORE_SECONDS);
  return {
    policy: 'overlap-sparse-v1',
    windows: Array.from({ length: count }, () => null),
    repairs: Array.from({ length: Math.max(0, count - 1) }, () => null),
    targetSeconds: Math.min(duration, Math.max(0, targetSeconds))
  };
}
export function validateSparseState(value: unknown, duration: number): SparseState {
  const state = record(value);
  onlyKeys(state, ['policy', 'windows', 'repairs', 'targetSeconds']);
  const count = Math.ceil(duration / SPARSE_CORE_SECONDS);
  if (
    state.policy !== 'overlap-sparse-v1' ||
    !Array.isArray(state.windows) ||
    state.windows.length !== count ||
    !Array.isArray(state.repairs) ||
    state.repairs.length !== Math.max(0, count - 1)
  )
    throw new Error('Invalid sparse transcription policy');
  const rawRepairs = state.repairs as unknown[];
  const windows = state.windows.map((raw, index) => {
    if (raw === null) return null;
    const w = record(raw);
    onlyKeys(w, ['cues', 'inferenceMs']);
    if (!Array.isArray(w.cues) || w.cues.length > 2048) throw new Error('Invalid sparse window');
    const bounds = sparseBounds(index, duration);
    const cues = w.cues.map(validateCue);
    if (
      new Set(cues.map((cue) => cue.id)).size !== cues.length ||
      cues.some(
        (cue) =>
          !cue.id.startsWith(`w${index}/cue-`) ||
          cue.start < bounds.start ||
          cue.end > bounds.end + 0.001
      )
    )
      throw new Error('Sparse cue lies outside its input');
    return { cues, inferenceMs: finite(w.inferenceMs, 0, 3600000) };
  });
  const repairs = rawRepairs.map((raw, index) => {
    if (raw === null) return null;
    if (!windows[index] || !windows[index + 1] || !Array.isArray(raw) || raw.length > 4096)
      throw new Error('Invalid sparse seam repair');
    const start = sparseBounds(index, duration).start;
    const end = sparseBounds(index + 1, duration).end;
    const cues = raw.map(validateCue);
    if (
      (index > 0 && rawRepairs[index - 1] !== null) ||
      new Set(cues.map((cue) => cue.id)).size !== cues.length ||
      cues.some(
        (cue) =>
          !cue.id.startsWith(`w${index}/repair-`) || cue.start < start || cue.end > end + 0.001
      )
    )
      throw new Error('Sparse repair lies outside its input');
    return cues;
  });
  return {
    policy: 'overlap-sparse-v1',
    windows,
    repairs,
    targetSeconds: finite(state.targetSeconds, 0, duration)
  };
}
export function sparseCoverage(state: SparseState, duration: number) {
  return state.windows.reduce(
    (sum, window, index) =>
      window
        ? sum + sparseBounds(index, duration).coreEnd - sparseBounds(index, duration).coreStart
        : sum,
    0
  );
}
export function sparseLead(state: SparseState, duration: number, position: number) {
  const index = Math.min(
    state.windows.length - 1,
    Math.max(0, Math.floor(position / SPARSE_CORE_SECONDS))
  );
  const seamReady = (leftIndex: number) => {
    const left = state.windows[leftIndex],
      right = state.windows[leftIndex + 1];
    return (
      !!left &&
      !!right &&
      (!!state.repairs[leftIndex] ||
        !!joinBoundary(
          left.cues.slice(-16),
          right.cues.slice(0, 16),
          (leftIndex + 1) * SPARSE_CORE_SECONDS
        ))
    );
  };
  if (
    index > 0 &&
    position < index * SPARSE_CORE_SECONDS + SPARSE_CONTEXT_SECONDS &&
    !seamReady(index - 1)
  )
    return 0;
  let end = position;
  for (let i = index; i < state.windows.length && state.windows[i]; i++) {
    const bounds = sparseBounds(i, duration);
    end = i === state.windows.length - 1 ? duration : bounds.coreEnd - SPARSE_CONTEXT_SECONDS;
    if (!seamReady(i)) break;
  }
  return Math.max(0, end - position);
}
export function nextSparseWindow(state: SparseState): number {
  const target = Math.min(
    state.windows.length - 1,
    Math.floor(state.targetSeconds / SPARSE_CORE_SECONDS)
  );
  if (!state.windows[target]) return target;
  for (let distance = 1; distance < state.windows.length; distance++) {
    const after = target + distance,
      before = target - distance;
    if (after < state.windows.length && !state.windows[after]) return after;
    if (before >= 0 && !state.windows[before]) return before;
  }
  return -1;
}
/** Display only lines wholly away from unresolved boundaries. */
export function safeSparseCues(state: SparseState, duration: number): Cue[] {
  const interior = state.windows.flatMap((window, index) => {
    if (!window) return [];
    const bounds = sparseBounds(index, duration);
    const left = index === 0 ? 0 : bounds.coreStart + SPARSE_CONTEXT_SECONDS;
    const right =
      index === state.windows.length - 1 ? duration : bounds.coreEnd - SPARSE_CONTEXT_SECONDS;
    return window.cues.filter((cue) => cue.start >= left && cue.end <= right);
  });
  const seams: Cue[] = [];
  for (let index = 0; index < state.windows.length - 1; index++) {
    const left = state.windows[index],
      right = state.windows[index + 1];
    if (!left || !right) continue;
    const seam = (index + 1) * SPARSE_CORE_SECONDS;
    const joined =
      state.repairs[index] ?? joinBoundary(left.cues.slice(-16), right.cues.slice(0, 16), seam);
    if (!joined) continue;
    seams.push(
      ...joined.filter(
        (cue) =>
          cue.start >= seam - SPARSE_CONTEXT_SECONDS && cue.end <= seam + SPARSE_CONTEXT_SECONDS
      )
    );
  }
  return [...new Map([...interior, ...seams].map((cue) => [cue.id, cue])).values()].sort(
    (a, b) => a.start - b.start
  );
}
/** Assemble whole-cue hypotheses. Ambiguous boundaries must be repaired, never clipped. */
export function assembleSparse(state: SparseState): { cues?: Cue[]; repair?: number } {
  if (state.windows.some((window) => !window)) return {};
  let cues: Cue[] = [];
  for (let index = 0; index < state.windows.length; ) {
    const repair = state.repairs[index];
    const current = repair ?? state.windows[index]!.cues;
    const seam = index * SPARSE_CORE_SECONDS;
    if (!cues.length) cues = [...current];
    else {
      const tail = cues.slice(-16);
      const joined = joinBoundary(tail, current, seam);
      if (!joined) return { repair: index - 1 };
      cues = [...cues.slice(0, -tail.length), ...joined];
    }
    index += repair ? 2 : 1;
  }
  return { cues };
}
