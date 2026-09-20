/** @license MIT — adapted from ttu-whispersync; full provenance in docs/whispersync.md. */
import { getSimilarity, ignoredRubyElements } from './upstream';
import type { Cue } from './subtitles';

export const MAX_BOOK_UNITS = 4_000_000;
export const MAX_BOOK_RAW_UNITS = 8_000_000;
export const MAX_BOOK_NODES = 200_000;
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
  // Sigma lowercasing depends on surrounding letters. Fold both forms so a
  // grapheme-at-a-time book index and a whole subtitle use the same alphabet.
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[\p{P}\p{Z}\s]/gu, '');
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
  /** Source offsets in the concatenation of eligible original text nodes. */
  spans: readonly TextSpan[];
  starts: Uint32Array;
  ends: Uint32Array;
  isCurrent: () => boolean;
  dispose: () => void;
}
export interface CueMatch {
  start: number;
  end: number;
  score: number;
  approximate?: boolean;
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

/** No splitting/wrapping/replacing nodes and no writes to the reader database. */
export async function buildBookIndex(
  root: HTMLElement,
  signal?: AbortSignal,
  onInvalidated?: () => void
): Promise<BookIndex> {
  if (!segmenter)
    throw new Error(
      'This browser cannot segment book text safely. Transcript playback is still available.'
    );
  const doc = root.ownerDocument;
  const Observer = doc.defaultView?.MutationObserver;
  if (!Observer) throw new Error('This browser cannot track book text changes safely.');
  let valid = true;
  let disposed = false;
  const invalidate = () => {
    if (!valid || disposed) return;
    valid = false;
    onInvalidated?.();
  };
  const changed = (records: MutationRecord[]) =>
    records.some(
      (record) =>
        record.type !== 'attributes' ||
        record.target !== root ||
        record.attributeName !== 'aria-hidden'
    );
  const observer = new Observer((records) => {
    if (changed(records)) invalidate();
  });
  // Any interior edit/reordering/insertion invalidates offsets, not only edits
  // at the first and last node of a highlighted range. takeRecords also fences
  // synchronous callers before the mutation callback gets its microtask.
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['hidden', 'aria-hidden']
  });
  const isCurrent = () => {
    if (changed(observer.takeRecords()) || !root.isConnected) invalidate();
    return valid && !disposed;
  };
  const dispose = () => {
    disposed = true;
    valid = false;
    observer.disconnect();
  };
  const assertCurrent = () => {
    check(signal);
    if (!isCurrent()) throw new DOMException('Book content changed; match again', 'AbortError');
  };
  try {
    assertCurrent();
    const walker = doc.createTreeWalker(root, 1 | 4, {
      acceptNode(node) {
        if (node.nodeType === 1) return (node as Element).matches(ignored) ? 2 : 1;
        // The reader's modal can aria-hide ancestors outside this root. Only
        // authored descendants are excluded; rejected elements prune subtrees.
        return 1;
      }
    });
    const spans: TextSpan[] = [];
    const rawParts: string[] = [];
    let rawLength = 0;
    let visited = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      check(signal);
      visited += 1;
      if (visited > MAX_BOOK_NODES)
        throw new Error('Book contains too many nodes for audiobook matching');
      if (node.nodeType === 3) {
        const text = node as Text;
        const original = text.data;
        if (rawLength + original.length > MAX_BOOK_RAW_UNITS)
          throw new Error('Book is too large for audiobook matching (8 million source characters)');
        if (original.length) {
          spans.push({ node: text, original, start: rawLength, end: rawLength + original.length });
          rawParts.push(original);
          rawLength += original.length;
        }
      }
      if (visited % 256 === 0) {
        await yieldToReader(signal);
        assertCurrent();
      }
    }
    // Segment across inline-node boundaries: <span>カ</span><em>゙</em> must
    // normalize like the single grapheme ガ, while retaining both DOM endpoints.
    const raw = rawParts.join('');
    const parts: string[] = [];
    let starts = new Uint32Array(Math.min(4096, MAX_BOOK_UNITS));
    let ends = new Uint32Array(starts.length);
    let length = 0;
    let budget = 0;
    for (const { segment, index } of segmenter.segment(raw)) {
      check(signal);
      const part = normalizeText(segment);
      const required = length + part.length;
      if (required > MAX_BOOK_UNITS)
        throw new Error(
          'Book is too large for audiobook matching (4 million normalized characters)'
        );
      if (required > starts.length) {
        const capacity = Math.min(MAX_BOOK_UNITS, Math.max(required, starts.length * 2));
        const nextStarts = new Uint32Array(capacity),
          nextEnds = new Uint32Array(capacity);
        nextStarts.set(starts);
        nextEnds.set(ends);
        starts = nextStarts;
        ends = nextEnds;
      }
      if (part) parts.push(part);
      for (let i = length; i < required; i += 1) {
        starts[i] = index;
        ends[i] = index + segment.length;
      }
      length = required;
      budget += segment.length;
      if (budget >= 8192) {
        budget = 0;
        await yieldToReader(signal);
        assertCurrent();
      }
    }
    assertCurrent();
    return {
      root,
      text: parts.join(''),
      spans,
      starts: starts.slice(0, length),
      ends: ends.slice(0, length),
      isCurrent,
      dispose
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

function spanAt(index: BookIndex, sourceOffset: number): TextSpan | undefined {
  let lo = 0;
  let hi = index.spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index.spans[mid].end <= sourceOffset) lo = mid + 1;
    else hi = mid;
  }
  return index.spans[lo];
}

export function rangeForMatch(index: BookIndex, match: CueMatch): Range | undefined {
  if (
    !index.isCurrent() ||
    !Number.isInteger(match.start) ||
    !Number.isInteger(match.end) ||
    match.end <= match.start ||
    match.start < 0 ||
    match.end > index.text.length
  )
    return undefined;
  const firstOffset = index.starts[match.start];
  const lastOffset = index.ends[match.end - 1];
  const first = spanAt(index, firstOffset);
  const last = spanAt(index, lastOffset - 1);
  if (!first || !last) return undefined;
  const range = index.root.ownerDocument.createRange();
  range.setStart(first.node, firstOffset - first.start);
  range.setEnd(last.node, lastOffset - last.start);
  return range;
}

export function offsetForSelection(index: BookIndex, range: Range): number | undefined {
  if (!index.isCurrent() || !index.root.contains(range.startContainer)) return undefined;
  let sourceOffset: number | undefined;
  for (const span of index.spans) {
    if (span.node === range.startContainer) {
      sourceOffset = span.start + range.startOffset;
      break;
    }
    // Browser selections can start at element-child boundaries, not only Text.
    const candidate = index.root.ownerDocument.createRange();
    candidate.selectNodeContents(span.node);
    if (candidate.comparePoint(range.startContainer, range.startOffset) < 0) {
      sourceOffset = span.start;
      break;
    }
  }
  if (sourceOffset === undefined) return index.text.length;
  let lo = 0;
  let hi = index.ends.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index.ends[mid] <= sourceOffset) lo = mid + 1;
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
  if (options.start !== undefined && !Number.isInteger(options.start))
    throw new Error('Invalid matching start offset');
  const matches: (CueMatch | undefined)[] = [];
  let cursor = Math.max(0, Math.min(text.length, options.start ?? 0));
  let anchored = options.start !== undefined;
  for (let i = 0; i < cues.length; i += 1) {
    check(options.signal);
    const needle = normalizeText(cues[i].text);
    const characters = [...needle].length;
    const limit = characters < 4 ? 256 : 20_000;
    const window = text.slice(cursor, cursor + limit + needle.length);
    let match: CueMatch | undefined;
    const at = needle ? window.indexOf(needle) : -1;
    if (at >= 0 && (characters >= 4 || (anchored && window.indexOf(needle, at + 1) < 0))) {
      match = { start: cursor + at, end: cursor + at + needle.length, score: 1 };
    } else if (options.approximate && characters >= 8 && needle.length <= 256) {
      // N-gram equality does not imply identical text. Preserve the match kind
      // even when the similarity score is 1, and evaluate all near-tied rivals.
      const candidates: CueMatch[] = [];
      for (let offset = 0; offset < Math.min(256, window.length - needle.length + 1); offset += 1) {
        const first = window.charCodeAt(offset),
          after = window.charCodeAt(offset + needle.length);
        if ((first >= 0xdc00 && first <= 0xdfff) || (after >= 0xdc00 && after <= 0xdfff)) continue;
        const score = getSimilarity(needle, window.slice(offset, offset + needle.length));
        if (score > 0.9) {
          const candidate = {
            start: cursor + offset,
            end: cursor + offset + needle.length,
            score,
            approximate: true
          };
          candidates.push(candidate);
          if (!match || score > match.score) match = candidate;
        }
        if (offset % 64 === 63) await yieldToReader(options.signal);
      }
      if (
        match &&
        candidates.some(
          (candidate) =>
            candidate.score >= match!.score - 0.01 && Math.abs(candidate.start - match!.start) > 2
        )
      )
        match = undefined;
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
  // Progress callbacks are allowed to cancel too, including the final callback.
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
