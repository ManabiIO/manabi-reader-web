/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BaseStorageHandler, FilePrefix } from '$lib/data/storage/handler/base-handler';
import type {
  BooksDbAudioBook,
  BooksDbBookData,
  BooksDbBookmarkData,
  BooksDbReadingGoal,
  BooksDbStatistic,
  BooksDbSubtitleData
} from '$lib/data/database/books-db/versions/books-db';
import { database, lastReadingGoalsModified$ } from '$lib/data/store';

import type { MergeMode } from '$lib/data/merge-mode';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import { StorageDataType } from '$lib/data/storage/storage-types';
import { bookKey, contentBookKey, relocatePresentation } from '$lib/library/organization';
import { contentStatisticKey } from '$lib/data/database/books-db/reader-statistics';
import type { BookCardProps } from '$lib/components/book-card/book-card-props';

export class BrowserStorageHandler extends BaseStorageHandler {
  updateSettings(
    window: Window,
    isForBrowser: boolean,
    saveBehavior: ReplicationSaveBehavior,
    statisticsMergeMode: MergeMode,
    readingGoalsMergeMode: MergeMode
  ) {
    this.window = window;
    this.isForBrowser = isForBrowser;
    this.saveBehavior = saveBehavior;
    this.statisticsMergeMode = statisticsMergeMode;
    this.readingGoalsMergeMode = readingGoalsMergeMode;
  }

  async getBookList() {
    database.listLoading$.next(true);
    try {
      const db = await database.db;
      const data = await db.getAll('data');
      const cards: BookCardProps[] = [];
      this.titleToBookCard.clear();
      for (const book of data) {
        this.addBookCard(book.title, {
          id: book.id,
          imagePath: book.coverImage || '',
          creators: book.creators,
          characters: BaseStorageHandler.getBookCharacters(
            book.characters || 0,
            book.sections || []
          ),
          lastBookModified: book.lastBookModified || 0,
          lastBookOpen: book.lastBookOpen || 0,
          pageDirection: book.pageDirection,
          contentHash: book.contentHash,
          isPlaceholder: !book.elementHtml
        });
        // The inherited TTU cache is keyed by title. Retain its legacy lookup
        // while giving every distinct imported ID its own Library card.
        cards.push({ ...this.titleToBookCard.get(book.title)! });
      }
      this.dataListFetched = true;
      return cards;
    } catch (error) {
      this.clearData();
      throw error;
    }
  }

  clearData(clearAll = true) {
    if (clearAll) {
      this.titleToBookCard.clear();
      this.dataListFetched = false;
    }
  }

  async prepareBookForReading() {
    const book = this.currentContext.id
      ? await database.getData(this.currentContext.id)
      : await database.getDataByTitle(this.currentContext.title);

    if (!book) {
      throw new Error('No local book data found');
    }

    if (!book.elementHtml) {
      throw new Error(
        `Placeholder books should be opened from their original source${
          book.storageSource ? ` - last source: ${book.storageSource}` : ''
        }`
      );
    }

    if (book.storageSource) {
      await database.upsertData(book, ReplicationSaveBehavior.Overwrite);
    }

    return book.id;
  }

  async updateLastRead(book: BooksDbBookData) {
    const filename = BaseStorageHandler.getBookFileName(book);
    const { characters, lastBookModified, lastBookOpen } =
      BaseStorageHandler.getBookMetadata(filename);
    const db = await database.db;

    await db.put('data', book);

    this.addBookCard(this.currentContext.title, { characters, lastBookModified, lastBookOpen });
  }

  async getFilenameForRecentCheck(fileIdentifier: string) {
    if (this.saveBehavior === ReplicationSaveBehavior.Overwrite) {
      BaseStorageHandler.reportProgress();
      return undefined;
    }

    let fileName: string | undefined;

    if (fileIdentifier === 'bookdata_') {
      const book = this.currentContext.id
        ? await database.getData(this.currentContext.id)
        : await database.getDataByTitle(this.currentContext.title);

      fileName = book ? BaseStorageHandler.getBookFileName(book) : undefined;
    } else if (fileIdentifier === 'progress_') {
      const progress = await this.getProgress();

      fileName = progress ? BaseStorageHandler.getProgressFileName(progress) : undefined;
    } else if (fileIdentifier === 'statistics_') {
      const selected = this.currentContext.id
        ? await database.getData(this.currentContext.id)
        : undefined;
      const lastStatisticModifed = await database.getLastModifiedForType(
        (selected && contentStatisticKey(selected)) || this.currentContext.title,
        StorageDataType.STATISTICS
      );

      fileName = lastStatisticModifed
        ? BaseStorageHandler.getStatisticsFileName([], lastStatisticModifed)
        : undefined;
    } else if (fileIdentifier === BaseStorageHandler.readingGoalsFilePrefix) {
      const lastGoalModified = lastReadingGoalsModified$.getValue();

      fileName = lastGoalModified
        ? BaseStorageHandler.getReadingGoalsFileName(lastGoalModified)
        : undefined;
    } else if (fileIdentifier === FilePrefix.AUDIO_BOOK) {
      const audioBook = await this.getAudioBook();

      fileName = audioBook ? BaseStorageHandler.getAudioBookFileName(audioBook) : undefined;
    } else if (fileIdentifier === FilePrefix.SUBTITLE) {
      const subtitleData = await this.getSubtitleData();

      fileName = subtitleData
        ? BaseStorageHandler.getSubtitleDataFileName(subtitleData)
        : undefined;
    }

    BrowserStorageHandler.reportProgress(0.5);
    BrowserStorageHandler.completeStep();

    return fileName;
  }

  async isBookPresentAndUpToDate(_referenceFilename: string | undefined) {
    // The TTU filename carries a title and timestamps, not source-file
    // identity. A same-titled local copy cannot prove this import is present.
    // saveBook performs the content-hash-aware no-op decision after decoding.
    BaseStorageHandler.reportProgress();
    return false;
  }

  async isProgressPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }

    const progress = await this.getProgress();
    const fileName = progress ? BaseStorageHandler.getProgressFileName(progress) : undefined;

    return BaseStorageHandler.checkIsPresentAndUpToDate(
      BaseStorageHandler.getProgressMetadata,
      'lastBookmarkModified',
      referenceFilename,
      fileName
    );
  }

  async areStatisticsPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }

    const selected = this.currentContext.id
      ? await database.getData(this.currentContext.id)
      : undefined;
    const existingLastModified = await database.getLastModifiedForType(
      (selected && contentStatisticKey(selected)) || this.currentContext.title,
      StorageDataType.STATISTICS
    );
    const fileName = existingLastModified
      ? BaseStorageHandler.getStatisticsFileName([], existingLastModified)
      : undefined;

    BaseStorageHandler.reportProgress();

    return BaseStorageHandler.checkIsPresentAndUpToDate(
      BaseStorageHandler.getStatisticsMetadata,
      'lastStatisticModified',
      referenceFilename,
      fileName
    );
  }

  async isAudioBookPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();

      return false;
    }

    const audioBook = await this.getAudioBook();
    const fileName = audioBook ? BaseStorageHandler.getAudioBookFileName(audioBook) : undefined;

    return BaseStorageHandler.checkIsPresentAndUpToDate<BooksDbAudioBook>(
      BaseStorageHandler.getAudioBookMetadata,
      'lastAudioBookModified',
      referenceFilename,
      fileName
    );
  }

  async isSubtitleDataPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();

      return false;
    }

    const subtitleData = await this.getSubtitleData();
    const fileName = subtitleData
      ? BaseStorageHandler.getSubtitleDataFileName(subtitleData)
      : undefined;

    return BaseStorageHandler.checkIsPresentAndUpToDate<BooksDbSubtitleData>(
      BaseStorageHandler.getSubtitleDataMetadata,
      'lastSubtitleDataModified',
      referenceFilename,
      fileName
    );
  }

  async getBook() {
    const book = this.currentContext.id
      ? await database.getData(this.currentContext.id)
      : await database.getDataByTitle(this.currentContext.title);

    BaseStorageHandler.reportProgress();

    return book;
  }

  async getProgress() {
    const dataId =
      this.currentContext.id || (await database.getDataByTitle(this.currentContext.title))?.id;

    BaseStorageHandler.reportProgress(0.5);

    const progress = dataId ? await database.getBookmark(dataId) : undefined;

    return progress;
  }

  async getStatistics() {
    // TTU's wire payload predates the local content-keyed store. Keep its
    // strict schema stable while selecting rows by logical identity here.
    const statistics = this.currentContext.id
      ? (await database.getStatisticsForBookId(this.currentContext.id)).map(
          ({ bookKey: _bookKey, ...row }) => row
        )
      : await database.getStatisticsForBook(this.currentContext.title);

    BaseStorageHandler.reportProgress(0.5);

    const lastStatisticModified = this.currentContext.id
      ? statistics.reduce((latest, row) => Math.max(latest, row.lastStatisticModified), 0)
      : await database.getLastModifiedForType(
          this.currentContext.title,
          StorageDataType.STATISTICS
        );

    if (!lastStatisticModified) {
      return { statistics: undefined, lastStatisticModified: 0 };
    }

    return { statistics, lastStatisticModified };
  }

  async getCover() {
    const cover =
      this.currentContext.imagePath instanceof Blob ? this.currentContext.imagePath : undefined;

    BaseStorageHandler.reportProgress();

    return cover;
  }

  async getAudioBook() {
    const audioBook = await database.getAudioBook(this.currentContext.title);

    BaseStorageHandler.reportProgress();

    return audioBook;
  }

  async getSubtitleData() {
    const subtitleData = await database.getSubtitleData(this.currentContext.title);

    BaseStorageHandler.reportProgress();

    return subtitleData;
  }

  async saveBook(
    data: Omit<BooksDbBookData, 'id'> | File,
    skipTimestampFallback = true,
    removeStorageContext = true
  ) {
    let idToReturn = 0;

    if (!(data instanceof File)) {
      const storedBookData = await database.upsertData(
        data,
        this.saveBehavior,
        skipTimestampFallback,
        removeStorageContext
      );

      idToReturn = storedBookData.id;
      // Promote the identity actually saved (NewOnly may retain an older book).
      // This also covers backup restoration, not just direct file imports.
      if (storedBookData.contentHash && /^[a-f0-9]{64}$/.test(storedBookData.contentHash)) {
        await relocatePresentation(
          bookKey(storedBookData.id),
          contentBookKey(storedBookData.contentHash)
        );
      }
      this.addBookCard(data.title, {
        id: storedBookData.id,
        characters: BaseStorageHandler.getBookCharacters(
          storedBookData.characters || 0,
          storedBookData.sections || []
        ),
        lastBookModified: storedBookData.lastBookModified || 0,
        lastBookOpen: storedBookData.lastBookOpen || 0,
        pageDirection: storedBookData.pageDirection,
        contentHash: storedBookData.contentHash,
        isPlaceholder: !storedBookData.elementHtml
      });
    }

    BaseStorageHandler.reportProgress();

    return idToReturn;
  }

  async saveProgress(data: BooksDbBookmarkData | File) {
    if (data instanceof File) {
      BaseStorageHandler.reportProgress();

      return;
    }

    const dataId =
      this.currentContext.id || (await database.getDataByTitle(this.currentContext.title))?.id;

    BaseStorageHandler.reportProgress(0.5);

    if (dataId) {
      const bookmarkData = data;

      bookmarkData.dataId = dataId;

      await database.putBookmark(bookmarkData);
    }
  }

  async saveStatistics(data: BooksDbStatistic[], lastStatisticModified: number) {
    await database.storeStatistics(
      this.currentContext.title,
      data,
      this.saveBehavior,
      this.statisticsMergeMode,
      lastStatisticModified,
      this.currentContext.id
    );

    BaseStorageHandler.reportProgress();
  }

  async saveReadingGoals(data: BooksDbReadingGoal[], lastGoalModified: number) {
    await database.storeReadingGoals(
      data,
      this.saveBehavior,
      this.readingGoalsMergeMode,
      lastGoalModified
    );

    BaseStorageHandler.reportProgress();
  }

  saveCover(data: Blob | undefined) {
    if (data instanceof Blob && this.titleToBookCard.has(this.currentContext.title)) {
      this.addBookCard(this.currentContext.title, { imagePath: data });
    }

    BaseStorageHandler.reportProgress();
    return Promise.resolve();
  }

  areReadingGoalsPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return Promise.resolve(false);
    }

    const existingLastModified = lastReadingGoalsModified$.getValue();
    const fileName = existingLastModified
      ? BaseStorageHandler.getReadingGoalsFileName(existingLastModified)
      : undefined;

    BaseStorageHandler.reportProgress();

    return Promise.resolve(
      BaseStorageHandler.checkIsPresentAndUpToDate(
        BaseStorageHandler.getReadingGoalsMetadata,
        'lastGoalModified',
        referenceFilename,
        fileName
      )
    );
  }

  async getReadingGoals() {
    const readingGoals = await database.getReadingGoals();
    const lastGoalModified = lastReadingGoalsModified$.getValue();

    BaseStorageHandler.reportProgress();

    if (!lastGoalModified) {
      return { readingGoals: undefined, lastGoalModified: 0 };
    }

    return { readingGoals, lastGoalModified };
  }

  async saveAudioBook(data: BooksDbAudioBook | File) {
    if (data instanceof File) {
      BaseStorageHandler.reportProgress();

      return;
    }

    await database.putAudioBook(data);
  }

  async saveSubtitleData(data: BooksDbSubtitleData | File) {
    if (data instanceof File) {
      BaseStorageHandler.reportProgress();

      return;
    }

    await database.putSubtitleData(data);
  }

  async deleteBookData(
    booksToDelete: string[],
    cancelSignal: AbortSignal,
    keepLocalStatistics: boolean
  ) {
    const ids: number[] = [];
    const idToTitle = new Map<number, string>();

    for (let index = 0, { length } = booksToDelete; index < length; index += 1) {
      const bookData = this.titleToBookCard.get(booksToDelete[index]);

      if (bookData) {
        ids.push(bookData.id);
        idToTitle.set(bookData.id, bookData.title);
      }
    }

    const { error, deleted } = await database
      .deleteData(ids, idToTitle, cancelSignal, keepLocalStatistics)
      .catch((catchedError) => ({ error: catchedError.message, deleted: [] }));

    for (let index = 0, { length } = deleted; index < length; index += 1) {
      const result = deleted[index];

      this.titleToBookCard.delete(idToTitle.get(result) || '');
    }

    if (deleted.length) {
      database.dataListChanged$.next(this);
    }

    return { error, deleted };
  }

  /** The personal Library selects books by ID; titles are not unique. */
  async deleteBookIds(bookIds: number[], cancelSignal: AbortSignal, keepLocalStatistics: boolean) {
    const db = await database.db;
    const idToTitle = new Map<number, string>();
    for (const id of bookIds) {
      const book = await db.get('data', id);
      if (book) idToTitle.set(id, book.title);
    }
    const { error, deleted } = await database
      .deleteData([...idToTitle.keys()], idToTitle, cancelSignal, keepLocalStatistics)
      .catch((caught: Error) => ({ error: caught.message, deleted: [] }));
    if (deleted.length) {
      this.clearData();
      database.dataListChanged$.next(this);
    }
    return { error, deleted };
  }
}
