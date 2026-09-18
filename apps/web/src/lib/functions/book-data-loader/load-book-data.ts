/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BlurMode } from '$lib/data/blur-mode';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import formatBookDataHtml from './format-book-data-html';
import formatStyleSheet from './format-style-sheet';
import { map } from 'rxjs/operators';
import { sanitizeBookHtml, sanitizeBookCss } from '$lib/manabi/sanitize-book';

export default function loadBookData(
  bookData: BooksDbBookData,
  parentSelector: string,
  document: Document,
  isPaginated: boolean,
  blurMode: BlurMode
) {
  // This also protects older books restored from backups, not just new imports.
  const safeBook = {
    ...bookData,
    elementHtml: sanitizeBookHtml(bookData.elementHtml),
    styleSheet: sanitizeBookCss(bookData.styleSheet)
  };
  return formatBookDataHtml(safeBook, document, isPaginated, blurMode).pipe(
    map((htmlContent) => ({
      htmlContent: sanitizeBookHtml(htmlContent),
      styleSheet: formatStyleSheet(safeBook, parentSelector)
    }))
  );
}
