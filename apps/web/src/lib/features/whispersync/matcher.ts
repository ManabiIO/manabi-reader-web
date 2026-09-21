/** @license MIT — adapted from ttu-whispersync; full provenance in docs/whispersync.md. */
import { getSimilarity, ignoredRubyElements } from './upstream';
import type { Cue } from './subtitles';

export const MAX_BOOK_UNITS = 4_000_000;
export const MAX_SOURCE_UNITS = 8_000_000;
export const MAX_BOOK_NODES = 100_000;
const ignored = [
  ...ignoredRubyElements,
  'script',
  'style',
  'template',
  'noscript',
  '[hidden]',
  '[aria-hidden="true"]'
].join(',');
const segmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined;

export function normalizeText(value: string): string {
  // Final sigma lowercasing depends on surrounding text. Fold both lowercase
  // forms alike so whole captions and individually mapped graphemes agree.
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[\p{P}\p{Z}\s\u00ad\u200b\ufeff]/gu, '');
}

export interface TextSpan {
  node: Text;
  original: string;
  start: number;
  end: number;
}
export interface BookIndex {
  root: HTMLElement;
  text: string;
  /** Offsets in the concatenated original text, not normalized text. */
  spans: TextSpan[];
  starts: Uint32Array;
  ends: Uint32Array;
  valid: () => boolean;
  dispose: () => void;
}
export interface CueMatch {
  start: number;
  end: number;
  score: number;
  approximate?: true;
}
export interface MatchOptions {
  signal?: AbortSignal;
  start?: number;
  approximate?: boolean;
  onProgress?: (processed: number, total: number) => void;
}

function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Matching canceled', 'AbortError');
}
async function yieldToReader(signal?: AbortSignal): Promise<void> {
  check(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  check(signal);
}

/**
 * No splitting/wrapping/replacing nodes and no reader database writes. Graphemes
 * are segmented across inline node boundaries, then mapped back to both original
 * endpoints. The caller owns dispose(), including abandoned matching attempts.
 */
export async function buildBookIndex(
  root: HTMLElement,
  signal?: AbortSignal,
  onInvalidate?: () => void
): Promise<BookIndex> {
  check(signal);
  if (!segmenter)
    throw new Error(
      'This browser cannot segment book text safely. Transcript playback is still available.'
    );
  return buildIndex(root, signal, onInvalidate);
}

/** Parse only into inert template content: book images/scripts are never mounted. */
export async function buildSourceBookIndex(
  html: string,
  document: Document,
  signal?: AbortSignal
): Promise<BookIndex> {
  check(signal);
  if (html.length > 32_000_000)
    throw new Error('Book markup exceeds the 32 million character matching limit');
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content.ownerDocument.createElement('div');
  root.append(template.content);
  return buildIndex(root, signal, undefined, document);
}

async function buildIndex(
  root: HTMLElement,
  signal?: AbortSignal,
  onInvalidate?: () => void,
  inertHost?: Document
): Promise<BookIndex> {
  check(signal);
  if (!segmenter)
    throw new Error(
      'This browser cannot segment book text safely. Transcript playback is still available.'
    );
  const doc = root.ownerDocument;
  const Observer = (inertHost ?? doc).defaultView?.MutationObserver;
  if (!Observer)
    throw new Error(
      'Book mutation tracking is unavailable. Transcript playback is still available.'
    );
  let invalid = false;
  let complete = false;
  const invalidate = () => {
    if (invalid) return;
    invalid = true;
    observer.disconnect();
    signal?.removeEventListener('abort', invalidate);
    if (complete) onInvalidate?.();
  };
  const observer = new Observer(invalidate);
  observer.observe(root, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'aria-hidden', 'id']
  });
  signal?.addEventListener('abort', invalidate, { once: true });
  const valid = () => {
    // takeRecords catches changes made in the same task, before the observer's
    // microtask has fired. Endpoints alone do not detect edits between them.
    if ((!inertHost && !root.isConnected) || observer.takeRecords().length || signal?.aborted)
      invalidate();
    return !invalid;
  };
  const ensureValid = () => {
    if (!valid()) throw new DOMException('Book content changed; match again', 'AbortError');
  };
  const dispose = () => {
    complete = false;
    invalidate();
  };
  try {
    ensureValid();
    if (root.closest(ignored))
      throw new Error('Book content is hidden. Open the book before matching.');
    let visited = 0;
    const walker = doc.createTreeWalker(root, 1 | 4, {
      acceptNode(node) {
        if (++visited > MAX_BOOK_NODES)
          throw new Error('Book has too many nodes for audiobook matching (100,000 limit)');
        if (node.nodeType === 1) return (node as Element).matches(ignored) ? 2 : 3;
        return 1;
      }
    });
    const spans: TextSpan[] = [];
    const rawChunks: string[] = [];
    let rawLength = 0;
    let budget = 0;
    let next: Node | null;
    while ((next = walker.nextNode())) {
      check(signal);
      const node = next as Text;
      const original = node.data;
      if (rawLength + original.length > MAX_SOURCE_UNITS)
        throw new Error('Book source exceeds the 8 million character matching limit');
      if (original.length) {
        spans.push({ node, original, start: rawLength, end: rawLength + original.length });
        rawChunks.push(original);
        rawLength += original.length;
      }
      if (++budget >= 512) {
        budget = 0;
        await yieldToReader(signal);
        ensureValid();
      }
    }
    const raw = rawChunks.join('');
    let capacity = Math.min(MAX_BOOK_UNITS, Math.max(1024, rawLength));
    let starts = new Uint32Array(capacity);
    let ends = new Uint32Array(capacity);
    const chunks: string[] = [];
    let parts: string[] = [];
    let length = 0;
    budget = 0;
    for (const { segment, index } of segmenter.segment(raw)) {
      if (segment.length > 8192)
        throw new Error('Book contains a grapheme too large for safe audiobook matching');
      const part = normalizeText(segment);
      const size = length + part.length;
      if (size > MAX_BOOK_UNITS)
        throw new Error(
          'Book is too large for audiobook matching (4 million normalized characters)'
        );
      if (size > capacity) {
        capacity = Math.min(MAX_BOOK_UNITS, Math.max(size, capacity * 2));
        const newStarts = new Uint32Array(capacity),
          newEnds = new Uint32Array(capacity);
        newStarts.set(starts);
        newEnds.set(ends);
        starts = newStarts;
        ends = newEnds;
      }
      starts.fill(index, length, size);
      ends.fill(index + segment.length, length, size);
      if (part) parts.push(part);
      length = size;
      budget += segment.length;
      if (budget >= 8192) {
        chunks.push(parts.join(''));
        parts = [];
        budget = 0;
        await yieldToReader(signal);
        ensureValid();
      }
    }
    chunks.push(parts.join(''));
    ensureValid();
    complete = true;
    return {
      root,
      text: chunks.join(''),
      spans,
      starts: starts.subarray(0, length),
      ends: ends.subarray(0, length),
      valid,
      dispose
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

function spanAt(index: BookIndex, rawOffset: number): TextSpan | undefined {
  let lo = 0;
  let hi = index.spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index.spans[mid].end <= rawOffset) lo = mid + 1;
    else hi = mid;
  }
  return index.spans[lo];
}

export function rangeForMatch(index: BookIndex, match: CueMatch): Range | undefined {
  if (
    !index.valid() ||
    !Number.isInteger(match.start) ||
    !Number.isInteger(match.end) ||
    match.end <= match.start ||
    match.start < 0 ||
    match.end > index.text.length
  )
    return undefined;
  const rawStart = index.starts[match.start];
  const rawEnd = index.ends[match.end - 1];
  const first = spanAt(index, rawStart);
  const last = spanAt(index, rawEnd - 1);
  if (!first || !last) return undefined;
  const range = index.root.ownerDocument.createRange();
  range.setStart(first.node, rawStart - first.start);
  range.setEnd(last.node, rawEnd - last.start);
  return range;
}

export function offsetForSelection(index: BookIndex, range: Range): number | undefined {
  if (!index.valid() || !index.root.contains(range.startContainer)) return undefined;
  const point = range.cloneRange();
  point.collapse(true);
  let rawOffset: number | undefined;
  for (const span of index.spans) {
    if (span.node === point.startContainer) {
      rawOffset = span.start + point.startOffset;
      break;
    }
    if (point.comparePoint(span.node, 0) >= 0) {
      rawOffset = span.start;
      break;
    }
  }
  if (rawOffset === undefined) return index.text.length;
  // A selection inside a multi-node grapheme anchors at that grapheme's start.
  let lo = 0,
    hi = index.ends.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index.ends[mid] <= rawOffset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Bounded forward search, explicit approximate matching, and cancellable batches. */
export async function matchCues(
  text: string,
  cues: readonly Cue[],
  options: MatchOptions = {}
): Promise<(CueMatch | undefined)[]> {
  if (options.start !== undefined && (!Number.isSafeInteger(options.start) || options.start < 0))
    throw new Error('Invalid book matching start offset');
  const matches: (CueMatch | undefined)[] = [];
  let cursor = Math.min(text.length, options.start ?? 0);
  let anchored = options.start !== undefined;
  for (let i = 0; i < cues.length; i += 1) {
    check(options.signal);
    const needle = normalizeText(cues[i].text);
    const limit = needle.length < 4 ? 256 : 20_000;
    const window = text.slice(cursor, cursor + limit + needle.length);
    let match: CueMatch | undefined;
    const at = needle ? window.indexOf(needle) : -1;
    if (at >= 0 && (needle.length >= 4 || (anchored && window.indexOf(needle, at + 1) < 0))) {
      match = { start: cursor + at, end: cursor + at + needle.length, score: 1 };
    } else if (options.approximate && needle.length >= 8 && needle.length <= 256) {
      // Approximation is deliberately limited to the next 256 candidate starts.
      // Keep ALL candidate scores: a later winner must not erase an earlier tie.
      const candidates: CueMatch[] = [];
      for (let offset = 0; offset < Math.min(256, window.length - needle.length + 1); offset += 1) {
        const score = getSimilarity(needle, window.slice(offset, offset + needle.length));
        if (score > 0.9)
          candidates.push({
            start: cursor + offset,
            end: cursor + offset + needle.length,
            score,
            approximate: true
          });
        if (offset % 64 === 63) await yieldToReader(options.signal);
      }
      candidates.sort((a, b) => b.score - a.score || a.start - b.start);
      const best = candidates[0];
      if (
        best &&
        !candidates.some(
          (candidate) =>
            candidate.score >= best.score - 0.01 && Math.abs(candidate.start - best.start) > 2
        )
      )
        match = best;
    }
    matches.push(match);
    if (match) {
      cursor = match.end;
      anchored = true;
    }
    if (i % 32 === 31) {
      options.onProgress?.(i + 1, cues.length);
      await yieldToReader(options.signal);
    }
  }
  check(options.signal);
  options.onProgress?.(cues.length, cues.length);
  check(options.signal);
  return matches;
}

interface HighlightWindow {
  CSS?: { highlights?: Map<string, unknown> };
  Highlight?: new (...ranges: Range[]) => unknown;
}

/** Owns one named CSS highlight; it never steals the user's text selection. */
export class ReaderHighlight {
  private readonly name = `manabi-whispersync`;
  private readonly host: HighlightWindow;
  private value: unknown;
  constructor(window: Window) {
    this.host = window as unknown as HighlightWindow;
  }
  get supported(): boolean {
    return !!this.host.CSS?.highlights && !!this.host.Highlight;
  }
  set(range?: Range): void {
    this.clear();
    if (range && this.host.Highlight && this.host.CSS?.highlights) {
      this.value = new this.host.Highlight(range);
      this.host.CSS.highlights.set(this.name, this.value);
    }
  }
  clear(): void {
    const registry = this.host.CSS?.highlights;
    if (registry && this.value && registry.get(this.name) === this.value)
      registry.delete(this.name);
    this.value = undefined;
  }
}
