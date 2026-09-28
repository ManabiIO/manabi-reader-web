/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database } from '$lib/data/store';
import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
import { calendarDay, validDay, type Completion } from './completion';
import { captureLibraryOperation } from '$lib/manabi/operation-scope';
import { commitTransaction } from '$lib/data/database/books-db/commit-transaction.mjs';

/** Change completion, optionally with a matching reader snapshot, without touching statistics. */
export async function setCompletion(
  bookId: number,
  state: Completion['state'],
  day = calendarDay(),
  bookmark?: BooksDbBookmarkData
) {
  if (!Number.isSafeInteger(bookId) || bookId <= 0 || !['finished', 'reading'].includes(state))
    throw new Error('The completion target or state is invalid.');
  if (bookmark && bookmark.dataId !== bookId)
    throw new Error('The completion bookmark belongs to a different book.');
  if (state === 'finished' && (!validDay(day) || day > calendarDay()))
    throw new Error('Choose a valid finished date no later than today.');
  // Own the snapshot before the first suspension; caller mutations cannot
  // change the target dataId or progress while the transaction is being opened.
  const snapshot = bookmark ? structuredClone(bookmark) : undefined;
  const scope = captureLibraryOperation();
  try {
    const db = await database.db;
    scope.assertCurrent();
    const tx = db.transaction(['data', 'bookmark'], 'readwrite');
    const abort = () => {
      try {
        tx.abort();
      } catch {
        /* Already settled. */
      }
    };
    scope.signal.addEventListener('abort', abort, { once: true });
    try {
      await commitTransaction(tx, async () => {
        scope.assertCurrent();
        const book = await tx.objectStore('data').get(bookId);
        if (!book) throw new Error('This book is no longer in the library.');
        if (book.libraryOwner !== undefined && book.libraryOwner !== scope.profileId)
          throw new Error('This book belongs to another account.');
        const bookmarks = tx.objectStore('bookmark');
        const before = (await bookmarks.get(bookId)) ?? {
          dataId: bookId,
          progress: 0,
          lastBookmarkModified: 0
        };
        scope.assertCurrent();
        const modifiedAt = Math.max(
          Date.now(),
          (before.completion?.modifiedAt ?? 0) + 1,
          before.lastBookmarkModified + 1
        );
        const completion: Completion =
          state === 'finished' ? { state, finishedOn: day, modifiedAt } : { state, modifiedAt };
        await bookmarks.put({
          ...before,
          ...snapshot,
          dataId: bookId,
          completion,
          lastBookmarkModified: Math.max(snapshot?.lastBookmarkModified ?? 0, modifiedAt)
        });
        scope.assertCurrent();
      });
      database.bookmarksChanged$.next();
    } finally {
      scope.signal.removeEventListener('abort', abort);
    }
  } finally {
    scope.stop();
  }
}
