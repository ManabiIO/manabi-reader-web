/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BehaviorSubject } from 'rxjs';
import type { ReaderLocator } from '$lib/reader-location';
import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';

export interface AutoScroller {
  wasAutoScrollerEnabled$: BehaviorSubject<boolean>;
  toggle: () => void;
  off: () => void;
}

export interface BookmarkManager {
  captureBookmarkLocation?: (range?: Range) => Promise<ReaderLocator | undefined>;

  formatBookmarkData: (
    bookId: number,
    customReadingPointScrollOffset: number
  ) => BooksDbBookmarkData | undefined;

  formatBookmarkDataByRange: (
    bookId: number,
    customReadingPointRange: Range | undefined
  ) => BooksDbBookmarkData | undefined;

  scrollToBookmark: (
    bookmarkData: BooksDbBookmarkData,
    customReadingPointScrollOffset?: number
  ) => void;
}

export interface PageManager {
  nextPage: (input?: { repeat?: boolean; key?: string }) => void;

  prevPage: (input?: { repeat?: boolean; key?: string }) => void;

  updateSectionDataByOffset: (offset: number) => void;
}
