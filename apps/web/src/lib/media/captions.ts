/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { LIMITS, language, validateCue, type Cue, type Track } from './contracts.js';
import { subtitleEvents } from './dialogue.js';
import { canonical, digestText } from './hash.js';
export function plainCaption(text: string): string {
  return text
    .replace(/<(rt|rp)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(?:b|i|u|ruby|c|v|lang)(?:[.\s][^<>]*)?>/gi, '')
    .replace(/<(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, name: string) => {
      if (name[0] === '#') {
        const n = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : +name.slice(1);
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
          ? String.fromCodePoint(n)
          : '\ufffd';
      }
      return (
        ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[
          name.toLowerCase()
        ] ?? raw
      );
    })
    .trim();
}
export function timestamp(value: string): number {
  const m = /^(?:(\d{2,6}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value);
  if (!m || +m[2] > 59 || +m[3] > 59) throw new Error('Invalid subtitle timestamp');
  return +(m[1] ?? 0) * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}
export function parseSubtitles(source: string): Cue[] {
  if (new TextEncoder().encode(source).length > LIMITS.subtitleBytes)
    throw new Error('Subtitle file exceeds 5 MiB');
  const normalized = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!normalized) throw new Error('Subtitle file is empty');
  const blocks = normalized.split(/\n(?:[ \t]*\n)+/),
    vtt = /^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(normalized),
    out: Cue[] = [];
  if (vtt && blocks[0].includes('-->')) throw new Error('WebVTT header needs a blank line');
  for (const [index, block] of blocks.entries()) {
    if (vtt && (index === 0 || /^(?:NOTE(?:[ \t\n]|$)|STYLE\n|REGION\n)/.test(block))) continue;
    const lines = block.split('\n'),
      i = lines[0].includes('-->') ? 0 : 1,
      m = /^\s*(\S+)\s+-->\s+(\S+)(?:[ \t]+.*)?$/.exec(lines[i] ?? '');
    if (!m) throw new Error(`Invalid subtitle block ${index + 1}`);
    out.push(
      validateCue({
        id: `cue-${out.length}`,
        start: timestamp(m[1]),
        end: timestamp(m[2]),
        text: plainCaption(lines.slice(i + 1).join('\n'))
      })
    );
    if (out.length > LIMITS.cues) throw new Error('Too many subtitle cues');
  }
  if (!out.length) throw new Error('No subtitle cues found');
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}
export class CueTimeline {
  readonly cues: readonly Cue[];
  private ends: number[];
  constructor(cues: readonly Cue[]) {
    this.cues = [...cues].sort((a, b) => a.start - b.start);
    let end = 0;
    this.ends = this.cues.map((c) => (end = Math.max(end, c.end)));
  }
  active(time: number, delay = 0): Cue[] {
    if (!Number.isFinite(time) || !Number.isFinite(delay)) return [];
    time -= delay;
    let lo = 0,
      hi = this.cues.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.cues[mid].start <= time) lo = mid + 1;
      else hi = mid;
    }
    const result: Cue[] = [];
    for (let i = lo - 1; i >= 0 && this.ends[i] > time; i--)
      if (this.cues[i].end > time) result.push(this.cues[i]);
    return result.reverse();
  }
  overlaps(start: number, end: number, delay = 0): Cue[] {
    if (![start, end, delay].every(Number.isFinite) || end <= start) return [];
    // Bound by start time, then use prefix maximum ends to include long,
    // overlapping cues without scanning the entire translated transcript.
    let lo = 0,
      hi = this.cues.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.cues[mid].start + delay < end) lo = mid + 1;
      else hi = mid;
    }
    const out: Cue[] = [];
    for (let i = lo - 1; i >= 0 && this.ends[i] + delay > start; i--)
      if (this.cues[i].end + delay > start) out.push(this.cues[i]);
    return out.reverse();
  }
}
export function matchSidecar(
  video: string,
  name: string
): {
  language: string;
  forced: boolean;
} | null {
  if (!/\.(srt|vtt)$/i.test(name)) return null;
  const base = video.replace(/\.[^.]+$/, ''),
    stem = name.replace(/\.[^.]+$/, '');
  if (
    stem.toLowerCase() !== base.toLowerCase() &&
    !stem.toLowerCase().startsWith(base.toLowerCase() + '.')
  )
    return null;
  const parts = stem.slice(base.length).split('.').filter(Boolean);
  let lang = 'und';
  for (const part of parts) {
    if (['forced', 'sdh', 'cc'].includes(part.toLowerCase())) continue;
    try {
      lang = language(part);
      break;
    } catch {
      /* A descriptive suffix is not a language. */
    }
  }
  return { language: lang, forced: parts.some((p) => p.toLowerCase() === 'forced') };
}
const timeString = (value: number, vtt: boolean) => {
  const n = Math.max(0, Math.round(value * 1000));
  return `${String(Math.floor(n / 3600000)).padStart(2, '0')}:${String(Math.floor(n / 60000) % 60).padStart(2, '0')}:${String(Math.floor(n / 1000) % 60).padStart(2, '0')}${vtt ? '.' : ','}${String(n % 1000).padStart(3, '0')}`;
};
export function serializeSubtitles(track: Track, format: 'srt' | 'vtt' = 'srt'): string {
  const escape = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n\s*\n/g, '\n');
  const events = subtitleEvents(track.cues);
  const result =
    (format === 'vtt' ? 'WEBVTT\n\n' : '') +
    events
      .map(
        (cue, i) =>
          `${i + 1}\n${timeString(cue.start, format === 'vtt')} --> ${timeString(cue.end, format === 'vtt')}\n${escape(cue.text)}`
      )
      .join('\n\n') +
    '\n';
  if (new TextEncoder().encode(result).length > LIMITS.subtitleBytes)
    throw new Error('Subtitle export exceeds 5 MiB');
  return result;
}
export const cueDigest = (cues: readonly Cue[]) => digestText(canonical(cues));
export const exportName = (name: string, track: Track, format = 'srt') =>
  `${
    name
      .replace(/\.[^.]+$/, '')
      // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted text.
      .replace(/[\\/\u0000-\u001f]/g, '_')
      .slice(0, 160) || 'Video'
  }.${track.language}${track.forced ? '.forced' : ''}.${format}`;
export function chooseLayout(
  width: number,
  height: number,
  ratio: number,
  previous: 'side' | 'below' = 'below'
): 'side' | 'below' {
  if (![width, height, ratio].every((n) => Number.isFinite(n) && n > 0) || width < 700)
    return 'below';
  const pane = Math.min(420, Math.max(280, width * 0.3)),
    bottom = Math.min(300, Math.max(160, height * 0.3));
  const area = (w: number, h: number) => Math.min(w, h * ratio) ** 2 / ratio;
  const side = area(Math.max(1, width - pane - 16), height),
    below = area(width, Math.max(1, height - bottom - 16));
  return previous === 'side'
    ? below > side * 1.08
      ? 'below'
      : 'side'
    : side > below * 1.08
      ? 'side'
      : 'below';
}
