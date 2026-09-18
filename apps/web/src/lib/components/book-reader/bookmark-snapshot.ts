/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';

/** Undefined means "keep the previous bookmark", never "save the start". */
export function createBookmarkSnapshot(
  bookId: number,
  exploredCharCount: number,
  bookCharCount: number,
  scroll: { scrollX?: number; scrollY?: number } = {}
): BooksDbBookmarkData | undefined {
  if (
    !Number.isSafeInteger(bookId) ||
    bookId <= 0 ||
    !Number.isFinite(exploredCharCount) ||
    exploredCharCount < 0 ||
    !Number.isFinite(bookCharCount) ||
    bookCharCount < 0 ||
    exploredCharCount > bookCharCount ||
    Object.values(scroll).some((value) => !Number.isFinite(value))
  )
    return undefined;
  return {
    dataId: bookId,
    exploredCharCount,
    progress: bookCharCount === 0 ? 0 : exploredCharCount / bookCharCount,
    ...scroll,
    lastBookmarkModified: Date.now()
  };
}
