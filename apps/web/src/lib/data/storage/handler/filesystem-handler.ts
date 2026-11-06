/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type {
  BooksDbAudioBook,
  BooksDbBookData,
  BooksDbBookmarkData,
  BooksDbReadingGoal,
  BooksDbStatistic,
  BooksDbSubtitleData
} from '$lib/data/database/books-db/versions/books-db';
import { database, fsStorageSource$ } from '$lib/data/store';
import { mergeReadingGoals, readingGoalSortFunction } from '$lib/data/reading-goal';
import { mergeStatistics, updateStatisticToStore } from '$lib/functions/statistic-util';

import { BaseStorageHandler, FilePrefix } from '$lib/data/storage/handler/base-handler';
import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import { MergeMode } from '$lib/data/merge-mode';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import { StorageKey } from '$lib/data/storage/storage-types';
import { StorageUnlock } from '$runtime/../ui/dialogs';
import {
  isRemoteContext,
  type StorageUnlockAction
} from '$lib/data/storage/storage-source-manager';
import { dialogManager } from '$lib/data/dialog-manager';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { handleErrorDuringReplication } from '$lib/functions/replication/error-handler';
import pLimit from 'p-limit';
import { getExternalBookData } from '$lib/manabi/external-book-data';
import { replicationProgress$ } from '$lib/functions/replication/replication-progress';
import { AbortError, throwIfAborted } from '$lib/functions/replication/replication-error';
import { selectTtuFile, ttuPrefixes } from '$lib/manabi/ttu-folder-contract';

interface FilesystemContext {
  title: string;
  sanitizedTitle: string;
  signal: AbortSignal | undefined;
  isCurrent(): boolean;
  isActive(): boolean;
  assertActive(): void;
}

export class FilesystemStorageHandler extends BaseStorageHandler {
  private sourceGeneration = 0;
  private rootDirectory: FileSystemDirectoryHandle | undefined;

  private titleToDirectory = new Map<string, FileSystemDirectoryHandle>();

  private titleToFiles = new Map<string, FileSystemFileHandle[]>();

  private rootFileHandles = new Map<string, FileSystemFileHandle>();

  updateSettings(
    window: Window,
    isForBrowser: boolean,
    saveBehavior: ReplicationSaveBehavior,
    statisticsMergeMode: MergeMode,
    readingGoalsMergeMode: MergeMode,
    cacheStorageData: boolean,
    askForStorageUnlock: boolean,
    storageSourceName: string
  ) {
    this.window = window;
    this.isForBrowser = isForBrowser;
    this.saveBehavior = saveBehavior;
    this.statisticsMergeMode = statisticsMergeMode;
    this.readingGoalsMergeMode = readingGoalsMergeMode;
    this.cacheStorageData = cacheStorageData;
    this.askForStorageUnlock = askForStorageUnlock;

    const newStorageSource = storageSourceName || fsStorageSource$.getValue();

    if (newStorageSource !== this.storageSourceName) {
      this.clearData();
    }

    this.storageSourceName = newStorageSource;
  }

  async getBookList() {
    const source = this.captureFilesystemSource();
    if (!this.dataListFetched) {
      database.listLoading$.next(true);

      const rootDirectory = await this.ensureRoot(this.askForStorageUnlock, source.assertCurrent);
      source.assertCurrent();
      const directories = (await FilesystemStorageHandler.list(
        rootDirectory,
        true
      )) as FileSystemDirectoryHandle[];
      source.assertCurrent();

      await this.setTitleData(directories);
      source.assertCurrent();

      this.dataListFetched = true;
    }

    return [...this.titleToBookCard.values()];
  }

  clearData(clearAll = true) {
    this.titleToFiles.clear();
    this.rootFileHandles.clear();
    this.rootFiles.clear();
    this.rootFileListFetched = false;

    if (clearAll) {
      this.sourceGeneration++;
      this.rootDirectory = undefined;
      this.titleToDirectory.clear();
      this.titleToBookCard.clear();
      this.dataListFetched = false;
    }
  }

  async prepareBookForReading(): Promise<number> {
    const book = await getExternalBookData(this.currentContext.title, this.storageSourceName);

    let idToReturn = 0;
    let data: Omit<BooksDbBookData, 'id'> | undefined = book;

    if (!data || !data.elementHtml) {
      const { file } = await this.getExternalFile('bookdata_');

      data = file
        ? data || {
            title: this.currentContext.title,
            styleSheet: '',
            elementHtml: '',
            blobs: {},
            coverImage: '',
            hasThumb: true,
            characters: 0,
            sections: [],
            lastBookModified: 0,
            lastBookOpen: 0,
            storageSource: undefined
          }
        : undefined;
    }

    if (!data) {
      throw new Error('No local or external book data found');
    }

    if (data.storageSource !== this.storageSourceName) {
      data.storageSource = this.storageSourceName;

      idToReturn = await getStorageHandler(
        this.window,
        StorageKey.BROWSER,
        undefined,
        true,
        this.cacheStorageData,
        ReplicationSaveBehavior.Overwrite
      ).saveBook(data, true, false);
    } else if (book?.id) {
      idToReturn = book.id;
    }

    return idToReturn;
  }

  async updateLastRead(book: BooksDbBookData) {
    const operation = this.captureFilesystemContext();
    const { file, files, rootDirectory } = await this.getExternalFile('bookdata_');
    operation.assertActive();

    if (!file) {
      return;
    }

    const bookData = await file.getFile();
    const filename = BaseStorageHandler.getBookFileName(book);
    const { characters, lastBookModified, lastBookOpen } =
      BaseStorageHandler.getBookMetadata(filename);

    await this.writeFile(rootDirectory, filename, bookData, files, file, { operation });

    if (operation.isActive())
      this.addBookCard(operation.title, { characters, lastBookModified, lastBookOpen });
  }

  async getFilenameForRecentCheck(fileIdentifier: string) {
    if (this.saveBehavior === ReplicationSaveBehavior.Overwrite) {
      BaseStorageHandler.reportProgress();
      return undefined;
    }

    const { file } = this.validRootFiles.includes(fileIdentifier)
      ? await this.getRootFile(fileIdentifier)
      : await this.getExternalFile(fileIdentifier, 1);

    return file?.name;
  }

  async isBookPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }

    const { file } = await this.getExternalFile('bookdata_', 1);

    let isPresentAndUpToDate = false;

    if (file) {
      const { lastBookModified, lastBookOpen } =
        BaseStorageHandler.getBookMetadata(referenceFilename);
      const { lastBookModified: existingBookModified, lastBookOpen: existingBookOpen } =
        BaseStorageHandler.getBookMetadata(file.name);

      isPresentAndUpToDate = !!(
        existingBookModified &&
        lastBookModified &&
        existingBookModified >= lastBookModified &&
        (existingBookOpen || 0) >= (lastBookOpen || 0)
      );
    }

    return isPresentAndUpToDate;
  }

  async isProgressPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }

    const { file } = await this.getExternalFile('progress_', 1);

    return BaseStorageHandler.checkIsPresentAndUpToDate(
      BaseStorageHandler.getProgressMetadata,
      'lastBookmarkModified',
      referenceFilename,
      file?.name
    );
  }

  async areStatisticsPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }

    const { file } = await this.getExternalFile('statistics_', 1);

    return BaseStorageHandler.checkIsPresentAndUpToDate(
      BaseStorageHandler.getStatisticsMetadata,
      'lastStatisticModified',
      referenceFilename,
      file?.name
    );
  }

  async areReadingGoalsPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }

    const { file } = await this.getRootFile(BaseStorageHandler.readingGoalsFilePrefix);

    return BaseStorageHandler.checkIsPresentAndUpToDate(
      BaseStorageHandler.getReadingGoalsMetadata,
      'lastGoalModified',
      referenceFilename,
      file?.name
    );
  }

  async isAudioBookPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }

    const { file } = await this.getExternalFile(FilePrefix.AUDIO_BOOK, 1);

    return BaseStorageHandler.checkIsPresentAndUpToDate<BooksDbAudioBook>(
      BaseStorageHandler.getAudioBookMetadata,
      'lastAudioBookModified',
      referenceFilename,
      file?.name
    );
  }

  async isSubtitleDataPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }

    const { file } = await this.getExternalFile(FilePrefix.SUBTITLE, 1);

    return BaseStorageHandler.checkIsPresentAndUpToDate<BooksDbSubtitleData>(
      BaseStorageHandler.getSubtitleDataMetadata,
      'lastSubtitleDataModified',
      referenceFilename,
      file?.name
    );
  }

  async getBook() {
    const { file } = await this.getExternalFile('bookdata_', this.isForBrowser ? 0.4 : 0.8);

    if (!file) {
      return undefined;
    }

    const bookFile = await file.getFile();

    return this.isForBrowser ? this.extractBookData(bookFile, bookFile.name, 0.6) : bookFile;
  }

  async getProgress() {
    const { file } = await this.getExternalFile('progress_', this.isForBrowser ? 0.6 : 0.8);

    if (!file) {
      return undefined;
    }

    const progressFile = await file.getFile();

    if (this.isForBrowser) {
      const progress = JSON.parse(await FilesystemStorageHandler.readFileObject(progressFile));

      BaseStorageHandler.reportProgress(0.4);
      return progress;
    }

    return progressFile;
  }

  async getStatistics() {
    const { file } = await this.getExternalFile('statistics_', 0.6);

    if (!file) {
      return { statistics: undefined, lastStatisticModified: 0 };
    }

    const statisticsFile = await file.getFile();
    const statisticsFileData = await FilesystemStorageHandler.readFileObject(statisticsFile);
    const statistics = JSON.parse(statisticsFileData);

    BaseStorageHandler.reportProgress(0.4);

    return {
      statistics,
      lastStatisticModified: BaseStorageHandler.getStatisticsMetadata(file.name)
        .lastStatisticModified
    };
  }

  async getCover() {
    if (this.currentContext.imagePath instanceof Blob) {
      BaseStorageHandler.reportProgress();

      return this.currentContext.imagePath;
    }

    const { file } = await this.getExternalFile('cover_', 0.8);

    if (!file) {
      return undefined;
    }

    const cover = await file.getFile();

    return cover;
  }

  async getReadingGoals() {
    const { file } = await this.getRootFile(BaseStorageHandler.readingGoalsFilePrefix, 0.6);

    if (!file) {
      return { readingGoals: undefined, lastGoalModified: 0 };
    }

    const readingGoalsFile = await file.getFile();
    const readingGoalsFileData = await FilesystemStorageHandler.readFileObject(readingGoalsFile);
    const readingGoals = JSON.parse(readingGoalsFileData);

    BaseStorageHandler.reportProgress(0.4);

    return {
      readingGoals,
      lastGoalModified: BaseStorageHandler.getReadingGoalsMetadata(file.name).lastGoalModified
    };
  }

  async getAudioBook() {
    const { file } = await this.getExternalFile(
      FilePrefix.AUDIO_BOOK,
      this.isForBrowser ? 0.6 : 0.8
    );

    if (!file) {
      return undefined;
    }

    const audioBookFile = await file.getFile();

    if (this.isForBrowser) {
      const audioBook = JSON.parse(await FilesystemStorageHandler.readFileObject(audioBookFile));

      BaseStorageHandler.reportProgress(0.4);
      return audioBook;
    }

    return audioBookFile;
  }

  async getSubtitleData() {
    const { file } = await this.getExternalFile(FilePrefix.SUBTITLE, this.isForBrowser ? 0.6 : 0.8);

    if (!file) {
      return undefined;
    }

    const subtitleDataFile = await file.getFile();

    if (this.isForBrowser) {
      const subtitleData = JSON.parse(
        await FilesystemStorageHandler.readFileObject(subtitleDataFile)
      );

      BaseStorageHandler.reportProgress(0.4);
      return subtitleData;
    }

    return subtitleDataFile;
  }

  async saveBook(data: Omit<BooksDbBookData, 'id'> | File, skipTimestampFallback = true) {
    const operation = this.captureFilesystemContext();
    const isFile = data instanceof File;
    const { file, files, rootDirectory } = await this.getExternalFile('bookdata_', 0.2);
    operation.assertActive();
    const filename = BaseStorageHandler.getBookFileName(
      data,
      file && skipTimestampFallback ? '' : file?.name
    );
    const { characters, lastBookModified, lastBookOpen } =
      BaseStorageHandler.getBookMetadata(filename);

    if (file && this.saveBehavior === ReplicationSaveBehavior.NewOnly) {
      const { lastBookModified: existingBookModified, lastBookOpen: existingBookOpen } =
        BaseStorageHandler.getBookMetadata(file.name);

      if (
        existingBookModified &&
        lastBookModified &&
        existingBookModified >= lastBookModified &&
        (existingBookOpen || 0) >= (lastBookOpen || 0)
      ) {
        return 0;
      }
    }

    let bookData;

    if (isFile) {
      bookData = data;
      BaseStorageHandler.reportProgress(0.2);
    } else {
      bookData = await this.zipBookData(data, 0.4);
    }

    await this.writeFile(rootDirectory, filename, bookData, files, file, {
      progressBase: isFile ? 0.6 : 0.4,
      operation
    });

    if (operation.isActive())
      this.addBookCard(operation.title, { characters, lastBookModified, lastBookOpen });

    return 0;
  }

  async saveProgress(data: BooksDbBookmarkData | File) {
    const operation = this.captureFilesystemContext();
    const filename = BaseStorageHandler.getProgressFileName(data);
    const { lastBookmarkModified, progress } = BaseStorageHandler.getProgressMetadata(filename);
    const { file, files, rootDirectory } = await this.getExternalFile('progress_');
    operation.assertActive();

    await this.writeFile(
      rootDirectory,
      filename,
      data instanceof File ? data : JSON.stringify(data),
      files,
      file,
      { progressBase: 0.6, operation }
    );

    if (operation.isActive()) this.addBookCard(operation.title, { lastBookmarkModified, progress });
  }

  async saveStatistics(statistics: BooksDbStatistic[], lastStatisticModified: number) {
    const operation = this.captureFilesystemContext();
    const isMerge = this.statisticsMergeMode === MergeMode.MERGE;
    const { file, files, rootDirectory } = await this.getExternalFile('statistics_');
    operation.assertActive();

    let statisticsToStore: BooksDbStatistic[] = statistics;
    let newStatisticModified = lastStatisticModified;

    if (isMerge) {
      let existingData = [];

      if (file) {
        const existingDataFile = await file.getFile();

        existingData = JSON.parse(await FilesystemStorageHandler.readFileObject(existingDataFile));
      }

      statisticsToStore = mergeStatistics(
        statistics,
        existingData,
        this.saveBehavior === ReplicationSaveBehavior.NewOnly
      );
    }

    ({ statisticsToStore, newStatisticModified } = updateStatisticToStore(
      statisticsToStore,
      newStatisticModified
    ));

    const filename = BaseStorageHandler.getStatisticsFileName(
      statisticsToStore,
      newStatisticModified
    );

    await this.writeFile(rootDirectory, filename, JSON.stringify(statisticsToStore), files, file, {
      progressBase: 0.6,
      operation
    });

    if (operation.isActive()) this.addBookCard(operation.title, {});
  }

  async saveCover(data: Blob | undefined) {
    if (!data) {
      BaseStorageHandler.reportProgress();
      return;
    }

    const operation = this.captureFilesystemContext();
    const { file, files, rootDirectory } = await this.getExternalFile('cover_');
    operation.assertActive();

    if (!file) {
      const filename = await BaseStorageHandler.getCoverFileName(data);

      await this.writeFile(rootDirectory, filename, data, files, undefined, {
        progressBase: 0.6,
        operation
      });
    }

    if (operation.isActive() && this.titleToBookCard.has(operation.title)) {
      this.addBookCard(operation.title, { imagePath: data });
    }
  }

  async saveReadingGoals(readingGoals: BooksDbReadingGoal[], lastGoalModified: number) {
    const operation = this.captureFilesystemContext();
    const isMerge = this.readingGoalsMergeMode === MergeMode.MERGE;
    const { file, rootDirectory } = await this.getRootFile(
      BaseStorageHandler.readingGoalsFilePrefix,
      0.4
    );
    operation.assertActive();

    let readingGoalsToStore: BooksDbReadingGoal[] = readingGoals;
    let newReadingGoalModified = lastGoalModified;

    if (isMerge) {
      let existingData = [];

      if (file) {
        const existingDataFile = await file.getFile();

        existingData = JSON.parse(await FilesystemStorageHandler.readFileObject(existingDataFile));
      }

      ({ readingGoalsToStore, newReadingGoalModified } = mergeReadingGoals(
        readingGoals,
        existingData,
        this.saveBehavior === ReplicationSaveBehavior.NewOnly,
        lastGoalModified
      ));
    }

    readingGoalsToStore.sort(readingGoalSortFunction);

    const filename = BaseStorageHandler.getReadingGoalsFileName(newReadingGoalModified);

    await this.writeFile(rootDirectory, filename, JSON.stringify(readingGoalsToStore), [], file, {
      progressBase: 0.6,
      rootFilePrefix: BaseStorageHandler.readingGoalsFilePrefix,
      operation
    });
  }

  async saveAudioBook(data: BooksDbAudioBook | File) {
    const operation = this.captureFilesystemContext();
    const filename = BaseStorageHandler.getAudioBookFileName(data);
    const { file, files, rootDirectory } = await this.getExternalFile(FilePrefix.AUDIO_BOOK);
    operation.assertActive();

    await this.writeFile(
      rootDirectory,
      filename,
      data instanceof File ? data : JSON.stringify(data),
      files,
      file,
      { progressBase: 0.6, operation }
    );
  }

  async saveSubtitleData(data: BooksDbSubtitleData | File) {
    const operation = this.captureFilesystemContext();
    const filename = BaseStorageHandler.getSubtitleDataFileName(data);
    const { file, files, rootDirectory } = await this.getExternalFile(FilePrefix.SUBTITLE);
    operation.assertActive();

    await this.writeFile(
      rootDirectory,
      filename,
      data instanceof File ? data : JSON.stringify(data),
      files,
      file,
      { progressBase: 0.6, operation }
    );
  }

  async deleteBookData(booksToDelete: string[], cancelSignal: AbortSignal) {
    const source = this.captureFilesystemSource();
    const assertActive = () => {
      throwIfAborted(cancelSignal);
      source.assertCurrent();
    };
    assertActive();
    const rootDirectory = await this.ensureRoot(this.askForStorageUnlock, assertActive);
    throwIfAborted(cancelSignal);
    source.assertCurrent();
    const deleted: number[] = [];

    let error = '';

    replicationProgress$.next({ progressBase: 1, maxProgress: booksToDelete.length });

    for (const bookToDelete of booksToDelete) {
      try {
        throwIfAborted(cancelSignal);
        source.assertCurrent();
        const deletedId = this.titleToBookCard.get(bookToDelete)?.id;

        await rootDirectory.removeEntry(BaseStorageHandler.sanitizeForFilename(bookToDelete), {
          recursive: true
        });

        if (deletedId) {
          deleted.push(deletedId);
        }
        if (!source.isCurrent()) break;

        this.titleToDirectory.delete(bookToDelete);
        this.titleToFiles.delete(bookToDelete);
        this.titleToBookCard.delete(bookToDelete);

        database.dataListChanged$.next(this);

        BaseStorageHandler.reportProgress();
      } catch (err) {
        if (cancelSignal.aborted || (err as Error).name === 'AbortError') break;
        error = handleErrorDuringReplication(err, `Error deleting ${bookToDelete}: `);
      }
    }

    return { error, deleted };
  }

  private async ensureRoot(
    askForStorageUnlock = this.askForStorageUnlock,
    assertOwner?: () => void,
    allowNativePrompt = this.askForStorageUnlock
  ): Promise<FileSystemDirectoryHandle> {
    const assertActive = assertOwner ?? this.captureFilesystemContext().assertActive;
    assertActive();
    try {
      if (this.rootDirectory) {
        const root = this.rootDirectory;
        await FilesystemStorageHandler.verifyPermission(root, assertActive, allowNativePrompt);
        assertActive();

        return root;
      }

      const db = await database.db;
      assertActive();
      const storageSource = await db.get('storageSource', this.storageSourceName);
      assertActive();

      if (!storageSource) {
        throw new Error(`No storage source with name ${this.storageSourceName} found`);
      }

      const handleData = storageSource.data;

      if (handleData instanceof ArrayBuffer || isRemoteContext(handleData)) {
        throw new Error('Wrong filesystem handle type');
      }

      if (!handleData.directoryHandle) {
        throw new Error('Filesystem handle not found');
      }

      await FilesystemStorageHandler.verifyPermission(
        handleData.directoryHandle,
        assertActive,
        allowNativePrompt
      );
      assertActive();

      this.rootDirectory = handleData.directoryHandle;
    } catch (error: any) {
      assertActive();
      if (error.message.includes('activation is required') && askForStorageUnlock) {
        const result = await new Promise<StorageUnlockAction | undefined>((resolver) => {
          dialogManager.dialogs$.next([
            {
              component: StorageUnlock,
              props: {
                description: 'You are trying to access data on your filesystem',
                action: 'Please grant permissions in the next dialog',
                requiresSecret: false,
                showCancel: true,
                resolver
              },
              disableCloseOnClick: true
            }
          ]);
        });
        assertActive();

        if (!result) throw new AbortError('Filesystem permission request was cancelled');
        return this.ensureRoot(false, assertActive, allowNativePrompt);
      }

      throw error;
    }

    return this.rootDirectory;
  }

  private async setTitleData(directories: FileSystemDirectoryHandle[], clearDataOnError = true) {
    const source = this.captureFilesystemSource();
    const listLimiter = pLimit(1);
    const listTasks: Promise<void>[] = [];

    directories.forEach((directory) =>
      listTasks.push(
        listLimiter(async () => {
          try {
            source.assertCurrent();
            const files = (await FilesystemStorageHandler.list(
              directory
            )) as FileSystemFileHandle[];
            source.assertCurrent();

            if (!files.length) {
              const title = BaseStorageHandler.desanitizeFilename(directory.name);
              this.titleToFiles.delete(title);
              this.titleToBookCard.delete(title);
              return;
            }
            for (const prefix of ttuPrefixes) selectTtuFile(files, prefix);

            const bookCard: BookCardProps = {
              id: BaseStorageHandler.getDummyId(),
              title: BaseStorageHandler.desanitizeFilename(directory.name),
              imagePath: '',
              characters: 0,
              lastBookModified: 0,
              lastBookOpen: 0,
              progress: 0,
              lastBookmarkModified: 0,
              isPlaceholder: false
            };
            const fileLimiter = pLimit(1);
            const fileTasks: Promise<void>[] = [];

            files.forEach((file) =>
              fileTasks.push(
                fileLimiter(async () => {
                  try {
                    if (file.name.startsWith('bookdata_')) {
                      const metadata = BaseStorageHandler.getBookMetadata(file.name);

                      bookCard.characters = metadata.characters;
                      bookCard.lastBookModified = metadata.lastBookModified;
                      bookCard.lastBookOpen = metadata.lastBookOpen;
                    } else if (file.name.startsWith('progress_')) {
                      const metadata = BaseStorageHandler.getProgressMetadata(file.name);

                      bookCard.lastBookmarkModified = metadata.lastBookmarkModified;
                      bookCard.progress = metadata.progress;
                    } else if (file.name.startsWith('cover_')) {
                      bookCard.imagePath = await file.getFile();
                    }
                  } catch (error) {
                    fileLimiter.clearQueue();
                    throw error;
                  }
                })
              )
            );

            await Promise.all(fileTasks);
            source.assertCurrent();

            this.titleToDirectory.set(bookCard.title, directory);
            this.titleToFiles.set(bookCard.title, files);
            this.titleToBookCard.set(bookCard.title, bookCard);
          } catch (error) {
            listLimiter.clearQueue();
            throw error;
          }
        })
      )
    );

    await Promise.all(listTasks).catch((error) => {
      if (clearDataOnError && source.isCurrent()) {
        this.clearData();
      }

      throw error;
    });
  }

  private async getExternalFile(fileIdentifier: string, progressBase = 0.4) {
    const source = this.captureFilesystemSource();
    const progressPerStep = progressBase / 2;
    const rootDirectory = await this.ensureRoot();
    source.assertCurrent();

    BaseStorageHandler.reportProgress(progressPerStep);

    const files = await this.getExternalFiles(rootDirectory);
    source.assertCurrent();
    const file = selectTtuFile(files, fileIdentifier);

    BaseStorageHandler.reportProgress(progressPerStep);

    return { file, files, rootDirectory };
  }

  private async getRootFile(fileIdentifier: string, progressBase = 1) {
    const source = this.captureFilesystemSource();
    const progressPerStep = progressBase / 2;
    const rootDirectory = await this.ensureRoot();
    source.assertCurrent();

    BaseStorageHandler.reportProgress(progressPerStep);

    await this.setRootFiles(rootDirectory);
    source.assertCurrent();

    return { file: this.rootFileHandles.get(fileIdentifier), rootDirectory };
  }

  private async getExternalFiles(
    rootHandle: FileSystemDirectoryHandle
  ): Promise<FileSystemFileHandle[]> {
    const source = this.captureFilesystemSource();
    const title = this.currentContext.title;
    const sanitizedTitle = this.sanitizedTitle;
    if (!this.cacheStorageData || !this.titleToFiles.has(title)) {
      const directory = await rootHandle
        .getDirectoryHandle(sanitizedTitle, { create: false })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
          return undefined;
        });
      source.assertCurrent();

      if (directory) {
        await this.setTitleData([directory], false);
        source.assertCurrent();
      } else {
        // Disappearance is not permission to reuse a previous native-app revision.
        this.titleToDirectory.delete(title);
        this.titleToFiles.delete(title);
        this.titleToBookCard.delete(title);
      }
    }

    return this.titleToFiles.get(title) || [];
  }

  private async setRootFiles(rootHandle: FileSystemDirectoryHandle) {
    const source = this.captureFilesystemSource();
    if ((!this.cacheStorageData || !this.rootFileListFetched) && !this.rootFiles.size) {
      const files = (await FilesystemStorageHandler.list(rootHandle)) as FileSystemFileHandle[];
      source.assertCurrent();

      for (let index = 0, { length } = files; index < length; index += 1) {
        const file = files[index];

        for (
          let index2 = 0, { length: length2 } = this.validRootFiles;
          index2 < length2;
          index2 += 1
        ) {
          const validRootFile = this.validRootFiles[index2];

          if (file.name.startsWith(validRootFile)) {
            this.rootFileHandles.set(validRootFile, file);
          }
        }
      }

      this.rootFileListFetched = true;
    }
  }

  private captureFilesystemSource() {
    const name = this.storageSourceName;
    const generation = this.sourceGeneration;
    const isCurrent = () => this.storageSourceName === name && this.sourceGeneration === generation;
    return {
      isCurrent,
      assertCurrent: () => {
        if (!isCurrent()) throw new AbortError('Filesystem source was retired');
      }
    };
  }

  private captureFilesystemContext(): FilesystemContext {
    const source = this.captureFilesystemSource();
    const context = this.currentContext;
    const signal = this.cancelSignal;
    const title = context.title;
    const sanitizedTitle = this.sanitizedTitle;
    const storageSource = this.storageSourceName;
    const isCurrent = () =>
      this.currentContext === context &&
      this.cancelSignal === signal &&
      this.storageSourceName === storageSource &&
      source.isCurrent();
    const assertActive = () => {
      throwIfAborted(signal);
      if (!isCurrent()) throw new AbortError('Filesystem export context was retired');
    };
    assertActive();
    return {
      title,
      sanitizedTitle,
      signal,
      isCurrent,
      assertActive,
      isActive: () => !signal?.aborted && isCurrent()
    };
  }

  private async writeFile(
    rootDirectory: FileSystemDirectoryHandle,
    filename: string,
    data: any,
    files: FileSystemFileHandle[],
    file: FileSystemFileHandle | undefined,
    options: { progressBase?: number; rootFilePrefix?: string; operation?: FilesystemContext } = {}
  ) {
    const {
      progressBase = 0.4,
      rootFilePrefix,
      operation = this.captureFilesystemContext()
    } = options;
    const { title, sanitizedTitle, signal, isCurrent, assertActive } = operation;
    const progressPerStep = progressBase / 2;
    assertActive();
    const directory = rootFilePrefix
      ? rootDirectory
      : this.titleToDirectory.get(title) ||
        (await rootDirectory.getDirectoryHandle(sanitizedTitle, { create: true }));
    assertActive();
    const savedFile = await directory.getFileHandle(filename, { create: true });
    assertActive();
    const writer = await savedFile.createWritable();

    let closing = false;
    let abortPromise: Promise<void> | undefined;
    const abortWriter = () => {
      // Observe rejection immediately, even while a native write is pending.
      abortPromise ??= Promise.resolve()
        .then(() => writer.abort())
        .catch(() => {});
      return abortPromise;
    };
    const onAbort = () => {
      if (!closing) void abortWriter();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      assertActive();
      await writer.write(data);
      assertActive();
      // close cannot be rolled back once admitted. Its result decides whether
      // committed bytes may truthfully be acknowledged.
      closing = true;
      await writer.close();
    } catch (error) {
      // Abort discards the stream's staged bytes. Never remove the named file:
      // it may predate this export or have been opened by another writer.
      await abortWriter();
      // A failed abort must not replace the original write/cancellation error.
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }

    // A fulfilled close acknowledges committed bytes, even if cancellation
    // arrived during close. Do not claim rollback or start obsolete cleanup.
    if (signal?.aborted || !isCurrent()) return;
    BaseStorageHandler.reportProgress(progressPerStep);

    if (file) {
      const sameEntry = await savedFile.isSameEntry(file);
      if (signal?.aborted || !isCurrent()) return;
      if (!sameEntry) {
        await directory.removeEntry(file.name);
      }
      if (signal?.aborted || !isCurrent()) return;

      if (!rootFilePrefix) {
        const titleFiles = files.filter((entry) => entry.name !== file.name);
        titleFiles.push(savedFile);

        this.titleToFiles.set(title, titleFiles);
      }
    } else if (!rootFilePrefix) {
      this.titleToFiles.set(title, [...files, savedFile]);
    }

    if (rootFilePrefix) {
      this.rootFileHandles.set(rootFilePrefix, savedFile);
    } else {
      this.titleToDirectory.set(title, directory);
    }

    BaseStorageHandler.reportProgress(progressPerStep);
  }

  static readFileObject(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.addEventListener('load', () => {
        resolve(reader.result as string);
      });

      reader.addEventListener('error', () => {
        reject(new Error(`Error reading file ${file.name}`));
      });

      reader.readAsText(file);
    });
  }

  private static async verifyPermission(
    handle: FileSystemDirectoryHandle,
    assertActive: () => void,
    allowNativePrompt: boolean
  ) {
    const options: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };

    assertActive();
    const permission = await handle.queryPermission(options);
    assertActive();
    if (permission === 'granted') {
      return true;
    }

    if (!allowNativePrompt) throw new Error('No permissions granted to access filesystem');
    const requested = await handle.requestPermission(options);
    assertActive();
    if (requested === 'granted') {
      return true;
    }

    throw new Error('No permissions granted to access filesystem');
  }

  private static async list(directory: FileSystemDirectoryHandle, listDirectories = false) {
    const entries: (FileSystemDirectoryHandle | FileSystemFileHandle)[] = [];
    const listIterator = directory.values();

    let entry = await listIterator.next();

    while (!entry.done) {
      if (entry.value.kind === 'directory' && listDirectories) {
        entries.push(entry.value);
      } else if (entry.value.kind === 'file' && !listDirectories) {
        entries.push(entry.value);
      }

      entry = await listIterator.next();
    }

    return entries;
  }
}
