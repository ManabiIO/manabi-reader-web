/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';

export type ReaderSourceFormat = 'epub' | 'htmlz' | 'txt' | 'unknown';

/**
 * Older records predate sourceFormat. Their publication manifests retain the
 * loader-specific resource IDs needed to keep the Foliate path EPUB-only.
 */
export function readerSourceFormat(book: BooksDbBookData): ReaderSourceFormat {
  if (book.sourceFormat) return book.sourceFormat;
  const hrefs = book.publicationManifest?.resources.map((resource) => resource.href) ?? [];
  if (!hrefs.length) return 'unknown';
  if (hrefs.length === 1 && hrefs[0] === 'htmlz:body') return 'htmlz';
  if (hrefs.every((href) => /^legacy-section-\d+$/.test(href))) return 'txt';
  if (hrefs.every((href) => !href.includes(':') && !href.startsWith('legacy-section-'))) return 'epub';
  return 'unknown';
}

export function isEpubReaderBook(book: BooksDbBookData): boolean {
  return readerSourceFormat(book) === 'epub';
}
