/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase } from 'idb';
import type BooksDb from '../lib/data/database/books-db/versions/books-db';
import { commitTransaction } from '../lib/data/database/books-db/commit-transaction.mjs';
import { assertBookPersonalAccess } from '../lib/data/database/books-db/book-records';
import { calendarDay, validDay, type Completion } from '../lib/library/completion';
import type { ShelfBook } from '../lib/library/view-model';
import type { LibraryAuthority } from './contract';
/** Completion changes are atomic across a bounded selection and do not rewrite reader position or statistics. */
export async function commitNativeCompletion(
  db: IDBPDatabase<BooksDb>,
  targets: ShelfBook[],
  state: 'reading' | 'finished',
  day: string | undefined,
  profileId: string | null,
  authority: LibraryAuthority
) {
  const finishedOn = day ?? calendarDay();
  if (
    !['reading', 'finished'].includes(state) ||
    (state === 'finished' && (!validDay(finishedOn) || finishedOn > calendarDay()))
  )
    throw new Error('Choose a valid finished date no later than today.');
  const snapshot = structuredClone(targets);
  if (
    !snapshot.length ||
    snapshot.length > 60 ||
    snapshot.some((book) => !Number.isSafeInteger(book.bookId) || book.bookId! < 1)
  )
    throw new Error('Invalid completion selection.');
  const check = () => {
    authority.signal.throwIfAborted();
    authority.assertCurrent();
  };
  check();
  const tx = db.transaction(['data', 'bookmark', 'readerBookScope'], 'readwrite');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  authority.signal.addEventListener('abort', abort, { once: true });
  try {
    await commitTransaction(tx, async () => {
      for (const target of snapshot) {
        check();
        const book = await tx.objectStore('data').get(target.bookId!);
        if (
          !book ||
          book.contentHash !== target.contentHash ||
          book.title !== target.canonicalTitle ||
          book.lastBookModified !== target.lastBookModified
        )
          throw new Error('A selected book changed. Refresh before saving.');
        const owner = await tx.objectStore('readerBookScope').get(book.id);
        assertBookPersonalAccess(book, owner, profileId);
        const bookmarks = tx.objectStore('bookmark');
        const before = (await bookmarks.get(book.id)) ?? {
          dataId: book.id,
          progress: 0,
          lastBookmarkModified: 0
        };
        const modifiedAt = Math.max(
          Date.now(),
          (before.completion?.modifiedAt ?? 0) + 1,
          before.lastBookmarkModified + 1
        );
        const completion: Completion =
          state === 'finished' ? { state, finishedOn, modifiedAt } : { state, modifiedAt };
        check();
        await bookmarks.put({ ...before, completion, lastBookmarkModified: modifiedAt });
        check();
      }
    });
  } finally {
    authority.signal.removeEventListener('abort', abort);
  }
}
