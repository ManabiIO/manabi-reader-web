/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  foldSearch,
  searchMatchRange,
  sortSearchText,
  type SearchTextFields
} from '../library/search-normalization.ts';
import {
  bookTitleMatchDetail,
  bookTitleSearchFields,
  type BookTitleMatchContext
} from './book-title-match-text.ts';
import { formatMediaTime } from '../media/time.ts';
import type { ContentKey } from '../media/contracts';
import type { VideoTitleHit, VideoTranscriptHit } from '../media/video-search';
import type { ShelfBook } from '../library/view-model';
import type { ContentHit } from '../library/content-search';
import type { ReaderLocator } from '../reader-location';
import { fold as foldSnippetSearch, type SnippetHit } from '../snippets/document';
import type { SnippetSummary } from '../snippets/summary';

/** Navigation is data. The UI decides how to open it; matching never rewrites locators. */
export type SearchTarget =
  | { kind: 'book'; book: ShelfBook; locator?: ReaderLocator }
  | { kind: 'snippet'; snippet: SnippetSummary; hit?: SnippetHit }
  | { kind: 'video'; key: ContentKey; time?: number; track?: string };

export interface SearchRow {
  id: string;
  kind: 'Book' | 'Video' | 'Snippet';
  title: string;
  label: string;
  detail?: string;
  detailMatch?: { start: number; end: number };
  titleMatch?: { start: number; end: number };
  /** Search-only metadata used for relevance; never rendered directly. */
  searchText?: SearchTextFields;
  excerpt?: string;
  match?: { start: number; end: number };
  target: SearchTarget;
}

export function bookTitleRows(
  books: readonly ShelfBook[],
  contexts: Readonly<Record<string, readonly BookTitleMatchContext[]>>,
  query: string
): SearchRow[] {
  return books.map((book) => {
    const titleMatch = searchMatchRange(book.title, query);
    const detail = bookTitleMatchDetail(book, contexts[book.key] ?? [], query);
    // Highlight the metadata value, not its presentation label ("Author · ").
    const separator = detail?.indexOf(' · ') ?? -1;
    const detailStart = !titleMatch && separator >= 0 ? separator + 3 : 0;
    const detailMatch = detail ? searchMatchRange(detail.slice(detailStart), query) : undefined;
    return {
      id: `book:${book.key}`,
      kind: 'Book',
      title: book.title,
      label: `Read ${book.title}`,
      detail,
      titleMatch,
      detailMatch: detailMatch
        ? { start: detailMatch.start + detailStart, end: detailMatch.end + detailStart }
        : undefined,
      searchText: bookTitleSearchFields(book, contexts[book.key] ?? []),
      target: { kind: 'book', book }
    };
  });
}

function snippetTitleMatchRange(
  value: string,
  query: string
): { start: number; end: number } | undefined {
  const needle = foldSnippetSearch(query.trim());
  if (!needle) return;
  let normalized = '';
  const starts: number[] = [],
    ends: number[] = [];
  for (const part of new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(value)) {
    const folded = foldSnippetSearch(part.segment);
    normalized += folded;
    for (let index = 0; index < folded.length; index++) {
      starts.push(part.index);
      ends.push(part.index + part.segment.length);
    }
  }
  const found = normalized.indexOf(needle);
  if (found < 0) return;
  return {
    start: starts[found] ?? 0,
    end: ends[found + needle.length - 1] ?? value.length
  };
}

export function snippetTitleRows(snippets: readonly SnippetSummary[], query: string): SearchRow[] {
  const needle = foldSnippetSearch(query.trim());
  return snippets
    .filter((item) => foldSnippetSearch(item.title).includes(needle))
    .map((snippet) => ({
      id: `snippet:${snippet.key}`,
      kind: 'Snippet',
      title: snippet.title,
      label: `Read snippet ${snippet.title}`,
      titleMatch: snippetTitleMatchRange(snippet.title, query),
      // Generic cross-source ranking does not fold Kana. Give it both the
      // original title and Snippets' Kana-folded search form so either script
      // receives real relevance instead of an unmatched fallback tier.
      searchText: { primary: [snippet.title, foldSnippetSearch(snippet.title)] },
      target: { kind: 'snippet', snippet }
    }));
}
export function scopedSnippetTitleRows(
  snippets: readonly SnippetSummary[],
  query: string,
  guard: () => void
): { rows: SearchRow[]; failed: number } {
  try {
    guard();
    return { rows: snippetTitleRows(snippets, query), failed: 0 };
  } catch {
    return { rows: [], failed: 1 };
  }
}

export function videoTitleRows(hits: readonly VideoTitleHit[], query: string): SearchRow[] {
  return hits.map((hit) => ({
    id: `video:${hit.key}`,
    kind: 'Video',
    title: hit.title,
    label: `Open video ${hit.title}`,
    detail: hit.duration > 0 ? formatMediaTime(hit.duration) : undefined,
    titleMatch: searchMatchRange(hit.title, query),
    target: { kind: 'video', key: hit.key }
  }));
}

export function sortTitleRows(rows: readonly SearchRow[], query: string): SearchRow[] {
  return sortSearchText(rows, query, (row) => row.searchText ?? row.title);
}

export function bookContentRows(
  hits: readonly ContentHit[],
  books: ReadonlyMap<number, ShelfBook>
): SearchRow[] {
  return hits.flatMap((hit) => {
    const book = books.get(hit.bookId);
    return book
      ? [
          {
            id: `book:${book.key}:${hit.locator.resource.spineIndex}:${hit.locator.start}`,
            kind: 'Book' as const,
            title: book.title,
            label: `Open passage in ${book.title}: ${hit.locator.quote}`,
            detail: `Section ${hit.locator.resource.spineIndex + 1}`,
            excerpt: hit.excerpt,
            match: hit.excerptMatch,
            target: { kind: 'book' as const, book, locator: hit.locator }
          }
        ]
      : [];
  });
}

export function snippetContentRows(
  hits: ReadonlyMap<string, readonly SnippetHit[]>,
  snippets: readonly SnippetSummary[]
): SearchRow[] {
  return snippets.flatMap((snippet) =>
    (hits.get(snippet.id) ?? []).map((hit) => ({
      id: `snippet:${snippet.key}:${hit.locator.blockId}:${hit.locator.offset}`,
      kind: 'Snippet',
      title: snippet.title,
      label: `Open passage in ${snippet.title}: ${hit.locator.quote}`,
      detail: hit.reading ? 'Furigana match' : undefined,
      excerpt: hit.excerpt,
      match: hit.excerptMatch,
      target: { kind: 'snippet', snippet, hit }
    }))
  );
}

export function videoContentRows(hits: readonly VideoTranscriptHit[]): SearchRow[] {
  return hits.map((hit) => ({
    id: `video:${hit.key}:${hit.trackId}:${hit.cueId}`,
    kind: 'Video',
    title: hit.title,
    label: `Open transcript in ${hit.title} at ${formatMediaTime(hit.time)}: ${hit.text}`,
    detail: `${formatMediaTime(hit.time)} · ${hit.trackLabel || hit.language}`,
    excerpt: hit.text,
    match: hit.match,
    target: { kind: 'video', key: hit.key, time: hit.time, track: hit.trackId }
  }));
}
