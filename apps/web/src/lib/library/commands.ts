/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database } from '$lib/data/store';
import { calendarDay, validDay, type Completion } from './completion';

/** One transaction changes completion only. Scroll, bookmark, counts and statistics are untouched. */
export async function setCompletion(
  bookId: number,
  state: Completion['state'],
  day = calendarDay()
) {
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
    await bookmarks.put({ ...before, completion, lastBookmarkModified: modifiedAt });
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
