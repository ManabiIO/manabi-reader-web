/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { StoreNames } from 'idb';
import type BooksDb from './versions/books-db';

type KeyPath = string | string[] | null;
interface StoreSchema {
  keyPath: KeyPath;
  autoIncrement?: boolean;
  indexes?: Record<string, Exclude<KeyPath, null>>;
}

// Version 7 had two released shapes: byte-backed books alone, and the newer
// annotation schema. Version numbers cannot establish which stores are present.
// Keep one complete, additive schema for fresh, skipped and repair upgrades.
const schema: Record<StoreNames<BooksDb>, StoreSchema> = {
  data: { keyPath: 'id', autoIncrement: true, indexes: { title: 'title' } },
  bookmark: { keyPath: 'dataId' },
  lastItem: { keyPath: null },
  storageSource: { keyPath: 'name' },
  statistic: {
    keyPath: ['title', 'dateKey'],
    indexes: { dateKey: 'dateKey', completedBook: ['completedBook', 'title'] }
  },
  readingGoal: { keyPath: 'goalStartDate', indexes: { goalEndDate: 'goalEndDate' } },
  lastModified: { keyPath: ['title', 'dataType'] },
  audioBook: { keyPath: 'title' },
  subtitle: { keyPath: 'title' },
  handle: { keyPath: ['title', 'dataType'] },
  readerLocalIdentity: { keyPath: 'bookId' },
  publication: { keyPath: 'bookId' },
  readerAnnotation: { keyPath: 'id', indexes: { bookKey: 'bookKey', kind: 'kind' } },
  readerAnnotationOutbox: { keyPath: 'id', indexes: { accountId: 'accountId', bookKey: 'bookKey' } },
  readerSyncState: { keyPath: 'accountId' },
  readerConflict: { keyPath: 'id', indexes: { bookKey: 'bookKey' } },
  readerBookScope: { keyPath: 'bookId' },
  readerAnnotationScope: { keyPath: 'annotationId' },
  readerPersonalRecord: { keyPath: 'id', indexes: { accountId: 'accountId', bookKey: 'bookKey' } },
  readerPersonalOutbox: { keyPath: 'id', indexes: { accountId: 'accountId', bookKey: 'bookKey' } },
  readerPersonalConflict: { keyPath: 'id', indexes: { accountId: 'accountId', bookKey: 'bookKey' } },
  readerSearchProjection: { keyPath: 'bookId' },
  readerExternalSync: { keyPath: 'id' },
  readerImportRecord: { keyPath: 'id', indexes: { bookKey: 'bookKey' } },
  readerStatistic: { keyPath: ['bookKey', 'dateKey'], indexes: { dateKey: 'dateKey' } },
  readerStatisticMigration: { keyPath: 'title' }
};

function equalKeyPath(left: KeyPath, right: KeyPath) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Run synchronously in the existing versionchange transaction. Never rebuild
 * a store, change its keys, or read/re-encode book payloads. Incompatible schema
 * is an upgrade failure, not permission to discard the user's records.
 */
export function ensureBooksSchema(db: IDBDatabase, transaction: IDBTransaction): void {
  for (const [name, definition] of Object.entries(schema)) {
    const store = db.objectStoreNames.contains(name)
      ? transaction.objectStore(name)
      : db.createObjectStore(name, {
          keyPath: definition.keyPath,
          autoIncrement: definition.autoIncrement ?? false
        });
    if (
      !equalKeyPath(store.keyPath, definition.keyPath) ||
      store.autoIncrement !== (definition.autoIncrement ?? false)
    ) {
      throw new Error(`The local ${name} store has an incompatible schema. No data was changed.`);
    }
    for (const [indexName, keyPath] of Object.entries(definition.indexes ?? {})) {
      if (!store.indexNames.contains(indexName)) {
        store.createIndex(indexName, keyPath);
        continue;
      }
      const index = store.index(indexName);
      if (!equalKeyPath(index.keyPath, keyPath) || index.unique || index.multiEntry) {
        throw new Error(
          `The local ${name}/${indexName} index has an incompatible schema. No data was changed.`
        );
      }
    }
  }
}
