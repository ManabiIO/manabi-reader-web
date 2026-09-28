/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Cue } from './contracts.js';

// Matching representation only. NFC does not fold compatibility characters. Keep
// lexical/numeric boundaries: removing every space/comma/period makes "1.5" equal
// "15", or "a part" equal "apart". Japanese cue boundaries need no added spaces.
const wordCharacter = /[\p{Script=Latin}\p{N}]/u;
const ignorablePunctuation = /[。、,.!?！？]/u;
export function cueTextKey(cues: readonly Cue[]): string {
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
export const cueBounds = (cues: readonly Cue[]) => ({
  start: Math.min(...cues.map((c) => c.start)),
  end: Math.max(...cues.map((c) => c.end))
});
export interface SpeechSignature {
  text: string;
  start: number;
  end: number;
  tolerance: number;
  singleVoice: boolean;
}
export function cueGroupSignature(cues: readonly Cue[]): SpeechSignature {
  const text = cueTextKey(cues);
  return {
    text,
    ...cueBounds(cues),
    tolerance: Array.from(text).length < 4 ? 0.35 : 2,
    // Independent windows have independent speaker names. We cannot identify a
    // voice across windows, but can reject merging distinct turns within either.
    singleVoice: cues.every(
      (cue, i) => cue.speaker === cues[0].speaker && (!i || cue.start >= cues[i - 1].end - 0.05)
    )
  };
}
/** Timestamp agreement for a whole utterance, including the exact-text fast path.
 * A fixed drift alone can consume a separate short reply. Require shared audio
 * and scale the tolerated displacement to the shorter utterance as well.
 */
export function sameCueTiming(
  a: Pick<Cue, 'start' | 'end'>,
  b: Pick<Cue, 'start' | 'end'>,
  maximumDrift: number
): boolean {
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  const tolerance = Math.min(shorter / 2, maximumDrift);
  return (
    shorter > 0 &&
    overlap >= shorter / 2 &&
    Math.abs(a.start - b.start) <= tolerance &&
    Math.abs(a.end - b.end) <= tolerance
  );
}
export function sameCueSpeech(
  a: SpeechSignature,
  b: SpeechSignature,
  maximumDrift = Infinity
): boolean {
  return (
    !!a.text &&
    a.text.length <= 8192 &&
    a.text === b.text &&
    a.singleVoice &&
    b.singleVoice &&
    sameCueTiming(a, b, Math.min(a.tolerance, b.tolerance, maximumDrift))
  );
}
