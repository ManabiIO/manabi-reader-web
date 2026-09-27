/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { finite, onlyKeys, record, validateCue, type Cue } from './contracts.js';
import { joinBoundary, SAMPLE_RATE } from './moss-progressive.js';

/** A fixed 26-second core keeps each input within MOSS's 30-second budget. */
export const SPARSE_CORE_SECONDS = 26;
export const SPARSE_CONTEXT_SECONDS = 2;
export interface SparseWindow {
  cues: Cue[];
  inferenceMs: number;
}
export interface SparseState {
  policy: 'overlap-sparse-v1' | 'overlap-sparse-v2';
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
/** Match decoded PCM to the integer sample interval before a worker can detach it.
 * Accept the decoder's one extra rounding sample, never infer on that extra sample
 * or pad a missing one. In particular 480001 samples must not buy a second block.
 */
export function sparseModelPcm(
  pcm: Float32Array,
  start: number,
  end: number,
  maximumSeconds: 30 | 60
): Float32Array {
  const expected = Math.ceil(end * SAMPLE_RATE) - Math.round(start * SAMPLE_RATE);
  if (
    !Number.isSafeInteger(expected) ||
    expected <= 0 ||
    expected > maximumSeconds * SAMPLE_RATE ||
    !(pcm instanceof Float32Array) ||
    pcm.length < expected ||
    pcm.length > expected + 1 ||
    !pcm.every(Number.isFinite)
  )
    throw new Error('Invalid decoded sparse audio window');
  return pcm.length === expected ? pcm : pcm.subarray(0, expected);
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
    policy: 'overlap-sparse-v2',
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
    (state.policy !== 'overlap-sparse-v1' && state.policy !== 'overlap-sparse-v2') ||
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
    const originals = new Map(
      [...windows[index]!.cues, ...windows[index + 1]!.cues].map((cue) => [cue.id, cue])
    );
    if (!cues.length && (windows[index]!.cues.length || windows[index + 1]!.cues.length))
      throw new Error('Empty sparse seam repair cannot replace recognized speech');
    if (
      (index > 0 && rawRepairs[index - 1] !== null) ||
      new Set(cues.map((cue) => cue.id)).size !== cues.length ||
      cues.some((cue) => {
        const original = originals.get(cue.id);
        return (
          (!cue.id.startsWith(`w${index}/repair-`) &&
            (!original ||
              original.start !== cue.start ||
              original.end !== cue.end ||
              original.text !== cue.text ||
              original.speaker !== cue.speaker)) ||
          cue.start < start ||
          cue.end > end + 0.001
        );
      })
    )
      throw new Error('Sparse repair lies outside its input');
    return cues;
  });
  return {
    policy: state.policy,
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
/** A one-sided cue in the shared input halo is unresolved, even if the other
 * window returned no text there. Only jointly compatible hypotheses can lead. */
export function joinSparseBoundary(left: readonly Cue[], right: readonly Cue[], seam: number) {
  const leftHalo = left.some((cue) => cue.end > seam - SPARSE_CONTEXT_SECONDS);
  const rightHalo = right.some((cue) => cue.start < seam + SPARSE_CONTEXT_SECONDS);
  if (leftHalo !== rightHalo) return undefined;
  return joinBoundary(left, right, seam);
}
export function sparseLead(state: SparseState, duration: number, position: number) {
  if (!Number.isFinite(position) || position < 0 || position >= duration) return 0;
  const interval = sparseProjection(state, duration).ready.find(
    ({ start, end }) => position >= start && position < end
  );
  return interval ? interval.end - position : 0;
}
export function nextSparseWindow(state: SparseState): number {
  const target = Math.min(
    state.windows.length - 1,
    Math.floor(state.targetSeconds / SPARSE_CORE_SECONDS)
  );
  if (!state.windows[target]) return target;
  const predecessor = sparsePredecessor(state, state.targetSeconds);
  if (predecessor !== undefined) return predecessor;
  for (let distance = 1; distance < state.windows.length; distance++) {
    const after = target + distance,
      before = target - distance;
    if (after < state.windows.length && !state.windows[after]) return after;
    if (before >= 0 && !state.windows[before]) return before;
  }
  return -1;
}
/** Missing inputs needed to cover a requested caption lead, including seam context. */
export function sparseMissingWindowsForLead(
  state: SparseState,
  duration: number,
  position: number,
  leadSeconds: number
): number[] {
  const first = Math.min(state.windows.length - 1, Math.floor(position / SPARSE_CORE_SECONDS));
  const end = Math.min(duration, position + leadSeconds);
  const last = Math.min(
    state.windows.length - 1,
    Math.max(first, Math.ceil((end + SPARSE_CONTEXT_SECONDS) / SPARSE_CORE_SECONDS) - 1)
  );
  const start =
    sparsePredecessor(state, position) ??
    (first > 0 && position < first * SPARSE_CORE_SECONDS + SPARSE_CONTEXT_SECONDS
      ? first - 1
      : first);
  return Array.from({ length: last - start + 1 }, (_, offset) => start + offset).filter(
    (index) => !state.windows[index]
  );
}
interface SparseComponent {
  first: number;
  last: number;
  cues: Cue[];
}

/** Reconcile the same whole-cue hypotheses for display, readiness and publication.
 * A repair is one two-core input; its superseded raw windows never decide its
 * outer seams. The cursor advances by time, not an arbitrary last-N cue slice.
 */
function sparseComponents(state: SparseState): SparseComponent[] {
  const components: SparseComponent[] = [];
  let active: SparseComponent | undefined;
  let cursor = 0;
  for (let index = 0; index < state.windows.length; ) {
    const window = state.windows[index];
    if (!window) {
      active = undefined;
      index++;
      continue;
    }
    const repair = state.repairs[index];
    const current = repair ?? window.cues;
    const last = index + (repair ? 1 : 0);
    if (active && active.last + 1 === index) {
      const start = Math.max(0, index * SPARSE_CORE_SECONDS - SPARSE_CONTEXT_SECONDS);
      while (cursor < active.cues.length && active.cues[cursor].end <= start) cursor++;
      const joined = joinSparseBoundary(
        active.cues.slice(cursor),
        current,
        index * SPARSE_CORE_SECONDS
      );
      if (joined) {
        active.cues.splice(cursor, active.cues.length - cursor, ...joined);
        active.last = last;
        index = last + 1;
        continue;
      }
    }
    active = { first: index, last, cues: [...current] };
    components.push(active);
    cursor = 0;
    index = last + 1;
  }
  return components;
}

/** A held leading cue may need its predecessor even several seconds past the
 * nominal seam. Use the same whole-cue extent as readiness, not just core index.
 */
function sparsePredecessor(state: SparseState, position: number): number | undefined {
  const component = sparseComponents(state).find(
    ({ first, last }) =>
      position >= first * SPARSE_CORE_SECONDS && position < (last + 1) * SPARSE_CORE_SECONDS
  );
  if (!component || !component.first || state.windows[component.first - 1]) return undefined;
  const edge = component.first * SPARSE_CORE_SECONDS + SPARSE_CONTEXT_SECONDS;
  const neededUntil = component.cues.reduce(
    (end, cue) => (cue.start < edge ? Math.max(end, cue.end) : end),
    edge
  );
  return position < neededUntil ? component.first - 1 : undefined;
}

function sparseProjection(state: SparseState, duration: number, acceptedOnly = false) {
  const cues: Cue[] = [];
  const ready: { start: number; end: number }[] = [];
  for (const component of sparseComponents(state)) {
    // A disconnected component is useful near a seek, but its text can change
    // when its preceding seam is repaired. Never make that text immutable.
    if (acceptedOnly && component.first !== 0) break;
    const start =
      component.first === 0 ? 0 : component.first * SPARSE_CORE_SECONDS + SPARSE_CONTEXT_SECONDS;
    const end =
      component.last === state.windows.length - 1
        ? Math.ceil(duration * SAMPLE_RATE) / SAMPLE_RATE
        : (component.last + 1) * SPARSE_CORE_SECONDS - SPARSE_CONTEXT_SECONDS;
    let readyStart = start;
    let readyEnd = Math.min(end, duration);
    for (const cue of component.cues) {
      if (cue.start >= start && cue.end <= end) cues.push(cue);
      else {
        // An omitted whole cue can extend well beyond the nominal two-second
        // context. Never claim its time is caption-ready just because PCM ran.
        if (cue.start < start && cue.end > start) readyStart = Math.max(readyStart, cue.end);
        if (cue.start < end && cue.end > end) readyEnd = Math.min(readyEnd, cue.start);
      }
    }
    if (readyEnd > readyStart) ready.push({ start: readyStart, end: readyEnd });
  }
  return { cues: cues.sort((a, b) => a.start - b.start), ready };
}

/** Display complete agreed components, holding only their unresolved outer cues. */
export function safeSparseCues(state: SparseState, duration: number): Cue[] {
  return sparseProjection(state, duration).cues;
}

/** Version 1 already persisted every visible component as accepted. Version 2
 * keeps seek-local components visible in the device draft while committing only
 * the reconciled prefix. Existing jobs retain their original interpretation.
 */
export function acceptedSparseCues(state: SparseState, duration: number): Cue[] {
  return sparseProjection(state, duration, state.policy === 'overlap-sparse-v2').cues;
}

/** Earliest ambiguous computed seam, even when unrelated windows are missing. */
export function pendingSparseSeam(
  state: SparseState,
  targetSeconds = state.targetSeconds
): number | undefined {
  const components = sparseComponents(state);
  const seams: number[] = [];
  for (let index = 1; index < components.length; index++) {
    if (components[index - 1].last + 1 === components[index].first)
      seams.push(components[index].first - 1);
  }
  const target = Math.floor(targetSeconds / SPARSE_CORE_SECONDS);
  return (
    seams.find((seam) => seam === target - 1) ?? seams.find((seam) => seam === target) ?? seams[0]
  );
}

/** Assemble whole-cue hypotheses. Ambiguous boundaries must be repaired, never clipped. */
export function assembleSparse(state: SparseState): { cues?: Cue[]; repair?: number } {
  if (state.windows.some((window) => !window)) return {};
  // A malformed in-memory repair is not a license to erase its source speech.
  const empty = state.repairs.findIndex(
    (repair, index) =>
      repair !== null &&
      !repair.length &&
      (state.windows[index]!.cues.length || state.windows[index + 1]!.cues.length)
  );
  if (empty >= 0) return { repair: empty };
  const components = sparseComponents(state);
  if (components.length > 1) return { repair: components[1].first - 1 };
  return { cues: components[0]?.cues.sort((a, b) => a.start - b.start) ?? [] };
}
