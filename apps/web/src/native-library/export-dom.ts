/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase } from 'idb';
import type BooksDb from '../lib/data/database/books-db/versions/books-db';
import { BackupStorageHandler } from '../lib/data/storage/handler/backup-handler';
import { BaseStorageHandler } from '../lib/data/storage/handler/base-handler';
import { StorageDataType, StorageKey } from '../lib/data/storage/storage-types';
import { readNativeExportBook } from './export-records';
import type { BookAccessIdentity } from '../lib/data/database/books-db/book-identity';
import type { AdmittedBookReadAuthority } from '../lib/data/database/books-db/admitted-book-read';
import type { BookExportPart } from '../features/library/export-options';

/** Reuse the existing portable ZIP codec with admitted snapshots, never the
 * global browser source handler's unguarded numeric-ID/title reads. */
export async function createNativeBookArchive(
  db: IDBPDatabase<BooksDb>,
  identities: readonly BookAccessIdentity[],
  parts: readonly BookExportPart[],
  authority: AdmittedBookReadAuthority,
  progress: (completed: number) => void
) {
  const check = () => {
    authority.signal.throwIfAborted();
    authority.assertCurrent();
  };
  check();
  const folders = identities.map(({ title }) => BaseStorageHandler.sanitizeForFilename(title));
  if (
    new Set(folders).size !== folders.length ||
    folders.some(
      (folder, i) =>
        !folder ||
        folder === '.' ||
        folder === '..' ||
        BaseStorageHandler.desanitizeFilename(folder) !== identities[i].title
    )
  )
    throw new Error('These book titles cannot share one ZIP. Export each copy separately.');
  const handler = new BackupStorageHandler(window, StorageKey.BACKUP);
  try {
    check();
    let completed = 0;
    for (const identity of identities) {
      const record = await readNativeExportBook(db, identity, parts, authority);
      check();
      handler.startContext(
        { id: record.book.id, title: record.book.title, imagePath: '' },
        authority.signal
      );
      if (parts.includes(StorageDataType.DATA)) {
        await handler.saveBook(record.book);
        check();
        if (record.book.coverImage instanceof Blob) await handler.saveCover(record.book.coverImage);
      }
      if (record.progress) await handler.saveProgress(record.progress);
      if (record.statistics?.length)
        await handler.saveStatistics(
          record.statistics,
          record.statistics.reduce((latest, row) => Math.max(latest, row.lastStatisticModified), 0)
        );
      if (record.audioBook) await handler.saveAudioBook(record.audioBook);
      if (record.subtitle) await handler.saveSubtitleData(record.subtitle);
      check();
      progress(++completed);
    }
    const archive = await handler.finishExportZip(false, authority.signal);
    check();
    if (!archive) throw new Error('The selected books have no data for these export options.');
    return archive;
  } finally {
    // A failed/cancelled selection never presents a partial ZIP as a backup.
    await handler.finishExportZip(true);
  }
}
