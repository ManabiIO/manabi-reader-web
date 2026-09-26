/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BehaviorSubject } from 'rxjs';
import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';

export interface AutoScroller {
  wasAutoScrollerEnabled$: BehaviorSubject<boolean>;
  toggle: () => void;
  off: () => void;
}

export interface BookmarkManager {
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
  nextPage: () => void;

  prevPage: () => void;

  updateSectionDataByOffset: (offset: number) => void;
}

export interface PaginatedPageManager extends PageManager {
  flipPage: (multiplier: 1 | -1) => void;
  scrollTo: (scrollPos: number, isUser: boolean) => void;
}
