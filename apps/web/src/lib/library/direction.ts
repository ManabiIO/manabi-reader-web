/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export type PageDirection = 'ltr' | 'rtl' | 'unknown';
export interface DirectionEvidence {
  value: PageDirection;
  source: 'spine' | 'content' | 'unknown';
}
/** Only the authored/imported evidence shape crosses backup restoration. */
export function validDirectionEvidence(value: unknown): value is DirectionEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).every((key) => key === 'value' || key === 'source') &&
    (v.value === 'unknown'
      ? v.source === 'unknown'
      : (v.value === 'ltr' || v.value === 'rtl') &&
        (v.source === 'spine' || v.source === 'content'))
  );
}
export interface FlowSample {
  writingMode: string;
  direction: string;
  characters: number;
}
export function resolvePageDirection(
  spine: unknown,
  samples: FlowSample[] = []
): DirectionEvidence {
  if (spine === 'ltr' || spine === 'rtl') return { value: spine, source: 'spine' };
  let left = 0,
    right = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample.characters) || sample.characters <= 0) continue;
    const mode = sample.writingMode.toLowerCase();
    if (['vertical-rl', 'sideways-rl', 'tb-rl'].includes(mode)) right += sample.characters;
    else if (['vertical-lr', 'sideways-lr', 'tb-lr'].includes(mode)) left += sample.characters;
    else if (sample.direction === 'rtl') right += sample.characters;
    else left += sample.characters;
  }
  const total = left + right;
  if (!total || Math.max(left, right) / total < 0.8) return { value: 'unknown', source: 'unknown' };
  return { value: right > left ? 'rtl' : 'ltr', source: 'content' };
}
