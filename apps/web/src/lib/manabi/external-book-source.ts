/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** TTU titles identify folders, not globally interchangeable book contents. */
export function assertExternalBookSource(
  book: { storageSource?: string } | undefined,
  sourceName: string
): void {
  if (book && book.storageSource !== sourceName) {
    throw new Error(
      'A different local copy already uses this title. Open that copy from Books, or rename it before importing from this library. No book or reading history was changed.'
    );
  }
}
