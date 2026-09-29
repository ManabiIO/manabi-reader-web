/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Cue } from './contracts.js';
import {
  cueGroupSignature,
  sameCueSpeech,
  sameCueTiming,
  type SpeechSignature
} from './moss-cue-agreement.js';

const DRIFT = 0.35;
const GROUP = 16;
const LIMIT = 128;
const COMPARISONS = 100000;

/** Match a repair to immutable accepted captions without inventing word timing.
 * Exact one-to-one matches must agree on the same audio interval. When segmentation
 * changed, only one unique set of whole repair cues may account for all accepted
 * speech. Alternative partitions of that SAME set are equivalent, not ambiguity.
 * Unmatched repair cues remain intact; text is never clipped or synthesized.
 * Undefined is an unresolved conflict, not permission to overwrite a checkpoint.
 */
export function retainAcceptedRepair(
  accepted: readonly Cue[],
  repair: readonly Cue[],
  start: number,
  end: number
): Cue[] | undefined {
  const anchors = accepted.filter((cue) => cue.start >= start && cue.end <= end);
  if (!anchors.length) return [...repair];

  const exact = [...repair];
  const used = new Set<number>();
  let complete = true;
  for (const anchor of anchors) {
    const candidates = repair.flatMap((cue, index) =>
      !used.has(index) && cue.text === anchor.text && sameCueTiming(cue, anchor, DRIFT)
        ? [index]
        : []
    );
    if (candidates.length !== 1) {
      complete = false;
      break;
    }
    exact[candidates[0]] = anchor;
    used.add(candidates[0]);
  }
  // Restoring immutable timestamps can change the order relative to unmatched
  // speech. All downstream boundary cursors require chronological input.
  if (complete) return exact.sort((a, b) => a.start - b.start || a.end - b.end);

  // Bound fallback work independently of input duration or token count. The
  // exact path above still supports dense windows beyond the alignment budget.
  const from = Math.min(...anchors.map((cue) => cue.start)) - DRIFT;
  const to = Math.max(...anchors.map((cue) => cue.end)) + DRIFT;
  const candidates = repair.flatMap((cue, index) =>
    cue.start >= from && cue.end <= to ? [{ cue, index }] : []
  );
  if (
    anchors.length > LIMIT ||
    candidates.length > LIMIT ||
    anchors.reduce((sum, cue) => sum + cue.text.length, 0) +
      candidates.reduce((sum, { cue }) => sum + cue.text.length, 0) >
      32768
  )
    return undefined;
  const right = candidates.map(({ cue }) => cue);
  const groups = (cues: readonly Cue[]) => {
    const cache = new Map<string, SpeechSignature>();
    return (at: number, count: number) => {
      const key = `${at}:${count}`;
      let value = cache.get(key);
      if (!value) {
        value = cueGroupSignature(cues.slice(at, at + count));
        cache.set(key, value);
      }
      return value;
    };
  };
  const leftGroup = groups(anchors),
    rightGroup = groups(right);
  const memo = new Map<string, bigint[]>();
  let budget = COMPARISONS,
    exhausted = false;
  const solve = (at: number, cursor: number): bigint[] => {
    if (at === anchors.length) return [0n];
    const key = `${at}:${cursor}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const solutions = new Set<bigint>();
    for (let a = 1; a <= GROUP && at + a <= anchors.length; a++) {
      const left = leftGroup(at, a);
      if (!left.singleVoice) break; // Never merge separate speakers or overlaps.
      for (let j = cursor; j < right.length; j++) {
        if (right[j].start < left.start - DRIFT) continue;
        if (right[j].start > left.start + DRIFT) break;
        for (let b = 1; b <= GROUP && j + b <= right.length; b++) {
          // A filtered-out cue between two candidates is real speech; it must
          // not disappear inside an apparently matching group.
          if (candidates[j + b - 1].index !== candidates[j].index + b - 1) break;
          if (--budget < 0) {
            exhausted = true;
            return [];
          }
          const next = rightGroup(j, b);
          if (!next.singleVoice) break;
          if (!sameCueSpeech(left, next, DRIFT)) continue;
          const mask = ((1n << BigInt(b)) - 1n) << BigInt(j);
          for (const suffix of solve(at + a, j + b)) {
            solutions.add(mask | suffix);
            if (solutions.size > 1) break;
          }
          if (exhausted || solutions.size > 1) break;
        }
        if (exhausted || solutions.size > 1) break;
      }
      if (exhausted || solutions.size > 1) break;
    }
    const result = [...solutions];
    memo.set(key, result);
    return result;
  };
  const solutions = solve(0, 0);
  if (exhausted || solutions.length !== 1) return undefined;
  const replaced = new Set(
    candidates.flatMap(({ index }, n) => (solutions[0] & (1n << BigInt(n)) ? [index] : []))
  );
  return [...repair.filter((_, index) => !replaced.has(index)), ...anchors].sort(
    (a, b) => a.start - b.start || a.end - b.end
  );
}
