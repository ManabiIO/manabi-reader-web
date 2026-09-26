/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BlurMode } from '$lib/data/blur-mode';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { formatBookReadingContent } from './format-book-data-html';
import { sanitizeBookStyleSheet } from '../book-security/book-content-security';
import formatStyleSheet from './format-style-sheet';
import { map } from 'rxjs/operators';

export default function loadBookData(
  bookData: BooksDbBookData,
  parentSelector: string,
  document: Document,
  isPaginated: boolean,
  blurMode: BlurMode
) {
  return formatBookReadingContent(bookData, document, isPaginated, blurMode).pipe(
    map((content) => ({
      ...content,
      styleSheet: content.epubResources
        ? sanitizeBookStyleSheet(
            content.epubResources.map((resource) => resource.styleSheet).join('\n'),
            document,
            parentSelector
          )
        : formatStyleSheet(bookData, parentSelector, document)
    }))
  );
}
