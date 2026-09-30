/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { finite, onlyKeys, record, validateCue, type Cue } from './contracts.js';
import { joinBoundary, SAMPLE_RATE } from './moss-progressive.js';
import { sameCueTiming } from './moss-cue-agreement.js';
import { cueDigest } from './captions.js';

/** Normal sparse cores are 26 seconds so a two-second halo fits one 30s MOSS block. */
export const SPARSE_CORE_SECONDS = 26;
export const SPARSE_BOOTSTRAP_CORE_SECONDS = 10;
export const SPARSE_CONTEXT_SECONDS = 2;
export type SparsePolicy = 'overlap-sparse-v1' | 'overlap-sparse-v2' | 'overlap-sparse-v3';
export interface SparseWindow {
  cues: Cue[];
  inferenceMs: number;
  /** Strong negative evidence from the exact PCM passed to MOSS. Optional so
   * older saved windows keep their historical reconciliation semantics. */
  digitalSilence?: true;
}
export interface SparseState {
  policy: SparsePolicy;
  windows: (SparseWindow | null)[];
  /** A failed seam keeps both original hypotheses until an explicit repair succeeds. */
  repairs: (Cue[] | null)[];
  targetSeconds: number;
}
function sparseCoreStart(index: number, policy: SparsePolicy): number {
  if (policy !== 'overlap-sparse-v3') return index * SPARSE_CORE_SECONDS;
  if (index === 0) return 0;
  if (index === 1) return SPARSE_BOOTSTRAP_CORE_SECONDS;
  return (index - 1) * SPARSE_CORE_SECONDS;
}
function sparseCoreNominalEnd(index: number, policy: SparsePolicy): number {
  if (policy !== 'overlap-sparse-v3') return (index + 1) * SPARSE_CORE_SECONDS;
  if (index === 0) return SPARSE_BOOTSTRAP_CORE_SECONDS;
  return index * SPARSE_CORE_SECONDS;
}
function sparseIndexForPosition(position: number, policy: SparsePolicy, count: number): number {
  if (policy !== 'overlap-sparse-v3')
    return Math.min(count - 1, Math.floor(position / SPARSE_CORE_SECONDS));
  if (position < SPARSE_BOOTSTRAP_CORE_SECONDS) return 0;
  if (position < SPARSE_CORE_SECONDS) return Math.min(1, count - 1);
  return Math.min(
    count - 1,
    2 + Math.floor((position - SPARSE_CORE_SECONDS) / SPARSE_CORE_SECONDS)
  );
}
export function sparseWindowCount(duration: number, policy: SparsePolicy): number {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 604800)
    throw new Error('Invalid sparse transcription duration');
  if (policy !== 'overlap-sparse-v3') return Math.ceil(duration / SPARSE_CORE_SECONDS);
  if (duration <= SPARSE_BOOTSTRAP_CORE_SECONDS) return 1;
  if (duration <= SPARSE_CORE_SECONDS) return 2;
  return 2 + Math.ceil((duration - SPARSE_CORE_SECONDS) / SPARSE_CORE_SECONDS);
}
export function sparseWindowIndex(position: number, duration: number, policy: SparsePolicy): number {
  if (!Number.isFinite(position)) throw new Error('Invalid sparse playback position');
  return sparseIndexForPosition(
    Math.max(0, Math.min(duration, position)),
    policy,
    sparseWindowCount(duration, policy)
  );
}
export function sparseBounds(
  index: number,
  duration: number,
  policy: SparsePolicy = 'overlap-sparse-v2'
) {
  const count = sparseWindowCount(duration, policy);
  if (!Number.isSafeInteger(index) || index < 0 || index >= count)
    throw new Error('Invalid sparse window index');
  const coreStart = sparseCoreStart(index, policy);
  const coreEnd = Math.min(duration, sparseCoreNominalEnd(index, policy));
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

export function newSparseState(
  duration: number,
  targetSeconds = 0,
  policy: SparsePolicy = 'overlap-sparse-v2'
): SparseState {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 604800 ||
    !Number.isFinite(targetSeconds)
  )
    throw new Error('Invalid sparse transcription duration');
  const count = sparseWindowCount(duration, policy);
  return {
    policy,
    windows: Array.from({ length: count }, () => null),
    repairs: Array.from({ length: Math.max(0, count - 1) }, () => null),
    targetSeconds: Math.min(duration, Math.max(0, targetSeconds))
  };
}
export function validateSparseState(value: unknown, duration: number): SparseState {
  const state = record(value);
  onlyKeys(state, ['policy', 'windows', 'repairs', 'targetSeconds']);
  const policy = state.policy as SparsePolicy;
  if (
    (policy !== 'overlap-sparse-v1' &&
      policy !== 'overlap-sparse-v2' &&
      policy !== 'overlap-sparse-v3') ||
    !Array.isArray(state.windows) ||
    state.windows.length !== sparseWindowCount(duration, policy) ||
    !Array.isArray(state.repairs) ||
    state.repairs.length !== Math.max(0, count - 1)
  )
    throw new Error('Invalid sparse transcription policy');
  const rawRepairs = state.repairs as unknown[];
  const windows = state.windows.map((raw, index) => {
    if (raw === null) return null;
    const w = record(raw);
    onlyKeys(w, ['cues', 'inferenceMs', 'digitalSilence']);
    if (
      !Array.isArray(w.cues) ||
      w.cues.length > 2048 ||
      (w.digitalSilence !== undefined && w.digitalSilence !== true)
    )
      throw new Error('Invalid sparse window');
    const bounds = sparseBounds(index, duration, policy);
    const cues = w.cues.map(validateCue);
    if (w.digitalSilence === true && cues.length)
      throw new Error('Digital-silent sparse window cannot contain speech');
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
    return {
      cues,
      inferenceMs: finite(w.inferenceMs, 0, 3600000),
      ...(w.digitalSilence === true ? { digitalSilence: true as const } : {})
    };
  });
  const repairs = rawRepairs.map((raw, index) => {
    if (raw === null) return null;
    if (!windows[index] || !windows[index + 1] || !Array.isArray(raw) || raw.length > 4096)
      throw new Error('Invalid sparse seam repair');
    const start = sparseBounds(index, duration, policy).start;
    const end = sparseBounds(index + 1, duration, policy).end;
    const cues = raw.map(validateCue);
    const originals = new Map(
      [
        ...windows[index]!.cues,
        ...windows[index + 1]!.cues,
        ...(index > 0 && Array.isArray(rawRepairs[index - 1])
          ? (rawRepairs[index - 1] as unknown[]).map(validateCue)
          : [])
      ].map((cue) => [cue.id, cue])
    );
    if (!cues.length && (windows[index]!.cues.length || windows[index + 1]!.cues.length))
      throw new Error('Empty sparse seam repair cannot replace recognized speech');
    if (
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
    policy,
    windows,
    repairs,
    targetSeconds: finite(state.targetSeconds, 0, duration)
  };
}
export function sparseCoverage(state: SparseState, duration: number) {
  return state.windows.reduce(
    (sum, window, index) =>
      window
        ? sum +
          sparseBounds(index, duration, state.policy).coreEnd -
          sparseBounds(index, duration, state.policy).coreStart
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
  const target = sparseIndexForPosition(state.targetSeconds, state.policy, state.windows.length);
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
  return missingPlaybackWindows(
    state.windows,
    duration,
    position,
    leadSeconds,
    sparsePredecessor(state, position),
    state.policy
  );
}
function missingPlaybackWindows(
  windows: readonly unknown[],
  duration: number,
  position: number,
  leadSeconds: number,
  predecessor: number | undefined,
  policy: SparsePolicy
): number[] {
  const first = sparseIndexForPosition(position, policy, windows.length);
  const end = Math.min(duration, position + leadSeconds);
  let last = first;
  while (
    last + 1 < windows.length &&
    sparseCoreStart(last + 1, policy) < end + SPARSE_CONTEXT_SECONDS
  )
    last++;
  const start =
    predecessor ??
    (first > 0 && position < sparseCoreStart(first, policy) + SPARSE_CONTEXT_SECONDS
      ? first - 1
      : first);
  return Array.from({ length: last - start + 1 }, (_, offset) => start + offset).filter(
    (index) => !windows[index]
  );
}
interface SparseComponent {
  first: number;
  last: number;
  cues: Cue[];
}

/** A neighboring exact-zero input is stronger evidence than a one-sided MOSS
 * hypothesis wholly inside that same PCM. Filter only the reconciliation copy:
 * source hypotheses remain durable, and a cue crossing the zero-input boundary
 * stays whole and unresolved. Repairs are not rewritten by older silence evidence. */
function rawSparseCues(state: SparseState, index: number): Cue[] {
  const window = state.windows[index];
  if (!window) return [];
  // v1 accepted disconnected components immediately. Never reinterpret its
  // historical hypotheses with evidence introduced by the later v2 policy.
  if (state.policy === 'overlap-sparse-v1') return [...window.cues];
  const previousSeam = sparseCoreStart(index, state.policy);
  const nextSeam = sparseCoreNominalEnd(index, state.policy);
  return window.cues.filter(
    (cue) =>
      !(
        (index > 0 &&
          state.windows[index - 1]?.digitalSilence === true &&
          cue.end <= previousSeam + SPARSE_CONTEXT_SECONDS) ||
        (index + 1 < state.windows.length &&
          state.windows[index + 1]?.digitalSilence === true &&
          cue.start >= nextSeam - SPARSE_CONTEXT_SECONDS)
      )
  );
}

/** Reconcile the same whole-cue hypotheses for display, readiness and publication.
 * A repair is one two-core input; its superseded raw windows never decide its
 * outer seams. The cursor advances by time, not an arbitrary last-N cue slice.
 */
function sparseComponents(
  state: SparseState,
  unsafeTiming?: (seam: number) => void
): SparseComponent[] {
  const components: SparseComponent[] = [];
  let active: SparseComponent | undefined;
  let cursor = 0;
  const segments: SparseComponent[] = [];
  for (let index = 0; index < state.windows.length; index++) {
    const window = state.windows[index];
    const repair = state.repairs[index];
    if (repair) {
      segments.push({ first: index, last: index + 1, cues: [...repair] });
    } else if (window && !state.repairs[index - 1])
      segments.push({ first: index, last: index, cues: rawSparseCues(state, index) });
  }
  for (const segment of segments) {
    if (active && active.last + 1 >= segment.first) {
      // Adjacent two-core repairs share an entire core. Join their whole-cue
      // hypotheses at that shared core's far seam, retaining older IDs where
      // they agree. Disagreement remains unresolved, never clipped.
      const overlap = active.last >= segment.first;
      const seam = overlap
        ? sparseCoreNominalEnd(segment.first, state.policy)
        : sparseCoreStart(segment.first, state.policy);
      const start = overlap
        ? seam - SPARSE_CONTEXT_SECONDS
        : Math.max(0, sparseCoreStart(segment.first, state.policy) - SPARSE_CONTEXT_SECONDS);
      while (cursor < active.cues.length && active.cues[cursor].end <= start) cursor++;
      const overlapStart = Math.max(
        0,
        sparseCoreStart(segment.first, state.policy) - SPARSE_CONTEXT_SECONDS
      );
      const early = (cues: readonly Cue[]) =>
        cues.filter((cue) => cue.start >= overlapStart && cue.end <= start);
      const leftEarly = overlap ? early(active.cues) : [];
      const rightEarly = overlap ? early(segment.cues) : [];
      // Do not throw away the younger repair's earlier speech merely because
      // the older repair already covers that time. Require whole-cue agreement.
      const agreed =
        !overlap ||
        (leftEarly.length === rightEarly.length &&
          leftEarly.every((cue, index) => {
            const other = rightEarly[index];
            return (
              cue.text === other.text &&
              Math.abs(cue.start - other.start) <= 0.35 &&
              Math.abs(cue.end - other.end) <= 0.35
            );
          }));
      // Keep historical cache derivation stable. New repair admission and
      // publication separately reject its fixed-drift false positives. Observe
      // the effective accumulated component, not just adjacent raw pairs: prior
      // joins may have restored even earlier immutable timestamps.
      if (
        unsafeTiming &&
        overlap &&
        agreed &&
        leftEarly.some((cue, index) => !sameCueTiming(cue, rightEarly[index], 0.35))
      )
        unsafeTiming(segment.first - 1);
      const current = overlap ? segment.cues.filter((cue) => cue.end > start) : segment.cues;
      const joined = agreed
        ? joinSparseBoundary(active.cues.slice(cursor), current, seam)
        : undefined;
      if (joined) {
        active.cues.splice(cursor, active.cues.length - cursor, ...joined);
        active.last = Math.max(active.last, segment.last);
        continue;
      }
    }
    active = { ...segment };
    components.push(active);
    cursor = 0;
  }
  return components;
}

/** A held leading cue may need its predecessor even several seconds past the
 * nominal seam. Use the same whole-cue extent as readiness, not just core index.
 */
function sparsePredecessor(state: SparseState, position: number): number | undefined {
  const component = sparseComponents(state).find(
    ({ first, last }) =>
      position >= sparseCoreStart(first, state.policy) &&
      position < sparseCoreNominalEnd(last, state.policy)
  );
  if (!component || !component.first || state.windows[component.first - 1]) return undefined;
  const edge = sparseCoreStart(component.first, state.policy) + SPARSE_CONTEXT_SECONDS;
  const neededUntil = component.cues.reduce(
    (end, cue) => (cue.start < edge ? Math.max(end, cue.end) : end),
    edge
  );
  return position < neededUntil ? component.first - 1 : undefined;
}

function sparseProjection(
  state: SparseState,
  duration: number,
  acceptedOnly = false,
  components = sparseComponents(state)
) {
  const cues: Cue[] = [];
  const ready: { start: number; end: number }[] = [];
  for (const component of components) {
    // A disconnected component is useful near a seek, but its text can change
    // when its preceding seam is repaired. Never make that text immutable.
    if (acceptedOnly && component.first !== 0) break;
    const start =
      component.first === 0
        ? 0
        : sparseCoreStart(component.first, state.policy) + SPARSE_CONTEXT_SECONDS;
    const end =
      component.last === state.windows.length - 1
        ? Math.ceil(duration * SAMPLE_RATE) / SAMPLE_RATE
        : sparseCoreNominalEnd(component.last, state.policy) - SPARSE_CONTEXT_SECONDS;
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

/** A display-only snapshot built on a progress notification, never a persistence
 * authority. It stores no source hypotheses/cue objects and is not identity-cached:
 * the caller must rebuild it even when a mutable Job is notified a second time.
 * Playback ticks query numeric ranges instead of rejoining and hashing all cues.
 */
export function sparsePlaybackSnapshot(state: SparseState, duration: number) {
  const components = sparseComponents(state);
  const { cues, ready } = sparseProjection(state, duration, false, components);
  const present = state.windows.map(Boolean);
  const predecessors = components.map((component) => {
    const edge = sparseCoreStart(component.first, state.policy) + SPARSE_CONTEXT_SECONDS;
    return {
      first: component.first,
      start: sparseCoreStart(component.first, state.policy),
      end: sparseCoreNominalEnd(component.last, state.policy),
      neededUntil: component.cues.reduce(
        (end, cue) => (cue.start < edge ? Math.max(end, cue.end) : end),
        edge
      )
    };
  });
  let count = 0,
    totalMs = 0,
    inputSeconds = 0,
    coreSeconds = 0;
  state.windows.forEach((window, index) => {
    if (!window) return;
    const bounds = sparseBounds(index, duration, state.policy);
    count++;
    // Coverage includes exact-silent cores, but they bypass MOSS entirely and
    // are not an ASR throughput sample. Including their cheap decode time makes
    // later speech look artificially fast and understates likely buffering.
    if (window.digitalSilence) return;
    totalMs += window.inferenceMs;
    inputSeconds += bounds.end - bounds.start;
    coreSeconds += bounds.coreEnd - bounds.coreStart;
  });
  return Object.freeze({
    cueDigest: cueDigest(cues),
    count,
    totalMs,
    inputSeconds,
    coreSeconds,
    lead(position: number): number {
      if (!Number.isFinite(position) || position < 0 || position >= duration) return 0;
      // Preserve first-component precedence even for conflicting overlapping repairs.
      const interval = ready.find(({ start, end }) => position >= start && position < end);
      return interval ? interval.end - position : 0;
    },
    missingWindows(position: number, leadSeconds: number): number[] {
      const component = predecessors.find(({ start, end }) => position >= start && position < end);
      const predecessor =
        component &&
        component.first &&
        !present[component.first - 1] &&
        position < component.neededUntil
          ? component.first - 1
          : undefined;
      return missingPlaybackWindows(
        present,
        duration,
        position,
        leadSeconds,
        predecessor,
        state.policy
      );
    }
  });
}
export type SparsePlaybackSnapshot = ReturnType<typeof sparsePlaybackSnapshot>;

/** Display complete agreed components, holding only their unresolved outer cues. */
export function safeSparseCues(state: SparseState, duration: number): Cue[] {
  return sparseProjection(state, duration).cues;
}

/** Version 1 already persisted every visible component as accepted. Version 2
 * keeps seek-local components visible in the device draft while committing only
 * the reconciled prefix. Existing jobs retain their original interpretation.
 */
export function acceptedSparseCues(state: SparseState, duration: number): Cue[] {
  return sparseProjection(state, duration, state.policy !== 'overlap-sparse-v1').cues;
}

/** Earliest ambiguous computed seam, even when unrelated windows are missing. */
export function pendingSparseSeam(
  state: SparseState,
  targetSeconds = state.targetSeconds
): number | undefined {
  const components = sparseComponents(state);
  const seams: number[] = [];
  for (let index = 1; index < components.length; index++) {
    if (components[index - 1].last + 1 >= components[index].first)
      seams.push(components[index].first - 1);
  }
  const target = sparseIndexForPosition(targetSeconds, state.policy, state.windows.length);
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

/** Old derived caches remain readable, but disjoint speech in an overlapping
 * repair pair is not authority to checkpoint new acceptance or publish a track.
 * The source hypotheses and already published tracks are never rewritten here.
 */
export function unsafeSparseRepairTiming(state: SparseState): number | undefined {
  let conflict: number | undefined;
  sparseComponents(state, (seam) => {
    conflict ??= seam;
  });
  return conflict;
}
export function assertSparseRepairTiming(state: SparseState): void {
  if (unsafeSparseRepairTiming(state) !== undefined)
    throw new Error(
      'Overlapping repair hypotheses disagree about the timing of repeated speech. Saved captions were kept; start a new transcription instead of repeating this repair.'
    );
}
