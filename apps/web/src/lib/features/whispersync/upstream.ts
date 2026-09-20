/**
 * @license MIT
 * Copyright (c) 2024 Renji-xD
 * Copied/adapted from 4890A/ttu-whispersync (upstream: Renji-XD/ttu-whispersync),
 * dfc05f814e2c6edb30f07040418fd1d78bbf5b4d, src/components/Match.svelte and src/lib/util.ts.
 * Full notice: apps/web/static/licenses/ttu-whispersync.txt
 * Modifications: cache Unicode arrays, type the frequency map, validate/round time
 * before decomposition, and use a symmetric n-gram size for short strings.
 */

export const ignoredRubyElements = new Set(['rp', 'rt']);

export function getSimilarity(str1: string, str2: string): number {
  const string1 = [...str1.replace(/\s/g, '').toLowerCase()];
  const string2 = [...str2.replace(/\s/g, '').toLowerCase()];
  const string1Length = string1.length;
  const string2Length = string2.length;
  const substringLength = Math.min(string1Length, string2Length) < 5 ? 1 : 2;

  if (string1.join('') === string2.join('')) return 1;
  if (string1Length < substringLength || string2Length < substringLength) return 0;

  const map = new Map<string, number>();
  for (let i = 0; i < string1Length - (substringLength - 1); i += 1) {
    const substring1 = string1.slice(i, i + substringLength).join('');
    map.set(substring1, (map.get(substring1) ?? 0) + 1);
  }

  let match = 0;
  for (let j = 0; j < string2Length - (substringLength - 1); j += 1) {
    const substring2 = string2.slice(j, j + substringLength).join('');
    const count = map.get(substring2) ?? 0;
    if (count > 0) {
      map.set(substring2, count - 1);
      match += 1;
    }
  }
  return (match * 2) / (string1Length + string2Length - (substringLength - 1) * 2);
}

export function getTimeParts(seconds: number): [number, number, number, number] {
  const total = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 1000);
  return [
    Math.floor(total / 3_600_000),
    Math.floor(total / 60_000) % 60,
    Math.floor(total / 1000) % 60,
    total % 1000
  ];
}

export function toTimeString(seconds: number): string {
  return getTimeParts(seconds)
    .slice(0, 3)
    .map((part) => `${part}`.padStart(2, '0'))
    .join(':');
}
