/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { type Cue, finite, onlyKeys, record, validateCue } from './contracts.js';

export const SAMPLE_RATE = 16000;
export const CONTEXT_SAMPLES = 2 * SAMPLE_RATE;
export const PROGRESSIVE_POLICY = 'pause-overlap-v2';
export const LEGACY_PROGRESSIVE_POLICY = 'pause-overlap-v1';
export const FIRST_INPUT_SECONDS = 12;
const FIRST_CORE_SAMPLES = (FIRST_INPUT_SECONDS - 2) * SAMPLE_RATE;
const MIN_ADVANCE = 20 * SAMPLE_RATE;
const MAX_BOUNDARY_CUES = 128;

/** All boundaries are integer samples: 480001 samples buys a second encoder pass. */
export interface ProgressiveWindow {
  index: number;
  startSample: number;
  endSample: number;
  coreStartSample: number;
  coreEndSample: number;
  repairStartSample?: number;
  repairEndSample?: number;
}
export interface WindowHypothesis {
  window: ProgressiveWindow;
  cues: Cue[];
}
export interface ProgressiveState {
  policy: typeof PROGRESSIVE_POLICY | typeof LEGACY_PROGRESSIVE_POLICY;
  inputSeconds: 30;
  windows: ProgressiveWindow[];
  tail: Cue[];
  /** Both hypotheses survive an unresolved seam; resume retries repair, not earlier windows. */
  failedSeam?: WindowHypothesis;
}

export function newProgressiveState(inputSeconds: 30 = 30): ProgressiveState {
  return { policy: PROGRESSIVE_POLICY, inputSeconds, windows: [], tail: [] };
}
export const durationSamples = (duration: number) => Math.ceil(duration * SAMPLE_RATE);
export const coreEnd = (state: ProgressiveState) => state.windows.at(-1)?.coreEndSample ?? 0;
export const inputStart = (state: ProgressiveState) =>
  Math.max(0, coreEnd(state) - CONTEXT_SAMPLES);
export function inputEnd(state: ProgressiveState, duration: number): number {
  const seconds =
    state.policy === PROGRESSIVE_POLICY && !state.windows.length
      ? Math.min(state.inputSeconds, FIRST_INPUT_SECONDS)
      : state.inputSeconds;
  return Math.min(durationSamples(duration), inputStart(state) + seconds * SAMPLE_RATE);
}

/** Energy finds candidate seams only. It NEVER removes audio or classifies quiet speech as absent.
 * Search backwards from the nominal end so context never exceeds the encoder-block budget.
 */
export function chooseWindow(
  state: ProgressiveState,
  duration: number,
  pcm: Float32Array
): ProgressiveWindow {
  const startSample = inputStart(state),
    end = inputEnd(state, duration);
  const coreStartSample = coreEnd(state),
    total = durationSamples(duration);
  if (coreStartSample >= total || pcm.length !== end - startSample)
    throw new Error('Invalid progressive audio extent');
  const nominal = end === total ? total : end - CONTEXT_SAMPLES;
  let cut = nominal;
  if (end !== total) {
    const frame = 320; // 20 ms, same sample grid on every platform.
    const from = Math.max(coreStartSample + MIN_ADVANCE, nominal - 4 * SAMPLE_RATE);
    const levels: { start: number; energy: number }[] = [];
    for (let at = from; at + frame <= nominal; at += frame) {
      let sum = 0;
      for (let i = at - startSample; i < at - startSample + frame; i++) sum += pcm[i] ** 2;
      levels.push({ start: at, energy: Math.sqrt(sum / frame) });
    }
    const peak = Math.max(0, ...levels.map((f) => f.energy));
    const threshold = Math.min(0.005, peak * 0.08);
    let run = 0,
      bestScore = -Infinity;
    for (let i = 0; i <= levels.length; i++) {
      if (i < levels.length && levels[i].energy <= threshold) {
        run++;
        continue;
      }
      if (run >= 15) {
        // A sustained 300 ms valley, not an individual waveform zero.
        const length = run * frame;
        const middle = levels[i - run].start + Math.floor(length / 2);
        const score = Math.min(length, SAMPLE_RATE) - (nominal - middle) * 0.15;
        if (score > bestScore) {
          cut = middle;
          bestScore = score;
        }
      }
      run = 0;
    }
  }
  return {
    index: state.windows.length,
    startSample,
    endSample: Math.min(total, cut + CONTEXT_SAMPLES),
    coreStartSample,
    coreEndSample: cut
  };
}

export function absoluteCues(cues: Cue[], window: ProgressiveWindow, repairStart?: number): Cue[] {
  const offset = (repairStart ?? window.startSample) / SAMPLE_RATE;
  return cues.map((cue, i) => ({
    ...cue,
    id: `w${window.index}/${repairStart === undefined ? 'cue' : 'repair'}-${i}`,
    start: cue.start + offset,
    end: cue.end + offset,
    ...(cue.speaker ? { speaker: `w${window.index}/${cue.speaker}` } : {})
  }));
}

// Matching representation only. NFC does not fold compatibility characters. Keep
// lexical/numeric boundaries: removing every space/comma/period makes "1.5" equal
// "15", or "a part" equal "apart". Japanese cue boundaries need no added spaces.
const wordCharacter = /[\p{Script=Latin}\p{N}]/u;
const ignorablePunctuation = /[。、,.!?！？]/u;
function key(cues: readonly Cue[]): string {
  let text = '';
  for (const cue of cues) {
    const next = cue.text.trim();
    if (wordCharacter.test(text.slice(-1)) && wordCharacter.test(next.slice(0, 1))) text += ' ';
    text += next;
  }
  const characters = Array.from(text.normalize('NFC').replace(/\s+/gu, ' '));
  const spaced = characters.filter(
    (char, i) =>
      char !== ' ' ||
      (wordCharacter.test(characters[i - 1] ?? '') && wordCharacter.test(characters[i + 1] ?? ''))
  );
  return spaced
    .filter((char, i) => {
      if (!ignorablePunctuation.test(char)) return true;
      const before = spaced[i - 1] ?? '',
        after = spaced[i + 1] ?? '';
      return wordCharacter.test(before) && wordCharacter.test(after);
    })
    .join('');
}
const bounds = (cues: readonly Cue[]) => ({
  start: Math.min(...cues.map((c) => c.start)),
  end: Math.max(...cues.map((c) => c.end))
});
interface SpeechSignature {
  text: string;
  start: number;
  end: number;
  tolerance: number;
  singleVoice: boolean;
}
function signature(cues: readonly Cue[]): SpeechSignature {
  const text = key(cues);
  return {
    text,
    ...bounds(cues),
    tolerance: Array.from(text).length < 4 ? 0.35 : 2,
    // Independent windows have independent speaker names. We cannot identify a
    // voice across windows, but can reject merging distinct turns within either.
    singleVoice: cues.every(
      (cue, i) => cue.speaker === cues[0].speaker && (!i || cue.start >= cues[i - 1].end - 0.05)
    )
  };
}
function sameSpeech(a: SpeechSignature, b: SpeechSignature): boolean {
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  const tolerance = Math.min(a.tolerance, b.tolerance, shorter / 2);
  return (
    !!a.text &&
    a.text.length <= 8192 &&
    a.text === b.text &&
    a.singleVoice &&
    b.singleVoice &&
    shorter > 0 &&
    overlap >= shorter / 2 &&
    Math.abs(a.start - b.start) <= tolerance &&
    Math.abs(a.end - b.end) <= tolerance
  );
}

/** Suffix/prefix agreement at WHOLE cue boundaries, including one-to-many segmentation.
 * Unlike independent midpoint filtering, both sides decide ownership together. No global
 * text deduplication, invented word timing, or dropping cues crossing a watermark.
 * Undefined means ambiguity, not permission to discard either hypothesis.
 */
export function joinBoundary(
  left: readonly Cue[],
  right: readonly Cue[],
  seam: number
): Cue[] | undefined {
  if (!left.length) return [...right];
  if (!right.length) return [...left];
  const end = right.findIndex((c) => c.start > seam + 4);
  const rightHead = end < 0 ? right : right.slice(0, end);
  if (
    left.length > MAX_BOUNDARY_CUES ||
    rightHead.length > MAX_BOUNDARY_CUES ||
    key(left).length + key(rightHead).length > 32768
  )
    return undefined;
  const matches: { i: number; n: number; size: number }[] = [];
  // Compute bounded signatures once, rather than normalizing long Japanese strings
  // inside every candidate pair on the UI/queue thread.
  const suffixes = left.map((_, i) => signature(left.slice(i)));
  const prefixes = rightHead.map((_, i) => signature(right.slice(0, i + 1)));
  for (let i = 0; i < suffixes.length; i++) {
    for (let n = 1; n <= prefixes.length; n++) {
      if (sameSpeech(suffixes[i], prefixes[n - 1]))
        matches.push({ i, n, size: suffixes[i].text.length });
    }
  }
  matches.sort((a, b) => b.size - a.size);
  const best = matches[0];
  if (best && (!matches[1] || matches[1].size < best.size)) {
    // All of the chosen left suffix equals the removed right prefix; retain its original IDs.
    return [...left, ...right.slice(best.n)];
  }
  const a = bounds(left),
    b = bounds(right);
  if (a.end <= seam && b.start >= seam && b.start - a.end >= 0.12) return [...left, ...right];
  return undefined;
}

/** A two-block repair re-recognizes the entire adjacent-window union. It may replace only
 * the unsettled suffix: a unique whole-cue anchor must connect it to accepted text.
 * This avoids imposing two separate, potentially inconsistent ownership cuts on a repair.
 */
export function repairedSuffix(
  accepted: readonly Cue[],
  repair: readonly Cue[],
  startSeconds: number
): Cue[] | undefined {
  if (!accepted.length || bounds(accepted.slice(-MAX_BOUNDARY_CUES)).end <= startSeconds)
    return [...repair];
  const anchors = accepted.slice(-8);
  if (key(anchors).length + key(repair.slice(0, MAX_BOUNDARY_CUES)).length > 32768)
    return undefined;
  const matches: { end: number; size: number }[] = [];
  const suffixes = anchors.map((_, i) => signature(anchors.slice(i)));
  for (let j = 0; j < repair.length && j < MAX_BOUNDARY_CUES; j++) {
    for (let n = 1; n <= 8 && j + n <= repair.length && j + n <= MAX_BOUNDARY_CUES; n++) {
      const candidate = signature(repair.slice(j, j + n));
      for (const anchor of suffixes) {
        if (sameSpeech(anchor, candidate)) matches.push({ end: j + n, size: anchor.text.length });
      }
    }
  }
  matches.sort((a, b) => b.size - a.size);
  const best = matches[0];
  if (!best || matches.some((m) => m.size === best.size && m.end !== best.end)) return undefined;
  return repair.slice(best.end);
}

export function splitSettled(cues: Cue[], window: ProgressiveWindow, duration: number) {
  if (window.coreEndSample === durationSamples(duration))
    return { settled: cues, tail: [] as Cue[] };
  // The NEXT input begins here. Any crossing cue is held WHOLE, never text-clipped.
  const cutoff = (window.coreEndSample - CONTEXT_SAMPLES) / SAMPLE_RATE;
  const pending = cues.findIndex((c) => c.end > cutoff);
  return pending < 0
    ? { settled: cues, tail: [] as Cue[] }
    : { settled: cues.slice(0, pending), tail: cues.slice(pending) };
}

function integer(value: unknown, min: number, max: number): number {
  const n = finite(value, min, max);
  if (!Number.isSafeInteger(n)) throw new Error('Invalid sample boundary');
  return n;
}
/** A saved cue must belong to an actual recognized input interval, not just a window number. */
export function cueBelongsToWindow(cue: Cue, windows: readonly ProgressiveWindow[]): boolean {
  const match = /^w(\d+)\/(cue|repair)-(\d+)$/.exec(cue.id);
  const window = match && windows[Number(match[1])];
  if (!match || !window || !Number.isSafeInteger(Number(match[3]))) return false;
  const repair = match[2] === 'repair';
  const start = repair ? window.repairStartSample : window.startSample;
  const end = repair ? window.repairEndSample : window.endSample;
  return (
    start !== undefined &&
    end !== undefined &&
    cue.start >= start / SAMPLE_RATE &&
    cue.end <= end / SAMPLE_RATE + 1 / SAMPLE_RATE
  );
}
function validateWindow(
  value: unknown,
  index: number,
  start: number,
  total: number,
  limit: number,
  shortFirst = false
): ProgressiveWindow {
  const w = record(value);
  onlyKeys(w, [
    'index',
    'startSample',
    'endSample',
    'coreStartSample',
    'coreEndSample',
    'repairStartSample',
    'repairEndSample'
  ]);
  const a = integer(w.startSample, 0, total),
    b = integer(w.endSample, a + 1, total);
  const c = integer(w.coreEndSample, start + 1, b);
  if (
    w.index !== index ||
    w.coreStartSample !== start ||
    a !== Math.max(0, start - CONTEXT_SAMPLES) ||
    b - a > limit ||
    b !== Math.min(total, c + CONTEXT_SAMPLES) ||
    (shortFirst
      ? c !== total &&
        (index !== 0 ||
          start !== 0 ||
          c !== FIRST_CORE_SAMPLES ||
          b > FIRST_INPUT_SECONDS * SAMPLE_RATE)
      : c !== total && c - start < MIN_ADVANCE)
  )
    throw new Error('Invalid saved progressive window');
  const result: ProgressiveWindow = {
    index,
    startSample: a,
    endSample: b,
    coreStartSample: start,
    coreEndSample: c
  };
  if (w.repairStartSample !== undefined || w.repairEndSample !== undefined) {
    result.repairStartSample = integer(w.repairStartSample, 0, a);
    result.repairEndSample = integer(w.repairEndSample, b, total);
    if (result.repairEndSample - result.repairStartSample > 60 * SAMPLE_RATE)
      throw new Error('Repair exceeds two encoder blocks');
  }
  return result;
}
export function validateProgressiveState(
  value: unknown,
  duration: number,
  nextWindow: number
): ProgressiveState {
  const p = record(value),
    total = durationSamples(duration);
  onlyKeys(p, ['policy', 'inputSeconds', 'windows', 'tail', 'failedSeam']);
  if (
    (p.policy !== PROGRESSIVE_POLICY && p.policy !== LEGACY_PROGRESSIVE_POLICY) ||
    p.inputSeconds !== 30 ||
    !Array.isArray(p.windows) ||
    p.windows.length !== nextWindow ||
    p.windows.length > Math.ceil(total / MIN_ADVANCE) + 1 ||
    !Array.isArray(p.tail) ||
    p.tail.length > MAX_BOUNDARY_CUES
  )
    throw new Error('Invalid saved progressive policy');
  const inputSeconds = p.inputSeconds as 30;
  const policy = p.policy as ProgressiveState['policy'];
  let start = 0;
  const windows = p.windows.map((value, index) => {
    const w = validateWindow(
      value,
      index,
      start,
      total,
      inputSeconds * SAMPLE_RATE,
      policy === PROGRESSIVE_POLICY && index === 0
    );
    if (
      w.repairStartSample !== undefined &&
      (!index ||
        w.repairEndSample !== w.endSample ||
        w.repairStartSample > (p.windows as ProgressiveWindow[])[index - 1].startSample)
    )
      throw new Error('Invalid saved repair interval');
    start = w.coreEndSample;
    return w;
  });
  const tail = p.tail.map(validateCue);
  if (
    tail.some((c) => !cueBelongsToWindow(c, windows)) ||
    new Set(tail.map((c) => c.id)).size !== tail.length ||
    (!windows.length && tail.length) ||
    (start === total && tail.length)
  )
    throw new Error('Invalid unsettled transcription tail');
  const result: ProgressiveState = { policy, inputSeconds, windows, tail };
  if (p.failedSeam !== undefined) {
    if (!windows.length || start === total) throw new Error('Invalid pending seam');
    const h = record(p.failedSeam);
    onlyKeys(h, ['window', 'cues']);
    const window = validateWindow(
      h.window,
      nextWindow,
      start,
      total,
      inputSeconds * SAMPLE_RATE,
      policy === PROGRESSIVE_POLICY && nextWindow === 0
    );
    if (window.repairStartSample !== undefined)
      throw new Error('Pending hypothesis cannot claim repair provenance');
    if (!Array.isArray(h.cues) || h.cues.length > 2048) throw new Error('Invalid seam hypothesis');
    const cues = h.cues.map(validateCue);
    if (
      cues.some(
        (c) => !cueBelongsToWindow(c, [...windows, window]) || !c.id.startsWith(`w${nextWindow}/`)
      ) ||
      new Set(cues.map((c) => c.id)).size !== cues.length
    )
      throw new Error('Invalid seam cues');
    result.failedSeam = { window, cues };
  }
  return result;
}
