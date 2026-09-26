/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { parseFragment } from 'parse5';
import { foldSearch } from './search-normalization.ts';
export { foldSearch } from './search-normalization.ts';
import type { PublicationManifest, PublicationResource, ReaderLocator } from '../reader-location';

export const indexVersion = 1;
export interface SearchResource {
  resource: PublicationResource;
  text: string;
  /** Only requested during Yatsu import; never persisted by library search. */
  legacy?: { text: string; runs: { source: number; target: number; length: number }[] };
}
export interface ContentHit {
  bookId: number;
  locator: ReaderLocator;
  excerpt: string;
}
export interface SearchBook {
  id: number;
  key: string;
}
interface Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
}
const excluded = new Set(['rt', 'rp', 'rtc', 'script', 'style', 'template', 'noscript']);
const blocks = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'pre',
  'div',
  'tr',
  'figcaption'
]);
const attr = (node: Node, name: string) => node.attrs?.find((item) => item.name === name)?.value;

/** Same canonical projection as reader-location.ts, without a DOM or live imported markup. */
export function projectSearchBook(
  html: string,
  manifest?: PublicationManifest,
  includeLegacy = false
): SearchResource[] {
  if (html.length > 32 * 1024 * 1024) throw new Error('Book exceeds the local search size limit.');
  const root = parseFragment(html) as unknown as Node;
  const elements = root.childNodes?.filter((node) => !!node.tagName) ?? [];
  if (elements.length > 5000) throw new Error('Book has too many search resources.');
  if (manifest && (manifest.version !== 1 || manifest.resources.length !== elements.length))
    throw new Error('The publication manifest does not match its content.');
  let nodes = 0,
    characters = 0;
  return elements.map((element, spineIndex) => {
    const resource = manifest?.resources[spineIndex] ?? {
      href: `legacy-section-${spineIndex}`,
      spineIndex,
      sectionId: attr(element, 'id') || `section-${spineIndex}`
    };
    if (
      resource.spineIndex !== spineIndex ||
      typeof resource.href !== 'string' ||
      typeof resource.sectionId !== 'string'
    )
      throw new Error('Invalid publication resource.');
    const parts: string[] = [];
    const legacy = { text: '', runs: [] as { source: number; target: number; length: number }[] };
    let count = 0;
    const separator = () => {
      if (count && parts.at(-1) !== '\n') {
        parts.push('\n');
        count++;
      }
    };
    const visit = (node: Node, depth: number) => {
      if (++nodes > 500000 || depth > 512) throw new Error('Book is too complex to search.');
      if (node.nodeName === '#text') {
        const value = node.value ?? '';
        if (value) {
          if (includeLegacy && value.trim()) {
            legacy.runs.push({ source: legacy.text.length, target: count, length: value.length });
            legacy.text += value;
          }
          parts.push(value);
          count += value.length;
          characters += value.length;
        }
        if (characters > 8 * 1024 * 1024)
          throw new Error('Book exceeds the local search text limit.');
        return;
      }
      const tag = node.tagName ?? '';
      if (
        excluded.has(tag) ||
        attr(node, 'hidden') !== undefined ||
        attr(node, 'aria-hidden') === 'true' ||
        /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(
          attr(node, 'style') ?? ''
        )
      )
        return;
      if (tag === 'br') return separator();
      if (blocks.has(tag)) separator();
      for (const child of node.childNodes ?? []) visit(child, depth + 1);
      if (blocks.has(tag)) separator();
    };
    for (const child of element.childNodes ?? []) visit(child, 0);
    if (parts.at(-1) === '\n') parts.pop();
    return { resource, text: parts.join(''), ...(includeLegacy ? { legacy } : {}) };
  });
}
export async function searchDigest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Grapheme normalization preserves the ORIGINAL quote, including kana, ligatures and astral characters. */
export async function findContent(
  resources: SearchResource[],
  query: string,
  book: SearchBook,
  cancelled: () => boolean = () => false,
  limit = 24
): Promise<{ hits: ContentHit[]; truncated: boolean }> {
  const needle = foldSearch(query.trim());
  if (!needle || [...query].length > 512) return { hits: [], truncated: false };
  const hits: ContentHit[] = [];
  const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
  for (const { text, resource } of resources) {
    if (cancelled()) return { hits: [], truncated: false };
    const starts: number[] = [],
      ends: number[] = [];
    let folded = '',
      point = 0,
      checkpoint = 0;
    // Off the UI thread. Yield regularly so a newer query can cancel this work.
    for (const item of segmenter.segment(text)) {
      const normalized = foldSearch(item.segment),
        next = point + [...item.segment].length;
      folded += normalized;
      for (let i = 0; i < normalized.length; i++) {
        starts.push(point);
        ends.push(next);
      }
      point = next;
      if (item.index - checkpoint >= 32768) {
        checkpoint = item.index;
        await yieldTask();
        if (cancelled()) return { hits: [], truncated: false };
      }
    }
    let at = folded.indexOf(needle),
      digest: string | undefined,
      prior = '';
    // UTF-16 positions for source code points are built once, not once per match.
    const offsets = [0];
    let offset = 0;
    for (const c of text) {
      offset += c.length;
      offsets.push(offset);
    }
    while (at !== -1) {
      const start = starts[at],
        end = ends[at + needle.length - 1];
      const identity = `${start}:${end}`;
      if (identity !== prior) {
        if (hits.length === limit) return { hits, truncated: true };
        digest ??= await searchDigest(text);
        if (cancelled()) return { hits: [], truncated: false };
        const slice = (from: number, to: number) =>
          text.slice(offsets[Math.max(0, from)], offsets[Math.min(point, to)]);
        hits.push({
          bookId: book.id,
          excerpt: slice(start - 48, end + 72),
          locator: {
            version: 1,
            bookKey: book.key,
            resource,
            projectionVersion: 2,
            resourceDigest: digest,
            start,
            end,
            quote: slice(start, end),
            prefix: slice(start - 32, start),
            suffix: slice(end, end + 32)
          }
        });
        prior = identity;
      }
      at = folded.indexOf(needle, at + 1);
    }
  }
  return { hits, truncated: false };
}
