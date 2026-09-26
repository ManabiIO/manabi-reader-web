/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { encodeBook, decodeBook } from './book-binary';
import { mergeCompletion } from '$lib/library/completion';
import {
  contentStatisticKey,
  migrateLegacyStatistics,
  preserveCompletedStatistic,
  statisticRange,
  visibleStatistics
} from './reader-statistics';
import { commitTransaction, explainBookStorageError } from './commit-transaction.mjs';
import type {
  BooksDbAudioBook,
  BooksDbBookData,
  BooksDbBookmarkData,
  BooksDbReadingGoal,
  BooksDbStatistic,
  BooksDbStorageSource,
  BooksDbSubtitleData
} from '$lib/data/database/books-db/versions/books-db';
import { Observable, Subject, from } from 'rxjs';
import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
import {
  advanceDateDays,
  getDate,
  getDateKey,
  mergeStatistics,
  updateStatisticToStore
} from '$lib/functions/statistic-util';
import { catchError, map, shareReplay, startWith, switchMap, tap } from 'rxjs/operators';
import {
  getCurrentReadingGoal,
  mergeReadingGoals,
  readingGoalSortFunction
} from '$lib/data/reading-goal';
import { lastReadingGoalsModified$, readingGoal$, syncTarget$ } from '$lib/data/store';

import type { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import type { BookStatistic } from '$lib/components/statistics/statistics-types';
import type BooksDb from '$lib/data/database/books-db/versions/books-db';
import type { IDBPDatabase } from 'idb';
import LogReportDialog from '$lib/components/log-report-dialog.svelte';
import { MergeMode } from '$lib/data/merge-mode';
import MessageDialog from '$lib/components/message-dialog.svelte';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import { dialogManager } from '$lib/data/dialog-manager';
import { getDefaultStatistic } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { handleErrorDuringReplication } from '$lib/functions/replication/error-handler';
import { iffBrowser } from '$lib/functions/rxjs/iff-browser';
import { logger } from '$lib/data/logger';
import pLimit from 'p-limit';
import { replicationProgress$ } from '$lib/functions/replication/replication-progress';
import { setStorageSourceDefault } from '$lib/data/storage/storage-source-manager';
import { storageSource$ } from '$lib/data/storage/storage-view';
import { throwIfAborted } from '$lib/functions/replication/replication-error';

const LAST_ITEM_KEY = 0;

export class DatabaseService {
  private db$: Observable<Awaited<typeof this.db>>;

  isReady$: Observable<boolean>;

  listLoading$ = new Subject<boolean>();

  dataListChanged$ = new Subject<BaseStorageHandler | undefined>();

  lastHandler: BaseStorageHandler | undefined;

  dataList$ = iffBrowser(() =>
    this.dataListChanged$.pipe(
      startWith(undefined),
      tap((handler) => {
        this.lastHandler = handler;
      }),
      switchMap(() => storageSource$),
      switchMap((storageSource) =>
        from(
          Promise.resolve(this.lastHandler || getStorageHandler(window, storageSource, '')).then(
            (handler) => {
              logger.clearHistory();

              return handler.getBookList();
            }
          )
        ).pipe(
          catchError((error: unknown) => {
            if (error instanceof Error) {
              const showReport = logger.errorCount > 1;

              logger.warn(error.message);

              dialogManager.dialogs$.next([
                {
                  component: showReport ? LogReportDialog : MessageDialog,
                  props: {
                    title: 'Failure',
                    message: showReport ? 'Error(s) occurred' : `An Error occured: ${error.message}`
                  }
                }
              ]);
            }

            if (storageSource !== StorageKey.BROWSER) {
              this.lastHandler = undefined;
              storageSource$.next(StorageKey.BROWSER);
            }

            return [[]];
          })
        )
      ),
      tap(() => {
        this.lastHandler = undefined;
        this.listLoading$.next(false);
      }),
      shareReplay({ refCount: true, bufferSize: 1 })
    )
  );

  bookmarksChanged$ = new Subject<void>();

  bookmarks$ = this.bookmarksChanged$.pipe(
    startWith(0),
    switchMap(() => this.db$),
    switchMap((db) => db.getAll('bookmark')),
    shareReplay({ refCount: true, bufferSize: 1 })
  );

  lastItemChanged$ = new Subject<void>();

  lastItem$ = this.lastItemChanged$.pipe(
    startWith(0),
    switchMap(() => this.db$),
    switchMap((db) => db.get('lastItem', LAST_ITEM_KEY)),
    shareReplay({ refCount: true, bufferSize: 1 })
  );

  storageSourcesChanged$ = new Subject<BooksDbStorageSource[]>();

  constructor(public db: Promise<IDBPDatabase<BooksDb>>) {
    this.db$ = from(db).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
    this.isReady$ = this.db$.pipe(map((x) => !!x));
  }

  async getLastModifiedForType(title: string, dataType: string) {
    const db = await this.db;
    const result = await db.get('lastModified', [title, dataType]);

    return result?.lastModifiedValue || 0;
  }

  async getData(dataId: number) {
    if (!Number.isNaN(dataId)) {
      const db = await this.db;
      const book = await db.get('data', dataId);
      return book ? decodeBook(book) : undefined;
    }
    return undefined;
  }

  async getDataByTitle(title: string) {
    if (title) {
      const db = await this.db;
      const book = await db.getFromIndex('data', 'title', title);
      return book ? decodeBook(book) : undefined;
    }

    return undefined;
  }

  async setFirstBookRead(
    bookTitle: string,
    startDaysHoursForTracker: number,
    existingStatistic?: BooksDbStatistic,
    bookId?: number
  ) {
    const db = await this.db;

    if (bookId) {
      const book = await db.get('data', bookId);
      if (!book || book.title !== bookTitle) throw new Error('The tracked book changed.');
      const bookKey = await migrateLegacyStatistics(db, book);
      const first = existingStatistic ?? (await db.get('readerStatistic', statisticRange(bookKey)));
      if (first) return [first.dateKey, false];
      const dateKey = getDateKey(startDaysHoursForTracker);
      const statistic = { ...getDefaultStatistic(bookTitle, dateKey), bookKey };
      const tx = db.transaction(['readerStatistic', 'lastModified'], 'readwrite');
      await tx.objectStore('readerStatistic').put(statistic);
      await tx.objectStore('lastModified').put({
        title: bookKey,
        dataType: StorageDataType.STATISTICS,
        lastModifiedValue: statistic.lastStatisticModified
      });
      await tx.done;
      return [dateKey, true];
    }

    let firstStatistic = existingStatistic;

    if (!firstStatistic) {
      firstStatistic = await db.get('statistic', IDBKeyRange.bound([bookTitle], [bookTitle, []]));
    }

    if (firstStatistic) {
      return [firstStatistic.dateKey, false];
    }

    const dateKey = getDateKey(startDaysHoursForTracker);
    const tx = db.transaction(['statistic', 'lastModified'], 'readwrite');

    try {
      const statisticsStore = tx.objectStore('statistic');
      const lastModifiedStore = tx.objectStore('lastModified');
      const newStatistic = getDefaultStatistic(bookTitle, dateKey);

      await statisticsStore.put(newStatistic);
      await lastModifiedStore.put({
        title: bookTitle,
        dataType: StorageDataType.STATISTICS,
        lastModifiedValue: newStatistic.lastStatisticModified
      });

      await tx.done;
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }

    return [dateKey, true];
  }

  async upsertData(
    data: Omit<BooksDbBookData, 'id'>,
    saveBehavior: ReplicationSaveBehavior,
    skipTimestampFallback = true,
    removeStorageContext = true,
    signal?: AbortSignal
  ) {
    throwIfAborted(signal);
    const db = await this.db;

    const stored = await encodeBook(data);
    throwIfAborted(signal);
    const tx = db.transaction('data', 'readwrite');
    const abort = () => {
      try {
        tx.abort();
      } catch {
        /* A committed transaction cannot be undone. */
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    return commitTransaction(tx, async () => {
      throwIfAborted(signal);
      let dataId: number;
      let bookData: BooksDbBookData;

      const { store } = tx;
      const titleMatches = await store.index('title').getAll(data.title);
      // Verified source identity must survive imports of different books sharing a title.
      const oldData = data.contentHash
        ? titleMatches.find(
            (book) => book.contentHash?.toLowerCase() === data.contentHash?.toLowerCase()
          )
        : titleMatches.find((book) => !book.contentHash);

      if (oldData) {
        if (removeStorageContext) {
          oldData.storageSource = undefined;
        }

        if (
          saveBehavior === ReplicationSaveBehavior.NewOnly &&
          oldData.lastBookModified &&
          data.lastBookModified &&
          oldData.lastBookModified >= data.lastBookModified &&
          (oldData.lastBookOpen || 0) >= (data.lastBookOpen || 0)
        ) {
          bookData = decodeBook(oldData);
          dataId = oldData.id;
        } else {
          bookData = {
            ...data,
            id: oldData.id,
            ...(skipTimestampFallback
              ? { lastBookModified: data.lastBookModified, lastBookOpen: data.lastBookOpen }
              : {
                  lastBookModified: data.lastBookModified || oldData.lastBookModified,
                  lastBookOpen: data.lastBookOpen || oldData.lastBookOpen
                }),
            ...(removeStorageContext ? { storageSource: undefined } : {})
          };
          dataId = await store.put({
            ...bookData,
            blobs: stored.blobs,
            coverImage: stored.coverImage
          });
        }
      } else {
        // Until https://github.com/jakearchibald/idb/issues/150 resolves
        dataId = await store.add(stored as typeof stored & { id: number });
        bookData = { ...data, id: dataId };
      }

      return bookData;
    })
      .catch((error) => {
        throwIfAborted(signal);
        throw explainBookStorageError(error);
      })
      .finally(() => signal?.removeEventListener('abort', abort));
  }

  async deleteData(
    dataIds: number[],
    _idsToTitles: Map<number, string>,
    cancelSignal: AbortSignal,
    keepLocalStatistics: boolean
  ) {
    // Snapshot the selected IDs, not their mutable title/resume metadata.
    const selectedIds = [...new Set(dataIds)];
    const db = await this.db;
    const deleted: number[] = [];
    const limiter = pLimit(1);
    const tasks: Promise<void>[] = [];

    let errorMessage = '';

    replicationProgress$.next({ progressBase: 1, maxProgress: selectedIds.length });

    selectedIds.forEach((id) =>
      tasks.push(
        limiter(async () => {
          try {
            throwIfAborted(cancelSignal);

            deleted.push(await this.deleteSingleData(db, id, !keepLocalStatistics));
          } catch (error) {
            errorMessage = handleErrorDuringReplication(
              error,
              `Error deleting Book with id ${id}: `,
              [limiter]
            );
          }
        })
      )
    );

    await Promise.all(tasks).catch(() => {});

    return { error: errorMessage, deleted };
  }

  async getBookmark(dataId: number) {
    const db = await this.db;
    return db.get('bookmark', dataId);
  }

  async putBookmark(bookmarkData: BooksDbBookmarkData) {
    const db = await this.db;

    const tx = db.transaction('bookmark', 'readwrite');
    return commitTransaction(tx, async () => {
      const before = await tx.store.get(bookmarkData.dataId);
      return tx.store.put(mergeCompletion(before, bookmarkData));
    });
  }

  async putAudioBook(audioBook: BooksDbAudioBook) {
    const db = await this.db;

    return db.put('audioBook', audioBook);
  }

  async putSubtitleData(subtitleData: BooksDbSubtitleData) {
    const db = await this.db;

    return db.put('subtitle', subtitleData);
  }

  async putLastItem(dataId: number) {
    const db = await this.db;
    const result = await db.put('lastItem', { dataId }, LAST_ITEM_KEY);
    this.lastItemChanged$.next();
    return result;
  }

  async deleteLastItem() {
    const db = await this.db;
    await db.delete('lastItem', LAST_ITEM_KEY);
    this.lastItemChanged$.next();
  }

  private async deleteSingleData(
    db: IDBPDatabase<BooksDb>,
    dataId: number,
    shouldDeleteStatistics: boolean
  ) {
    const storeNames: (
      | 'data'
      | 'bookmark'
      | 'statistic'
      | 'lastItem'
      | 'lastModified'
      | 'audioBook'
      | 'subtitle'
      | 'handle'
      | 'readerSearchProjection'
      | 'readerStatistic'
      | 'readerLocalIdentity'
    )[] = [
      'data',
      'audioBook',
      'subtitle',
      'handle',
      'readerSearchProjection',
      'bookmark',
      'lastItem'
    ];
    if (shouldDeleteStatistics)
      storeNames.push('statistic', 'lastModified', 'readerStatistic', 'readerLocalIdentity');

    const tx = db.transaction(storeNames, 'readwrite');
    let removedLastItem = false;
    try {
      await commitTransaction(tx, async () => {
        // A batch may span reader writes, renames and other tabs. Decisions must
        // use the current record in the same transaction as its deletion.
        const book = await tx.objectStore('data').get(dataId);
        const bookTitle = book?.title;
        const titleUsedByAnotherBook = bookTitle
          ? (await tx.objectStore('data').index('title').getAllKeys(bookTitle)).some(
              (id) => id !== dataId
            )
          : false;
        const lastItem = await tx.objectStore('lastItem').get(LAST_ITEM_KEY);
        if (lastItem?.dataId === dataId) {
          await tx.objectStore('lastItem').delete(LAST_ITEM_KEY);
          removedLastItem = true;
        }
        await tx.objectStore('bookmark').delete(dataId);

        if (shouldDeleteStatistics && book) {
          const keys = new Set<string>();
          const contentKey = contentStatisticKey(book);
          const local = await tx.objectStore('readerLocalIdentity').get(dataId);
          if (local) keys.add(`local:${local.uuid}`);
          if (contentKey) {
            // Renamed copies can share one content identity. Do not remove their
            // history while another copy remains, and do not retain all payloads
            // at once just to inspect identity metadata.
            let hasOtherCopy = false;
            for (
              let cursor = await tx.objectStore('data').openCursor();
              cursor;
              cursor = await cursor.continue()
            ) {
              if (
                cursor.primaryKey !== dataId &&
                contentStatisticKey(cursor.value) === contentKey
              ) {
                hasOtherCopy = true;
                break;
              }
            }
            if (!hasOtherCopy) keys.add(contentKey);
          }
          for (const key of keys) {
            await tx.objectStore('readerStatistic').delete(statisticRange(key));
            await tx.objectStore('lastModified').delete([key, StorageDataType.STATISTICS]);
          }
        }
        if (shouldDeleteStatistics && bookTitle && !titleUsedByAnotherBook) {
          await tx.objectStore('statistic').delete(IDBKeyRange.bound([bookTitle], [bookTitle, []]));
          await tx.objectStore('lastModified').delete([bookTitle, StorageDataType.STATISTICS]);
        }
        if (bookTitle && !titleUsedByAnotherBook) {
          await tx.objectStore('audioBook').delete(bookTitle);
          await tx.objectStore('subtitle').delete(bookTitle);
          await tx.objectStore('handle').delete(IDBKeyRange.bound([bookTitle], [bookTitle, []]));
        }
        await tx.objectStore('readerSearchProjection').delete(dataId);
        await tx.objectStore('data').delete(dataId);
      });
    } catch (error) {
      // This transaction has no user-cancellation signal. A native abort is a
      // storage failure, not the deliberate cancellation checked between books.
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
        throw new Error(
          'The book could not be deleted because its local storage transaction was aborted. ' +
            'Its stored data was preserved. Try deleting it again.',
          { cause: error }
        );
      throw error;
    }
    if (removedLastItem) this.lastItemChanged$.next();
    this.bookmarksChanged$.next();
    replicationProgress$.next({ progressToAdd: 1 });
    return dataId;
  }

  async getStorageSources() {
    const db = await this.db;

    return db.getAll('storageSource');
  }

  async saveStorageSource(
    storageSource: BooksDbStorageSource,
    oldName: string,
    isSyncTarget: boolean,
    isStorageSourceDefault: boolean
  ) {
    const db = await this.db;
    const tx = db.transaction(['storageSource'], 'readwrite');

    try {
      const store = tx.objectStore('storageSource');

      if (oldName && storageSource.name !== oldName) {
        await store.delete(oldName);
      }

      if (storageSource.name === oldName) {
        await store.put(storageSource);
      } else {
        await store.add(storageSource);
      }

      await tx.done;

      if (isSyncTarget) {
        syncTarget$.next(storageSource.name);
      } else if (oldName) {
        syncTarget$.next('');
      }

      if (isStorageSourceDefault) {
        setStorageSourceDefault(storageSource.name, storageSource.type);
      } else if (oldName) {
        setStorageSourceDefault('', storageSource.type);
      }
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async deleteStorageSource(
    toDelete: BooksDbStorageSource,
    wasSyncTarget: boolean,
    wasStorageSourceDefault: boolean
  ) {
    const db = await this.db;

    await db.delete('storageSource', toDelete.name);

    if (wasSyncTarget) {
      syncTarget$.next('');
    }

    if (wasStorageSourceDefault) {
      setStorageSourceDefault('', toDelete.type);
    }
  }

  async getStatisticsForBook(bookTitle: string) {
    const db = await this.db;

    return db.getAll('statistic', IDBKeyRange.bound([bookTitle], [bookTitle, []]));
  }

  /** Original-file identity is the primary key for all newly tracked days. */
  async getStatisticsForBookId(bookId: number) {
    const db = await this.db;
    const book = await db.get('data', bookId);
    if (!book) throw new Error('No local book data found');
    const bookKey = await migrateLegacyStatistics(db, book);
    return db.getAll('readerStatistic', statisticRange(bookKey));
  }

  async getAllStatistics() {
    return visibleStatistics(await this.db);
  }

  async getStatisticForCompletedBook(bookTitle: string, bookId?: number) {
    const db = await this.db;

    if (bookId) {
      const rows = await this.getStatisticsForBookId(bookId);
      return rows.find((row) => row.completedBook === 1);
    }

    return db.getFromIndex('statistic', 'completedBook', [1, bookTitle]);
  }

  async getStatisticsForTimeWindow(startDate: string, endDate: string) {
    return (await this.getAllStatistics()).filter(
      (row) => row.dateKey >= startDate && row.dateKey <= endDate
    );
  }

  async getStatisticsUntilDate(bookTitle: string, maxDate: string, bookId?: number) {
    if (bookId)
      return (await this.getStatisticsForBookId(bookId)).filter((row) => row.dateKey <= maxDate);
    const db = await this.db;

    const results = await db.getAllFromIndex(
      'statistic',
      'dateKey',
      IDBKeyRange.upperBound(maxDate)
    );

    return results.filter((result) => result.title === bookTitle);
  }

  async storeStatistics(
    bookTitle: string,
    statistics: BooksDbStatistic[],
    saveBehavior: ReplicationSaveBehavior,
    statisticsMergeMode: MergeMode,
    currentLastModified = Date.now(),
    bookId?: number
  ) {
    const db = await this.db;

    if (bookId) {
      const book = await db.get('data', bookId);
      if (!book || book.title !== bookTitle) throw new Error('The tracked book changed.');
      const bookKey = await migrateLegacyStatistics(db, book);
      let rows: BooksDbStatistic[] = statistics.map((row) => ({ ...row, title: bookTitle }));
      if (statisticsMergeMode === MergeMode.MERGE)
        rows = mergeStatistics(
          rows,
          await db.getAll('readerStatistic', statisticRange(bookKey)),
          saveBehavior === ReplicationSaveBehavior.NewOnly
        );
      const updated = updateStatisticToStore(rows, currentLastModified);
      const tx = db.transaction(['readerStatistic', 'lastModified'], 'readwrite');
      const store = tx.objectStore('readerStatistic');
      if (statisticsMergeMode !== MergeMode.LOCAL) await store.delete(statisticRange(bookKey));
      const movesCompletion = updated.statisticsToStore.some((row) => row.completedBook === 1);
      for (const row of updated.statisticsToStore) {
        const existing =
          statisticsMergeMode === MergeMode.LOCAL
            ? await store.get([bookKey, row.dateKey])
            : undefined;
        // A tracker flush may have captured this day before Complete Book
        // committed it. Preserve that explicit completion when the older flush
        // reaches IndexedDB later. A deliberate completion-date move writes a
        // new completed row in the same batch, so it may clear the old flag.
        await store.put(
          preserveCompletedStatistic(
            existing,
            { ...row, title: bookTitle, bookKey },
            movesCompletion
          )
        );
      }
      const modifiedStore = tx.objectStore('lastModified');
      const previousModified =
        statisticsMergeMode === MergeMode.LOCAL
          ? await modifiedStore.get([bookKey, StorageDataType.STATISTICS])
          : undefined;
      await modifiedStore.put({
        title: bookKey,
        dataType: StorageDataType.STATISTICS,
        lastModifiedValue: Math.max(
          updated.newStatisticModified,
          previousModified?.lastModifiedValue ?? 0
        )
      });
      await tx.done;
      return;
    }

    let statisticsToStore: BooksDbStatistic[] = statistics;
    let newStatisticModified = currentLastModified;

    if (statisticsMergeMode === MergeMode.MERGE) {
      const existingStatistics = await this.getStatisticsForBook(bookTitle);

      statisticsToStore = mergeStatistics(
        statistics,
        existingStatistics,
        saveBehavior === ReplicationSaveBehavior.NewOnly
      );
    }

    ({ newStatisticModified, statisticsToStore } = updateStatisticToStore(
      statisticsToStore,
      newStatisticModified
    ));

    const tx = db.transaction(['statistic', 'lastModified'], 'readwrite');

    try {
      const statisticsStore = tx.objectStore('statistic');
      const lastModifiedStore = tx.objectStore('lastModified');
      const limiter = pLimit(1);
      const tasks: Promise<void>[] = [];

      if (statisticsMergeMode !== MergeMode.LOCAL) {
        tasks.push(
          limiter(async () => {
            try {
              await statisticsStore.delete(IDBKeyRange.bound([bookTitle], [bookTitle, []]));
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        );
      }

      statisticsToStore.forEach((statistic) =>
        tasks.push(
          limiter(async () => {
            try {
              await statisticsStore.put(statistic);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      tasks.push(
        limiter(async () => {
          try {
            await lastModifiedStore.put({
              title: bookTitle,
              dataType: StorageDataType.STATISTICS,
              lastModifiedValue: newStatisticModified
            });
          } catch (error: any) {
            limiter.clearQueue();

            throw error;
          }
        })
      );

      await Promise.all(tasks);
      await tx.done;
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async updateStatistic(newStatistic: BookStatistic) {
    const db = await this.db;

    if (newStatistic.bookKey) {
      const existing = await db.get('readerStatistic', [
        newStatistic.bookKey,
        newStatistic.dateKey
      ]);
      if (!existing) throw new Error('Unable to find record in the database');
      await db.put('readerStatistic', {
        ...existing,
        charactersRead: newStatistic.charactersRead,
        readingTime: newStatistic.readingTime,
        minReadingSpeed: newStatistic.minReadingSpeed,
        altMinReadingSpeed: newStatistic.altMinReadingSpeed,
        lastReadingSpeed: newStatistic.lastReadingSpeed,
        maxReadingSpeed: newStatistic.maxReadingSpeed,
        lastStatisticModified: newStatistic.lastStatisticModified
      });
      return;
    }

    let existingStatistic = await db.get('statistic', [newStatistic.title, newStatistic.dateKey]);

    if (!existingStatistic) {
      throw new Error('Unable to find record in the database');
    }

    existingStatistic = {
      ...existingStatistic,
      charactersRead: newStatistic.charactersRead,
      readingTime: newStatistic.readingTime,
      minReadingSpeed: newStatistic.minReadingSpeed,
      altMinReadingSpeed: newStatistic.altMinReadingSpeed,
      lastReadingSpeed: newStatistic.lastReadingSpeed,
      maxReadingSpeed: newStatistic.maxReadingSpeed,
      lastStatisticModified: newStatistic.lastStatisticModified
    };

    await db.put('statistic', existingStatistic);
  }

  async clearZombieStatistics() {
    try {
      const db = await this.db;
      const books = await db.getAll('data');
      const titles = new Set(books.map((book) => book.title));
      const statistics = await db.getAll('statistic');
      const lastModifiedForStatistics = await db.getAll('lastModified');
      const statisticsToDelete: BooksDbStatistic[] = [];
      const lastModifiedItemsToDelete = new Set<string>();

      for (let index = 0, { length } = statistics; index < length; index += 1) {
        const entry = statistics[index];

        if (
          !entry.title.startsWith('content:') &&
          !entry.title.startsWith('local:') &&
          !titles.has(entry.title)
        ) {
          statisticsToDelete.push(entry);
        }
      }

      for (let index = 0, { length } = lastModifiedForStatistics; index < length; index += 1) {
        const entry = lastModifiedForStatistics[index];

        if (
          !entry.title.startsWith('content:') &&
          !entry.title.startsWith('local:') &&
          !titles.has(entry.title)
        ) {
          lastModifiedItemsToDelete.add(entry.title);
        }
      }

      await this.deleteStatistics(statisticsToDelete, [...lastModifiedItemsToDelete]);
    } catch (error: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Failure',
            message: `Error on Deletion: ${error.message}`
          }
        }
      ]);
    }
  }

  async deleteStatistics(statistics: BooksDbStatistic[], lastModifiedTitlesToDelete: string[]) {
    if (!statistics.length && !lastModifiedTitlesToDelete.length) {
      return;
    }

    const db = await this.db;
    const tx = db.transaction(['statistic', 'lastModified'], 'readwrite');
    const titlesToDelete = new Set<string>();

    try {
      const statisticsStore = tx.objectStore('statistic');
      const lastModifiedStore = tx.objectStore('lastModified');
      const limiter = pLimit(1);
      const tasks: Promise<void>[] = [];

      for (let index = 0, { length } = lastModifiedTitlesToDelete; index < length; index += 1) {
        titlesToDelete.add(lastModifiedTitlesToDelete[index]);
      }

      statistics.forEach((statistic) =>
        tasks.push(
          limiter(async () => {
            try {
              titlesToDelete.add(statistic.title);
              await statisticsStore.delete([statistic.title, statistic.dateKey]);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      [...titlesToDelete].forEach((titleToDelete) =>
        tasks.push(
          limiter(async () => {
            try {
              await lastModifiedStore.delete([titleToDelete, StorageDataType.STATISTICS]);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      await Promise.all(tasks);
      await tx.done;
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async deleteStatisticEntries(
    bookTitles: string[],
    checkExistingData: boolean,
    startDateString = '',
    endDateString = '',
    bookKeys: string[] = []
  ) {
    if ((!bookTitles.length && !bookKeys.length) || (startDateString && !endDateString)) {
      throw new Error('Received invalid Arguments for deleteStatisticEntries');
    }

    const db = await this.db;
    const tx = db.transaction(['statistic', 'readerStatistic', 'lastModified'], 'readwrite');

    try {
      const statisticsStore = tx.objectStore('statistic');
      const lastModifiedStore = tx.objectStore('lastModified');
      const limiter = pLimit(1);
      const tasks: Promise<void>[] = [];
      const dates: string[] = [];
      const lastModifiedValue = Date.now();
      const hadDataMap = new Map<string, boolean>();

      if (startDateString) {
        // eslint-disable-next-line prefer-const
        let { referenceDate, dateString } = advanceDateDays(getDate(startDateString), 0);

        while (dateString <= endDateString) {
          dates.push(dateString);
          ({ dateString } = advanceDateDays(referenceDate));
        }
      }

      bookTitles.forEach((bookTitle) => {
        if (dates.length) {
          dates.forEach((dateKey) => {
            tasks.push(
              limiter(async () => {
                try {
                  await statisticsStore.delete([bookTitle, dateKey]);
                } catch (error: any) {
                  limiter.clearQueue();

                  throw error;
                }
              })
            );
          });
        } else {
          tasks.push(
            limiter(async () => {
              try {
                const keyRange = IDBKeyRange.bound([bookTitle], [bookTitle, []]);

                if (checkExistingData && !hadDataMap.has(bookTitle)) {
                  const hadData = !!(await statisticsStore.getKey(keyRange));

                  hadDataMap.set(bookTitle, hadData);
                }

                await statisticsStore.delete(keyRange);
              } catch (error: any) {
                limiter.clearQueue();

                throw error;
              }
            })
          );
        }

        tasks.push(
          limiter(async () => {
            try {
              if (!checkExistingData || hadDataMap.get(bookTitle)) {
                await lastModifiedStore.put({
                  title: bookTitle,
                  dataType: StorageDataType.STATISTICS,
                  lastModifiedValue
                });
              }
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        );
      });

      bookKeys.forEach((bookKey) => {
        if (dates.length) {
          dates.forEach((dateKey) => {
            tasks.push(
              limiter(async () => {
                await tx.objectStore('readerStatistic').delete([bookKey, dateKey]);
              })
            );
          });
        } else {
          tasks.push(
            limiter(async () => {
              const range = statisticRange(bookKey);
              if (checkExistingData)
                hadDataMap.set(bookKey, !!(await tx.objectStore('readerStatistic').getKey(range)));
              await tx.objectStore('readerStatistic').delete(range);
            })
          );
        }
        tasks.push(
          limiter(async () => {
            if (!checkExistingData || hadDataMap.get(bookKey))
              await lastModifiedStore.put({
                title: bookKey,
                dataType: StorageDataType.STATISTICS,
                lastModifiedValue
              });
          })
        );
      });

      await Promise.all(tasks);
      await tx.done;
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async getReadingGoals() {
    const db = await this.db;

    return db.getAll('readingGoal');
  }

  async getOpenReadingGoals() {
    const db = await this.db;

    return db.getAllFromIndex('readingGoal', 'goalEndDate', '');
  }

  async getCurrentClosedReadingGoal(referenceDate: string) {
    const db = await this.db;
    const readingGoals = await db.getAll('readingGoal', IDBKeyRange.upperBound(referenceDate));

    return readingGoals.find((readingGoal) => readingGoal.goalEndDate >= referenceDate);
  }

  async getReadingGoalsForDateWindow(startDate: string, newStartDate = '', endDate = '') {
    const readingGoals = await this.getReadingGoals();

    if (newStartDate) {
      return readingGoals.filter(
        (readingGoal) =>
          !readingGoal.goalEndDate ||
          (startDate >= readingGoal.goalStartDate && startDate <= readingGoal.goalEndDate) ||
          (readingGoal.goalStartDate >= startDate &&
            (!endDate || readingGoal.goalStartDate <= endDate)) ||
          (newStartDate >= readingGoal.goalStartDate && newStartDate <= readingGoal.goalEndDate) ||
          readingGoal.goalStartDate >= newStartDate
      );
    }

    return readingGoals.filter(
      (readingGoal) =>
        !readingGoal.goalEndDate ||
        (startDate >= readingGoal.goalStartDate && startDate <= readingGoal.goalEndDate) ||
        (readingGoal.goalStartDate >= startDate &&
          (!endDate || readingGoal.goalStartDate <= endDate))
    );
  }

  async updateReadingGoals(
    readingGoalsToDelete: string[],
    readingGoalsToInsert: BooksDbReadingGoal[]
  ) {
    if (!readingGoalsToDelete.length && !readingGoalsToInsert.length) {
      return;
    }

    const db = await this.db;
    const tx = db.transaction(['readingGoal'], 'readwrite');

    try {
      const store = tx.objectStore('readingGoal');
      const limiter = pLimit(1);
      const tasks: Promise<void>[] = [];

      readingGoalsToDelete.forEach((readingGoal) =>
        tasks.push(
          limiter(async () => {
            try {
              await store.delete(readingGoal);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      readingGoalsToInsert.forEach((readingGoal) =>
        tasks.push(
          limiter(async () => {
            try {
              await store.put(readingGoal);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      await Promise.all(tasks);
      await tx.done;

      lastReadingGoalsModified$.next(Date.now());
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async storeReadingGoals(
    readingGoals: BooksDbReadingGoal[],
    saveBehavior: ReplicationSaveBehavior,
    readingGoalsMergeMode: MergeMode,
    lastGoalModified: number
  ) {
    const db = await this.db;

    let readingGoalsToStore: BooksDbReadingGoal[] = readingGoals;
    let newReadingGoalModified = lastGoalModified;

    if (readingGoalsMergeMode === MergeMode.MERGE) {
      const existingReadingGoals = await this.getReadingGoals();

      ({ readingGoalsToStore, newReadingGoalModified } = mergeReadingGoals(
        readingGoals,
        existingReadingGoals,
        saveBehavior === ReplicationSaveBehavior.NewOnly,
        newReadingGoalModified
      ));
    }

    const tx = db.transaction(['readingGoal'], 'readwrite');

    try {
      const readingGoalStore = tx.objectStore('readingGoal');
      const limiter = pLimit(1);
      const tasks: Promise<void>[] = [];

      readingGoalsToStore.sort(readingGoalSortFunction);

      tasks.push(
        limiter(async () => {
          try {
            await readingGoalStore.clear();
          } catch (error: any) {
            limiter.clearQueue();

            throw error;
          }
        })
      );

      readingGoalsToStore.forEach((readingGoal) =>
        tasks.push(
          limiter(async () => {
            try {
              await readingGoalStore.put(readingGoal);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      await Promise.all(tasks);
      await tx.done;

      lastReadingGoalsModified$.next(newReadingGoalModified);

      const currentUserGoal = await getCurrentReadingGoal();

      readingGoal$.next(currentUserGoal);
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async deleteReadingGoal(dateKey?: string) {
    const db = await this.db;

    if (dateKey) {
      await db.delete('readingGoal', dateKey);
    } else {
      await db.clear('readingGoal');
    }

    lastReadingGoalsModified$.next(Date.now());
  }

  async getAudioBook(title: string) {
    const db = await this.db;

    return db.get('audioBook', title);
  }

  async getSubtitleData(title: string) {
    const db = await this.db;

    return db.get('subtitle', title);
  }
}
