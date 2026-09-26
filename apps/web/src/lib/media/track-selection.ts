/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { language, type Track } from './contracts.js';

/** A display hint, never a rewrite of imported text, provenance or language tags. */
export function trackLanguage(track: Pick<Track, 'language' | 'cues'>): string {
  try {
    const tagged = language(track.language);
    if (tagged !== 'und') return tagged;
  } catch {
    /* Missing metadata remains unknown unless the text is unambiguous. */
  }
  const sample = track.cues
    .slice(0, 32)
    .map((cue) => cue.text)
    .join(' ')
    .slice(0, 8192);
  const letters = sample.match(/\p{Letter}/gu)?.length ?? 0;
  const kana = sample.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  const hangul = sample.match(/\p{Script=Hangul}/gu)?.length ?? 0;
  // Shared Han characters, short names, and Latin alphabets do not identify a language.
  if (kana >= 4 && kana >= letters * 0.2 && !hangul) return 'ja';
  if (hangul >= 4 && hangul >= letters * 0.5 && !kana) return 'ko';
  return 'und';
}

export function languageName(tag: string): string {
  if (tag === 'und') return 'Language unknown';
  try {
    return new Intl.DisplayNames(undefined, { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Prefer the viewer's language, not just any language different from the main one.
 * A tie stays unselected. A stored/manual choice (including Off) is managed by the caller.
 */
export function translationCandidate(
  primary: Track,
  tracks: readonly Track[],
  preferred: readonly string[]
): Track | undefined {
  const main = trackLanguage(primary).split('-')[0];
  if (main === 'und') return undefined;
  const candidates = tracks.filter(
    (track) =>
      track.id !== primary.id &&
      track.complete &&
      !track.forced &&
      track.cues.length > 0 &&
      !['und', main].includes(trackLanguage(track).split('-')[0])
  );
  for (const raw of preferred.slice(0, 16)) {
    let wanted: string;
    try {
      wanted = language(raw);
    } catch {
      continue;
    }
    if (wanted.split('-')[0] === main) continue;
    const exact = candidates.filter((track) => trackLanguage(track) === wanted);
    const matching = exact.length
      ? exact
      : candidates.filter((track) => trackLanguage(track).split('-')[0] === wanted.split('-')[0]);
    const derived = matching.filter((track) => track.derivedFrom?.trackId === primary.id);
    if (derived.length === 1) return derived[0];
    if (matching.length === 1) return matching[0];
    if (matching.length > 1) return undefined;
  }
  return undefined;
}
