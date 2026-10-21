/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase } from 'idb';
import type BooksDb from '../lib/data/database/books-db/versions/books-db';
import {
  snapshotBookAccessIdentity,
  assertBookAccessIdentity,
  type BookAccessIdentity
} from '../lib/data/database/books-db/book-identity';
import type { AdmittedBookReadAuthority } from '../lib/data/database/books-db/admitted-book-read';
import { assertBookPersonalAccess } from '../lib/data/database/books-db/book-records';
import { decodeBook } from '../lib/data/database/books-db/book-binary';
import { commitTransaction } from '../lib/data/database/books-db/commit-transaction.mjs';
import {
  migrateLegacyStatistics,
  statisticRange
} from '../lib/data/database/books-db/reader-statistics';
import { contentHashPrimaryKeys } from '../lib/data/database/books-db/content-hash-index';
import { StorageDataType } from '../lib/data/storage/storage-types';
import type { BookExportPart } from '../features/library/export-options';

/** Read the selected physical copy and associated records in one guarded transaction.
 * Never turn a native numeric ID or title into authority. One book is held at a time.
 */
export async function readNativeExportBook(
  db: IDBPDatabase<BooksDb>,
  identity: BookAccessIdentity,
  parts: readonly BookExportPart[],
  authority: AdmittedBookReadAuthority
) {
  const expected = snapshotBookAccessIdentity(identity);
  if (!expected.readerBookKey) throw new Error('Refresh the Library before exporting this book.');
  const { signal, profileId } = authority;
  const check = () => {
    signal.throwIfAborted();
    authority.assertCurrent();
  };
  check();
  if (parts.includes(StorageDataType.STATISTICS)) {
    await migrateLegacyStatistics(
      db,
      {
        id: expected.bookId,
        title: expected.title,
        contentHash: expected.contentHash
      },
      {
        signal,
        assertCurrent: check,
        validate(book, owner) {
          assertBookAccessIdentity(book, { ...expected, readerBookKey: undefined });
          if (book) assertBookPersonalAccess(book, owner, profileId);
        },
        validateIdentity: (book, local) => assertBookAccessIdentity(book, expected, local),
        validateCopy: (book, owner) => assertBookPersonalAccess(book, owner, profileId),
        validateTitleCopy: (book, owner) => assertBookPersonalAccess(book, owner, profileId)
      }
    );
    check();
  }
  const tx = db.transaction(
    [
      'data',
      'bookmark',
      'readerBookScope',
      'readerLocalIdentity',
      'readerStatistic',
      'readerStatisticMigration',
      'audioBook',
      'subtitle'
    ],
    'readonly'
  );
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already completed. */
    }
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const snapshot = await commitTransaction(tx, async () => {
      check();
      const data = tx.objectStore('data');
      const book = await data.get(expected.bookId);
      const owner = await tx.objectStore('readerBookScope').get(expected.bookId);
      const local = await tx.objectStore('readerLocalIdentity').get(expected.bookId);
      check();
      assertBookAccessIdentity(book, expected, local);
      if (!book?.elementHtml) throw new Error('Only available imported books can be exported.');
      assertBookPersonalAccess(book, owner, profileId);
      const progress = parts.includes(StorageDataType.PROGRESS)
        ? await tx.objectStore('bookmark').get(book.id)
        : undefined;
      const audioBook = parts.includes(StorageDataType.AUDIOBOOK)
        ? await tx.objectStore('audioBook').get(book.title)
        : undefined;
      const subtitle = parts.includes(StorageDataType.SUBTITLE)
        ? await tx.objectStore('subtitle').get(book.title)
        : undefined;
      // These older stores have title keys only. A second copy cannot prove
      // ownership, even if its current title happens to match the selection.
      if ((audioBook || subtitle) && (await data.index('title').count(book.title)) !== 1)
        throw new Error(
          `Audiobook or subtitles for “${book.title}” cannot be assigned to one copy. Export without those options.`
        );
      let statistics: BooksDb['statistic']['value'][] | undefined;
      if (parts.includes(StorageDataType.STATISTICS)) {
        const receipt = await tx.objectStore('readerStatisticMigration').get(book.title);
        if (receipt?.state === 'ambiguous' || receipt?.state === 'identity-conflict')
          throw new Error(
            `Older statistics for “${book.title}” need review. Export without Statistics or use the web recovery export.`
          );
        // Content-keyed history can be shared by multiple physical copies. Check
        // all their owners within this read, not just before legacy migration.
        if (expected.readerBookKey!.startsWith('content:')) {
          const ids = await contentHashPrimaryKeys(
            data.index('contentHash'),
            book.contentHash!,
            check,
            signal
          );
          for (const id of ids) {
            const copy = await data.get(id);
            const copyOwner = await tx.objectStore('readerBookScope').get(id);
            check();
            if (copy) assertBookPersonalAccess(copy, copyOwner, profileId);
          }
        }
        if (
          local &&
          expected.readerBookKey !== `local:${local.uuid}` &&
          (await tx.objectStore('readerStatistic').count(statisticRange(`local:${local.uuid}`)))
        )
          throw new Error(`Conflicting statistics for “${book.title}” need a web recovery export.`);
        statistics = (
          await tx.objectStore('readerStatistic').getAll(statisticRange(expected.readerBookKey!))
        ).map(({ bookKey: _key, ...row }) => ({ ...row, title: book.title }));
      }
      check();
      return { book, progress, statistics, audioBook, subtitle };
    });
    check();
    return { ...snapshot, book: decodeBook(snapshot.book) };
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
