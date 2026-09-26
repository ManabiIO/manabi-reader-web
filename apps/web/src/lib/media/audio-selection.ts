/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { language } from './contracts.js';
export interface AudioChoice {
  id: number;
  language: string;
  name: string | null;
  decodable: boolean;
  default?: boolean;
  primary?: boolean;
  original?: boolean;
  commentary?: boolean;
  visuallyImpaired?: boolean;
}
export function audioLanguage(value: unknown): string {
  try {
    return language(value);
  } catch {
    return 'und';
  }
}
function automatic(tracks: readonly AudioChoice[]): AudioChoice | undefined {
  // Commentary and audio-description tracks remain available for an explicit user choice,
  // but they are never guessed as the speech the user meant to transcribe.
  const candidates = tracks.filter((t) => t.decodable && !t.commentary && !t.visuallyImpaired);
  if (candidates.length === 1) return candidates[0];
  for (const key of ['primary', 'original', 'default'] as const) {
    const preferred = candidates.filter((t) => t[key]);
    if (preferred.length === 1) return preferred[0];
  }
  return undefined;
}
/** Do not silently transcribe a dub, commentary track or arbitrary first stream. */
export function chooseTranscriptionAudio(
  tracks: readonly AudioChoice[],
  target: string
): AudioChoice | undefined {
  const wanted = language(target),
    available = tracks.filter((t) => t.decodable);
  if (wanted === 'und') return automatic(available);
  const exact = available.filter((t) => audioLanguage(t.language) === wanted);
  if (exact.length) return automatic(exact);
  const family = available.filter(
    (t) => audioLanguage(t.language).split('-')[0] === wanted.split('-')[0]
  );
  if (family.length) return automatic(family);
  // Explicit Generate can use its user-provided label for one untagged ordinary stream.
  const unknown = available.filter((t) => audioLanguage(t.language) === 'und');
  return unknown.length ? automatic(unknown) : undefined;
}
