/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { LIMITS, validateCue, type Cue } from './contracts.js';

/** Presentation only. Diarization IDs and verbatim text stay in the canonical cues.
 * A second language is formatted separately; it is never a second speaker.
 * Hyphen-minus is the dialogue marker, not an em dash. No identity is inferred
 * for unlabelled/imported text, and no participant is silently discarded.
 */
export function dialogueText(cues: readonly Pick<Cue, 'text' | 'speaker'>[]): string {
  const dual =
    cues.every((cue) => !!cue.speaker) && new Set(cues.map((cue) => cue.speaker)).size > 1;
  if (!dual) return cues.map((cue) => cue.text).join('\n');
  const runs: { speaker: string; text: string }[] = [];
  for (const cue of cues) {
    const text = cue.text.replace(/\s*\n\s*/g, ' ');
    const last = runs[runs.length - 1];
    if (last?.speaker === cue.speaker) last.text += ` ${text}`;
    else runs.push({ speaker: cue.speaker!, text });
  }
  return runs.map((run) => `-${run.text}`).join('\n');
}

/** Anonymous model labels restart per window. Do not imply whole-film identity. */
export function speakerLabel(speaker: string): string {
  const match = /^(?:w(\d+)\/)?S(\d+)$/.exec(speaker);
  if (!match) return speaker;
  const voice = `Speaker ${Number(match[2])}`;
  return match[1] === undefined ? voice : `${voice} · window ${Number(match[1]) + 1}`;
}

export interface SubtitleEvent {
  start: number;
  end: number;
  text: string;
}

/** SRT has no speaker metadata. Export diarized overlaps as non-overlapping
 * display intervals, with all currently audible turns on separate lines.
 * Sequential turns keep their timing; no fabricated word alignment is used.
 * Work/output are bounded, including adversarial overlapping caption archives.
 */
export function subtitleEvents(cues: readonly Cue[]): SubtitleEvent[] {
  if (cues.length > LIMITS.cues) throw new Error('Too many subtitle cues to export');
  const normalized = cues.map((cue) => {
    validateCue(cue);
    const start = Math.round(cue.start * 1000);
    return { ...cue, start, end: Math.max(start + 1, Math.round(cue.end * 1000)) };
  });
  // Preserve authored cue grouping when there is no speaker metadata.
  if (!normalized.some((cue) => cue.speaker))
    return normalized.map((cue) => ({
      start: cue.start / 1000,
      end: cue.end / 1000,
      text: cue.text
    }));

  const boundaries = normalized
    .flatMap((cue, index) => [
      { at: cue.start, index, start: true },
      { at: cue.end, index, start: false }
    ])
    .sort((a, b) => a.at - b.at || Number(a.start) - Number(b.start) || a.index - b.index);
  const active = new Set<number>(),
    result: SubtitleEvent[] = [];
  let textBudget = 0;
  for (let i = 0; i < boundaries.length; ) {
    const start = boundaries[i].at;
    do {
      const event = boundaries[i++];
      if (event.start) active.add(event.index);
      else active.delete(event.index);
    } while (i < boundaries.length && boundaries[i].at === start);
    const end = boundaries[i]?.at;
    if (end === undefined || !active.size) continue;
    // Check before constructing text; repeated large overlaps cannot allocate
    // an unbounded intermediate, even when the eventual export is rejected.
    let length = 0;
    for (const index of active) {
      length += normalized[index].text.length + 2;
      if (length > LIMITS.cueText)
        throw new Error('Overlapping dialogue is too large to export safely');
    }
    const turns = [...active]
      .sort((a, b) => normalized[a].start - normalized[b].start || a - b)
      .map((index) => normalized[index]);
    const text = dialogueText(turns);
    textBudget += new TextEncoder().encode(text).length + 64;
    if (textBudget > LIMITS.subtitleBytes || result.length >= LIMITS.cues)
      throw new Error('Subtitle export exceeds the supported size; export fewer cues');
    result.push({ start: start / 1000, end: end / 1000, text });
  }
  return result;
}
