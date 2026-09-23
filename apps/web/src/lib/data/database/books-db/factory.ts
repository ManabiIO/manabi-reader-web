/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type BooksDb from './versions/books-db';
import { openDB } from 'idb';
import upgradeBooksDbFromV2 from './versions/v2/upgrade';

export function createBooksDb(name = 'books') {
  return openDB<BooksDb>(name, 8, {
    async upgrade(oldDb, oldVersion, newVersion, transaction) {
      switch (oldVersion) {
        case 0: {
          const dataStore = oldDb.createObjectStore('data', {
            keyPath: 'id',
            autoIncrement: true
          });
          dataStore.createIndex('title', 'title');

          oldDb.createObjectStore('bookmark', {
            keyPath: 'dataId'
          });

          oldDb.createObjectStore('lastItem');

          oldDb.createObjectStore('storageSource', {
            keyPath: 'name'
          });

          const statisticsStore = oldDb.createObjectStore('statistic', {
            keyPath: ['title', 'dateKey']
          });

          statisticsStore.createIndex('dateKey', 'dateKey');
          statisticsStore.createIndex('completedBook', ['completedBook', 'title']);

          const readingGoalsStore = oldDb.createObjectStore('readingGoal', {
            keyPath: 'goalStartDate'
          });

          readingGoalsStore.createIndex('goalEndDate', 'goalEndDate');

          oldDb.createObjectStore('lastModified', {
            keyPath: ['title', 'dataType']
          });

          oldDb.createObjectStore('audioBook', { keyPath: 'title' });

          oldDb.createObjectStore('subtitle', { keyPath: 'title' });

          oldDb.createObjectStore('handle', { keyPath: ['title', 'dataType'] });

          break;
        }
        case 2: {
          await upgradeBooksDbFromV2(oldDb, oldVersion, newVersion, transaction);
          break;
        }
        case 3: {
          oldDb.createObjectStore('storageSource', {
            keyPath: 'name'
          });
          break;
        }
        case 4: {
          const statisticsStore = oldDb.createObjectStore('statistic', {
            keyPath: ['title', 'dateKey']
          });

          statisticsStore.createIndex('dateKey', 'dateKey');
          statisticsStore.createIndex('completedBook', ['completedBook', 'title']);

          const readingGoalsStore = oldDb.createObjectStore('readingGoal', {
            keyPath: 'goalStartDate'
          });

          readingGoalsStore.createIndex('goalEndDate', 'goalEndDate');

          oldDb.createObjectStore('lastModified', {
            keyPath: ['title', 'dataType']
          });

          break;
        }
        case 5: {
          oldDb.createObjectStore('audioBook', { keyPath: 'title' });

          oldDb.createObjectStore('subtitle', { keyPath: 'title' });

          oldDb.createObjectStore('handle', { keyPath: ['title', 'dataType'] });

          break;
        }
      }
      // Existing versions take different upgrade paths. These stores are common
      // to every path into v7 and require no parsing or network work in the transaction.
      if (oldVersion < 7) {
        oldDb.createObjectStore('readerLocalIdentity', { keyPath: 'bookId' });
        oldDb.createObjectStore('publication', { keyPath: 'bookId' });
        const annotations = oldDb.createObjectStore('readerAnnotation', { keyPath: 'id' });
        annotations.createIndex('bookKey', 'bookKey');
        annotations.createIndex('kind', 'kind');
        const outbox = oldDb.createObjectStore('readerAnnotationOutbox', { keyPath: 'id' });
        outbox.createIndex('accountId', 'accountId');
        outbox.createIndex('bookKey', 'bookKey');
        oldDb.createObjectStore('readerSyncState', { keyPath: 'accountId' });
        const conflicts = oldDb.createObjectStore('readerConflict', { keyPath: 'id' });
        conflicts.createIndex('bookKey', 'bookKey');
      }
      if (oldVersion < 8) {
        oldDb.createObjectStore('readerBookScope', { keyPath: 'bookId' });
        oldDb.createObjectStore('readerAnnotationScope', { keyPath: 'annotationId' });
        const records = oldDb.createObjectStore('readerPersonalRecord', { keyPath: 'id' });
        records.createIndex('accountId', 'accountId');
        records.createIndex('bookKey', 'bookKey');
        const outbox = oldDb.createObjectStore('readerPersonalOutbox', { keyPath: 'id' });
        outbox.createIndex('accountId', 'accountId');
        outbox.createIndex('bookKey', 'bookKey');
        const personalConflicts = oldDb.createObjectStore('readerPersonalConflict', {
          keyPath: 'id'
        });
        personalConflicts.createIndex('accountId', 'accountId');
        personalConflicts.createIndex('bookKey', 'bookKey');
      }
    }
  });
}
