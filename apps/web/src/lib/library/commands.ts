/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database } from '$lib/data/store';
import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
import { calendarDay, validDay, type Completion } from './completion';

/** Change completion, optionally with a matching reader snapshot, without touching statistics. */
export async function setCompletion(
  bookId: number,
  state: Completion['state'],
  day = calendarDay(),
  bookmark?: BooksDbBookmarkData
) {
  if (bookmark && bookmark.dataId !== bookId)
    throw new Error('The completion bookmark belongs to a different book.');
  if (state === 'finished' && (!validDay(day) || day > calendarDay()))
    throw new Error('Choose a valid finished date no later than today.');
  const db = await database.db;
  const tx = db.transaction(['data', 'bookmark'], 'readwrite');
  try {
    if (!(await tx.objectStore('data').get(bookId)))
      throw new Error('This book is no longer in the library.');
    const bookmarks = tx.objectStore('bookmark');
    const before = (await bookmarks.get(bookId)) ?? {
      dataId: bookId,
      progress: 0,
      lastBookmarkModified: 0
    };
    const modifiedAt = Math.max(
      Date.now(),
      (before.completion?.modifiedAt ?? 0) + 1,
      before.lastBookmarkModified + 1
    );
    const completion: Completion =
      state === 'finished' ? { state, finishedOn: day, modifiedAt } : { state, modifiedAt };
    await bookmarks.put({
      ...before,
      ...bookmark,
      completion,
      lastBookmarkModified: Math.max(bookmark?.lastBookmarkModified ?? 0, modifiedAt)
    });
    await tx.done;
    database.bookmarksChanged$.next();
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* already aborted */
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
