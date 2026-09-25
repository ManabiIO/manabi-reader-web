/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { foldSearch, maxQueryPoints } from './text.ts';
export interface BookMetadata {
  key: string;
  title: string;
  canonicalTitle: string;
  creators?: { name: string }[];
}
export function metadataMatches<T extends BookMetadata>(
  books: T[],
  query: string,
  labels: Record<string, string[]> = {}
): T[] {
  const needle = foldSearch(query.trim());
  if (!needle || [...query].length > maxQueryPoints) return [];
  const terms = needle.split(/\s+/u);
  return books
    .flatMap((book, order) => {
      const title = foldSearch(book.title),
        canonical = foldSearch(book.canonicalTitle);
      const other = [...(book.creators ?? []).map((c) => c.name), ...(labels[book.key] ?? [])].map(
        foldSearch
      );
      if (
        !terms.every((term) => [title, canonical, ...other].some((value) => value.includes(term)))
      )
        return [];
      const rank =
        title === needle || canonical === needle
          ? 0
          : title.startsWith(needle)
            ? 1
            : title.includes(needle)
              ? 2
              : 3;
      return [{ book, order, rank }];
    })
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((item) => item.book);
}
