/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const foldSearch = (value: string) => value.normalize('NFKC').toLowerCase();
export const maxQueryPoints = 512;
export interface TextMatch {
  start: number;
  end: number;
  before: string;
  match: string;
  after: string;
}

/** Literal Unicode search. Coordinates always refer to the unmodified source. */
export async function* findText(
  text: string,
  query: string,
  cancelled: () => boolean = () => false
): AsyncGenerator<TextMatch> {
  if (!query.trim() || [...query].length > maxQueryPoints) return;
  const needle = foldSearch(query.trim());
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let buffer = '';
  let starts: number[] = [];
  let ends: number[] = [];
  let utfStarts: number[] = [];
  let utfEnds: number[] = [];
  let point = 0;
  let searched = 0;
  let lastStart = -1;
  let lastEnd = -1;
  function* process(final: boolean): Generator<TextMatch> {
    const until = final ? buffer.length : Math.max(0, buffer.length - needle.length + 1);
    let at = buffer.indexOf(needle, searched);
    while (at >= 0 && at < until) {
      const start = starts[at],
        end = ends[at + needle.length - 1];
      // Compatibility normalization may expand a grapheme into several matches.
      if (start !== lastStart || end !== lastEnd) {
        const from = utfStarts[at],
          to = utfEnds[at + needle.length - 1];
        let left = Math.max(0, from - 64),
          right = Math.min(text.length, to + 64);
        if (left && /[\uDC00-\uDFFF]/.test(text[left])) left++;
        if (right < text.length && /[\uD800-\uDBFF]/.test(text[right - 1])) right--;
        yield {
          start,
          end,
          before: (left ? '…' : '') + text.slice(left, from),
          match: text.slice(from, to),
          after: text.slice(to, right) + (right < text.length ? '…' : '')
        };
        lastStart = start;
        lastEnd = end;
      }
      at = buffer.indexOf(needle, at + 1);
    }
    searched = until;
    if (!final) {
      const keep = Math.min(needle.length + 128, buffer.length);
      const removed = buffer.length - keep;
      buffer = buffer.slice(removed);
      starts = starts.slice(removed);
      ends = ends.slice(removed);
      utfStarts = utfStarts.slice(removed);
      utfEnds = utfEnds.slice(removed);
      searched = Math.max(0, searched - removed);
    }
  }
  for (const item of segmenter.segment(text)) {
    if (cancelled()) return;
    const folded = foldSearch(item.segment);
    const nextPoint = point + [...item.segment].length;
    if (item.segment.length > 8192) throw new Error('A text grapheme is too large to search.');
    buffer += folded;
    for (let i = 0; i < folded.length; i++) {
      starts.push(point);
      ends.push(nextPoint);
      utfStarts.push(item.index);
      utfEnds.push(item.index + item.segment.length);
    }
    point = nextPoint;
    if (buffer.length < 32768) continue;
    yield* process(false);
    // Let the worker receive cancellations even in a large, match-free resource.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (!cancelled()) yield* process(true);
}
