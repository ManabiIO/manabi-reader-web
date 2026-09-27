/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { validateCue, type Cue } from './contracts.js';
/** Strict whole-window parse, preserving bracketed numbers inside spoken text.
 * A numeric bracket ends a segment only at EOF or before another opening token.
 * MOSS normally emits [start][Sxx]text[end], but upstream has reproducible outputs
 * with every speaker tag omitted. We accept that whole-window variant as
 * speaker-unknown; tagged and untagged openings may not be mixed.
 * Completed results require a final timestamp; partial tails are not published.
 */
export function parseMoss(raw: string, duration: number): Cue[] {
  return parseMossPrefix(raw, duration, true);
}
/** Preview accepts only cues closed before the next complete opening token.
 * A trailing numeric bracket is ambiguous until EOS; never infer a word timestamp.
 */
export function parseMossPreview(raw: string, duration: number): Cue[] {
  return parseMossPrefix(raw, duration, false);
}
function parseMossPrefix(raw: string, duration: number, final: boolean): Cue[] {
  if (
    typeof raw !== 'string' ||
    raw.length > 1024 * 1024 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 64
  )
    throw new Error('Invalid MOSS window/output');
  const number = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const taggedOpening = new RegExp(`\\[(${number})\\]\\[(S\\d{1,15})\\]`, 'y');
  const plainOpening = new RegExp(`\\[(${number})\\]`, 'y');
  const closing = new RegExp(`^\\[(${number})\\]`);
  const out: Cue[] = [];
  const skipSpace = (at: number) => {
    while (at < raw.length && /\s/.test(raw[at])) at++;
    return at;
  };
  let at = skipSpace(0);
  if (at === raw.length) return out;
  taggedOpening.lastIndex = at;
  const tagged = taggedOpening.test(raw);
  const opening = tagged ? taggedOpening : plainOpening;
  while (at < raw.length) {
    opening.lastIndex = at;
    const startToken = opening.exec(raw);
    if (!startToken) {
      if (!final) return out;
      throw new Error('Malformed MOSS output');
    }
    // Once the first segment chooses the tagged/untagged grammar, reject a
    // mixed stream rather than interpreting a dropped speaker label as text.
    if (!tagged) {
      taggedOpening.lastIndex = at;
      if (taggedOpening.test(raw)) {
        if (!final) return out;
        throw new Error('Mixed MOSS speaker-tag format');
      }
    }
    const textStart = opening.lastIndex;
    let scan = textStart,
      accepted = false;
    for (;;) {
      scan = raw.indexOf('[', scan);
      if (scan < 0) break;
      // Reference timestamp tokens are bounded; large bracketed numbers stay text.
      const endToken = closing.exec(raw.slice(scan, scan + 34));
      if (endToken) {
        const next = skipSpace(scan + endToken[0].length);
        opening.lastIndex = next;
        const nextToken = opening.exec(raw);
        const nextStart = nextToken ? Number(nextToken[1]) : undefined;
        if (tagged && !nextToken && next < raw.length) {
          // `[end][start]text` with no speaker is indistinguishable from adjacent
          // bracketed numbers in text. When both numbers are plausible timestamps,
          // fail closed instead of silently swallowing an untagged segment into the
          // preceding tagged cue. Large reference numbers remain ordinary text.
          plainOpening.lastIndex = next;
          const plainNext = plainOpening.exec(raw);
          const endCandidate = Number(endToken[1]),
            startCandidate = plainNext ? Number(plainNext[1]) : undefined;
          if (
            plainNext &&
            Number.isFinite(endCandidate) &&
            endCandidate <= duration + 2 &&
            Number.isFinite(startCandidate) &&
            startCandidate! <= duration + 1 &&
            startCandidate! >= endCandidate - 0.1
          ) {
            if (!final) return out;
            throw new Error('Mixed MOSS speaker-tag format');
          }
        }
        if (
          (final && next === raw.length) ||
          (nextToken && Number.isFinite(nextStart) && nextStart! <= duration + 1)
        ) {
          const start = Number(startToken[1]),
            end = Number(endToken[1]);
          const text = raw.slice(textStart, scan).trim();
          if (
            !Number.isFinite(start) ||
            !Number.isFinite(end) ||
            end < start ||
            start > duration + 1 ||
            end > duration + 2
          )
            throw new Error('Invalid MOSS timestamps');
          if (text) {
            if (start >= duration || Math.min(end, duration) <= start)
              throw new Error('MOSS speech has no usable time interval');
            out.push(
              validateCue({
                id: `cue-${out.length}`,
                start,
                end: Math.min(end, duration),
                text,
                ...(tagged ? { speaker: startToken[2] } : {})
              })
            );
            if (out.length > 50000) throw new Error('Too many MOSS cues');
          }
          at = next;
          accepted = true;
          break;
        }
      }
      scan++;
    }
    if (!accepted) {
      if (!final) return out;
      throw new Error('Incomplete MOSS output');
    }
  }
  return out;
}
export interface Window {
  index: number;
  start: number;
  end: number;
  coreStart: number;
  coreEnd: number;
}
export function planWindows(duration: number, seconds = 60, overlap = 2): Window[] {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 604800 ||
    !Number.isFinite(seconds) ||
    !Number.isFinite(overlap) ||
    seconds < 1 ||
    Math.ceil(duration / seconds) > 10080 ||
    seconds <= overlap * 2 ||
    seconds > 60 ||
    overlap < 0
  )
    throw new Error('Invalid transcription window');
  return Array.from({ length: Math.ceil(duration / seconds) }, (_, index) => ({
    index,
    start: Math.max(0, index * seconds - overlap),
    end: Math.min(duration, (index + 1) * seconds + overlap),
    coreStart: index * seconds,
    coreEnd: Math.min(duration, (index + 1) * seconds)
  }));
}
export function ownedCues(cues: Cue[], w: Window): Cue[] {
  return cues
    .map((c) => ({ ...c, start: c.start + w.start, end: c.end + w.start }))
    .filter((c) => {
      const mid = (c.start + c.end) / 2;
      return mid >= w.coreStart && mid < w.coreEnd;
    })
    .map((c) => ({
      ...c,
      id: `w${w.index}/${c.id}`,
      ...(c.speaker ? { speaker: `w${w.index}/${c.speaker}` } : {})
    }));
}

/** A fresh decoder per full-prefix snapshot: buffer a truncated trailing UTF-8 character,
 * but reject malformed interior bytes. Never show U+FFFD merely because a token split it.
 */
export function outputPreview(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 1024 * 1024)
    throw new Error('Invalid MOSS preview bytes');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
}

/** The native final result trims ASCII control/space at its edges, but cannot
 * rewrite generated tokens. Validate the final handoff, not only preview pairs.
 */
export function assertFinalOutputPrefix(previous: string, result: string): void {
  const trim = (text: string) => {
    let start = 0,
      end = text.length;
    while (start < end && text.charCodeAt(start) <= 32) start++;
    while (end > start && text.charCodeAt(end - 1) <= 32) end--;
    return text.slice(start, end);
  };
  let first = 0;
  while (first < previous.length && previous.charCodeAt(first) <= 32) first++;
  const prefix = previous.slice(first),
    final = trim(result);
  // Trailing whitespace may be stripped only at EOF. In a growing prefix it
  // belongs to the transcript ("a part" must not silently become "apart").
  if (!final.startsWith(prefix) && final !== trim(prefix))
    throw new Error('Final MOSS output rewrote an emitted preview prefix');
}
