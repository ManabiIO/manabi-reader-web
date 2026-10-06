/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * React/controller port of routes/manage/+page.svelte; transactions retain their original guards.
 */

import { progressFraction } from '$lib/library/completion';
import { resolve } from '$app/paths';
import { beforeNavigate, goto } from '$app/navigation';
import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import {
  reconcileSelectionEligibility,
  selectableSavedBookIds,
  type LibrarySelectionEligibility
} from '$lib/library/selection';
import {
  preFilteredBookKeysForStatistics$,
  preFilteredTitlesForStatistics$
} from '$lib/components/statistics/statistics-types';

import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
import {
  deleteStatisticsForIdentityPlan,
  statisticIdentityPlan,
  type StatisticsMigrationGuard
} from '$lib/data/database/books-db/reader-statistics';
import { dialogManager } from '$lib/data/dialog-manager';
import { logger } from '$lib/data/logger';
import { SortDirection, type SortOption } from '$lib/data/sort-types';
import { ApiStorageHandler } from '$lib/data/storage/handler/api-handler';
import { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageKey } from '$lib/data/storage/storage-types';
import { storageSource$ } from '$lib/data/storage/storage-view';
import {
  booklistSortOptions$,
  cacheStorageData$,
  confirmStatisticsDeletion$,
  database,
  fileCountData$,
  hideExternalReadHint$,
  isOnline$,
  keepLocalStatisticsOnDeletion$,
  lastExportedTarget$,
  lastExportedTypes$,
  readingGoalsMergeMode$,
  replicationSaveBehavior$,
  showExternalPlaceholder$,
  statisticsMergeMode$
} from '$lib/data/store';
import { cloneMutateSet } from '$lib/functions/clone-mutate-set';

import { prepareBookImportFiles } from '$lib/functions/file-dom/prepare-book-import-files';

import { keyBy } from '$lib/functions/key-by';
import { handleErrorDuringReplication } from '$lib/functions/replication/error-handler';
import { importBackup, importData, replicateData } from '$lib/functions/replication/replicator';
import { throwIfAborted } from '$lib/functions/replication/replication-error';
import {
  replicationProgress$,
  executeReplicate$,
  type ReplicationProgress
} from '$lib/functions/replication/replication-progress';
import { pluralize } from '$lib/functions/utils';
import { creatorSortKey } from '$lib/library/book-metadata';
import { visibleLibraryEntries } from '$lib/library/account-visibility';
import { downloadEditorsPick, type EditorsPick } from '$lib/library/editors-picks';
import {
  EditorsPickStorageHandler,
  findEditorsPickCopy,
  validateEditorsPickCopy
} from '$lib/library/editors-pick-storage';
import { currentUser, localProfileUser, localUser } from '$lib/manabi/client';
import { captureLibraryOperation } from '$lib/manabi/operation-scope';
import type { ReaderLocator } from '$lib/reader-location';
import { clearLibraryLocation, queueLibraryLocation } from '$lib/library/search-navigation';
import { allLinkedBooks } from '$lib/manabi/books';
import { sha256 } from '$lib/manabi/sources';
import type { LibraryMenuModel } from '$lib/library/library-menu';
import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
import {
  combineLatest,
  distinctUntilChanged,
  map,
  Observable,
  share,
  Subject,
  switchMap,
  takeUntil
} from 'rxjs';
import { ObservableController, readStore, writeStore, tick } from './observable-controller';
import { ConfirmDialog, ExternalReadDialog, LogReportDialog, MessageDialog } from '../ui/dialogs';
import { BookExportDialog } from './export-dialog';
import type { WorkspaceController } from './workspace-controller';
export class LibraryController extends ObservableController {
  // IndexedDB may not emit before the first paint. Keep the workspace input
  // stable while it loads, or menu publications continuously restart the sync.
  private readonly emptyBookCards: BookCardProps[] = [];
  booksAreLoading$ = database.listLoading$.pipe(map((isLoading) => isLoading));
  bookCards$: Observable<BookCardProps[]> = combineLatest([
    database.dataList$,
    database.bookmarks$,
    booklistSortOptions$,
    storageSource$,
    showExternalPlaceholder$
  ]).pipe(
    map(([dataList, bookmarks]) => {
      const sortProp = readStore(booklistSortOptions$)[readStore(storageSource$)];
      const isTextSort = sortProp.property === 'title' || sortProp.property === 'author';
      if (readStore(storageSource$) === StorageKey.BROWSER) {
        const bookmarkMap = keyBy(bookmarks, 'dataId');
        return [
          ...dataList
            .filter((d) => readStore(showExternalPlaceholder$) || !d.isPlaceholder)
            .map((d) => ({
              ...d,
              ...this.bookmarkToProgress(bookmarkMap.get(d.id))
            }))
            .sort((card1: BookCardProps, card2: BookCardProps) =>
              this.sortBookCards(card1, card2, sortProp, isTextSort)
            )
        ];
      }
      return [
        ...[...dataList].sort((card1: BookCardProps, card2: BookCardProps) =>
          this.sortBookCards(card1, card2, sortProp, isTextSort)
        )
      ];
    }),
    share()
  );
  currentBookId$ = database.lastItem$.pipe(
    map((item) => item?.dataId),
    share()
  );
  selectedBookIds: ReadonlySet<number> = new Set();
  selectedPreviewKeys: ReadonlySet<string> = new Set();
  libraryWorkspace!: WorkspaceController | undefined;
  selectMode = false;
  libraryHeaderHeight = 64;
  libraryScrollY = 0;
  cancelToken = new AbortController();
  cancelSignal = this.cancelToken.signal;
  cancelTooltip = '';
  replicationProgress = 0;
  replicationToProgress = 0;
  replicationProgressRemaining = '~ ??:??:??';
  replicationDone = new Subject<void>();
  progressBase = 0;
  executionStart = 0;
  bookManagerHeader!:
    | {
        openFilePicker(): void;
        openFolderPicker(): void;
        openBackupPicker(): void;
      }
    | undefined;
  editorsPicksOpen = false;
  openingPickId = '';
  pickDownload!: AbortController | undefined;
  collectionsOpen = false;
  destinationTitle = 'Library';
  selectionScopeKey = '';
  selectableBookIds: readonly number[] = [];
  selectablePreviewKeys: readonly string[] = [];
  selectionEligibility: LibrarySelectionEligibility = {
    key: '',
    ids: [],
    previews: []
  };
  reconciledSelectionEligibility = this.selectionEligibility;
  libraryMenu!: LibraryMenuModel | undefined;
  pageAlive = true;
  openGeneration = 0;
  bookOpenAbort!: AbortController | undefined;
  openOwner = localProfileUser()?.id ?? null;
  confirmingRemoval = false;
  replicator$ = executeReplicate$.pipe(
    switchMap(async () => {
      if (!this.operationAllowed()) {
        return;
      }
      this.cancelTooltip = 'Cancels the current export';
      this.initializeReplicationProgressData();
      const handlers = [readStore(storageSource$), readStore(lastExportedTarget$)].map(
        (storageType) =>
          getStorageHandler(
            window,
            storageType,
            '',
            readStore(lastExportedTarget$) === StorageKey.BROWSER,
            readStore(cacheStorageData$),
            readStore(replicationSaveBehavior$),
            readStore(statisticsMergeMode$),
            readStore(readingGoalsMergeMode$)
          )
      );
      const books = readStore(this.bookCards$).filter((card) => this.selectedBookIds.has(card.id));
      const error = await replicateData(
        handlers[0],
        handlers[1],
        false,
        books.map((book) => ({ id: book.id, title: book.title, imagePath: book.imagePath })),
        readStore(lastExportedTypes$),
        this.cancelSignal
      ).catch((err) => err.message);
      this.resetProgress();
      if (error) {
        this.showError('Export failed', error, 'Error(s) occurred during export');
      }
    }),
    reduceToEmptyString()
  );
  get bookCards() {
    return readStore(this.bookCards$) ?? this.emptyBookCards;
  }
  get currentBookId() {
    return readStore(this.currentBookId$);
  }
  get loading() {
    return readStore(this.booksAreLoading$) ?? true;
  }
  get activeLibraryCards() {
    return visibleLibraryEntries(
      readStore(this.bookCards$) ?? [],
      readStore(allLinkedBooks),
      readStore(localUser)?.id ?? null
    ).cards;
  }
  get activeLibraryCardIds() {
    return new Set(this.activeLibraryCards.map((card) => card.id));
  }
  get currentBookAvailable() {
    return (
      !!readStore(this.currentBookId$) &&
      (readStore(storageSource$) !== StorageKey.BROWSER ||
        this.activeLibraryCardIds.has(readStore(this.currentBookId$)!))
    );
  }
  bookmarkToProgress(b: BooksDbBookmarkData | undefined) {
    return {
      progress: progressFraction(b?.progress),
      lastBookmarkModified: b?.lastBookmarkModified || 0,
      completion: b?.completion
    };
  }
  sortBookCards(
    card1: BookCardProps,
    card2: BookCardProps,
    sortProp: SortOption,
    isTextSort: boolean
  ) {
    const card1Prop =
      sortProp.property === 'author'
        ? creatorSortKey(card1.creators) || ''
        : card1[sortProp.property] || (isTextSort ? '' : 0);
    const card2Prop =
      sortProp.property === 'author'
        ? creatorSortKey(card2.creators) || ''
        : card2[sortProp.property] || (isTextSort ? '' : 0);
    let sortDiff = 0;
    if (sortProp.direction === SortDirection.ASC) {
      sortDiff = isTextSort
        ? String(card1Prop).localeCompare(String(card2Prop), 'ja-JP', { numeric: true })
        : +card1Prop - +card2Prop;
    } else {
      sortDiff = isTextSort
        ? String(card2Prop).localeCompare(String(card1Prop), 'ja-JP', { numeric: true })
        : +card2Prop - +card1Prop;
    }
    if (!sortDiff) {
      sortDiff = card1.title.localeCompare(card2.title, 'ja-JP', { numeric: true });
    }
    return sortDiff;
  }
  async onBookClick(bookId?: number, prepare?: () => Promise<number>, locator?: ReaderLocator) {
    if (!this.operationAllowed()) {
      return;
    }
    this.bookOpenAbort?.abort();
    this.pickDownload?.abort();
    const operation = new AbortController();
    this.bookOpenAbort = operation;
    const signal = operation.signal;
    const request = ++this.openGeneration;
    const owner = localProfileUser()?.id ?? null;
    const storage = readStore(storageSource$);
    const current = () =>
      this.pageAlive &&
      !signal.aborted &&
      request === this.openGeneration &&
      owner === (localProfileUser()?.id ?? null) &&
      storage === readStore(storageSource$);
    if (!this.selectMode) {
      dialogManager.dialogs$.next([
        {
          component: '<div/>',
          disableCloseOnClick: true
        }
      ]);
      let idToOpen = bookId;
      try {
        if (prepare) bookId = await prepare();
        if (!current() || bookId === undefined) return;
        const bookItem =
          readStore(this.bookCards$).find((book) => book.id === bookId) ??
          (readStore(storageSource$) === StorageKey.BROWSER
            ? await database.getData(bookId)
            : undefined);
        if (!current()) return;
        if (!bookItem) {
          throw new Error('Book title not found');
        }
        const isForBrowser = readStore(storageSource$) === StorageKey.BROWSER;
        const handler = getStorageHandler(
          window,
          readStore(storageSource$),
          '',
          isForBrowser,
          readStore(cacheStorageData$),
          readStore(replicationSaveBehavior$),
          readStore(statisticsMergeMode$),
          readStore(readingGoalsMergeMode$)
        );
        if (!readStore(cacheStorageData$)) {
          handler.clearData(false);
        }
        handler.startContext(
          {
            id: isForBrowser ? bookItem.id : 0,
            title: bookItem.title,
            imagePath: 'imagePath' in bookItem ? bookItem.imagePath : ''
          },
          signal
        );
        idToOpen = await handler.prepareBookForReading();
        if (!current()) return;
        if (!readStore(hideExternalReadHint$) && handler instanceof ApiStorageHandler) {
          const nextAction = await new Promise<string>((resolver) => {
            dialogManager.dialogs$.next([
              {
                component: ExternalReadDialog,
                props: { resolver },
                disableCloseOnClick: true
              }
            ]);
          });
          if (!current() || nextAction === 'cancel') {
            return;
          }
          if (nextAction === 'export') {
            const preparedId = bookId;
            this.selectedBookIds = cloneMutateSet(this.selectedBookIds, (set) => {
              set.add(preparedId);
            });
            this.selectMode = true;
            await tick();
            if (!current()) return;
            return this.onReplicateData();
          }
        }
        if (!current() || idToOpen === undefined) return;
        await this.openBook(
          idToOpen,
          owner,
          signal,
          current,
          idToOpen === bookId ? locator : undefined
        );
      } catch (error: any) {
        if (!current()) return;
        const message = `Error opening book: ${error.message}`;
        logger.warn(message);
        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: {
              title: 'Error',
              message
            }
          }
        ]);
        return;
      }
      return;
    }
    if (bookId === undefined) return;
    const selectedId = bookId;
    this.selectedBookIds = cloneMutateSet(this.selectedBookIds, (set) => {
      if (set.has(selectedId)) {
        set.delete(selectedId);
        return;
      }
      set.add(selectedId);
    });
  }
  operationAllowed() {
    const connectivityPass = !(
      (readStore(storageSource$) === StorageKey.GDRIVE ||
        readStore(storageSource$) === StorageKey.ONEDRIVE) &&
      !readStore(isOnline$)
    );
    if (!connectivityPass && !this.replicationToProgress) {
      const message = 'You have to be online for this operation';
      logger.warn(message);
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Failure',
            message
          }
        }
      ]);
    }
    return !this.replicationToProgress && connectivityPass;
  }
  async openBook(
    bookId: number,
    owner: string | null,
    signal: AbortSignal,
    current = () => this.pageAlive && !signal.aborted && owner === (currentUser()?.id ?? null),
    locator?: ReaderLocator
  ) {
    if (!current()) return;
    // A failed or canceled resume write is not a successful opening. The saved
    // book remains available for an explicit retry; no preview token is issued.
    await database.putLastItem(bookId, signal);
    if (!current()) return;
    clearLibraryLocation();
    const librarySearch = locator ? queueLibraryLocation(bookId, owner, locator) : undefined;
    dialogManager.dialogs$.next([]);
    try {
      await this.gotoBook(bookId, librarySearch);
    } catch (error) {
      // A rejected older navigation must not discard a newer passage handoff.
      if (librarySearch) clearLibraryLocation(librarySearch);
      throw error;
    }
  }
  async gotoBook(id: number, librarySearch?: string) {
    await goto(
      resolve(
        `/b?id=${id}${librarySearch ? `&library-search=${encodeURIComponent(librarySearch)}` : ''}`
      )
    );
  }
  async onFilesChange(fileList: FileList | File[]) {
    if (!this.operationAllowed()) {
      return;
    }
    this.cancelTooltip = `Cancels the current Import\nAlready imported data will not be deleted`;
    this.initializeReplicationProgressData();
    const errorTitle = 'Book import failed';
    let files: File[];
    try {
      files = await prepareBookImportFiles(fileList, this.cancelSignal);
    } catch (error) {
      this.resetProgress();
      this.showError(
        errorTitle,
        error instanceof Error ? error.message : String(error),
        'Unable to prepare the selected EPUB package'
      );
      return;
    }
    if (!files.length) {
      this.resetProgress();
      this.showError(
        errorTitle,
        'File(s) must be HTMLZ, TXT, EPUB, an EPUB package folder, or an .epub.zip wrapper',
        ''
      );
      return;
    }
    const error = await importData(
      document,
      getStorageHandler(
        window,
        readStore(storageSource$),
        '',
        readStore(storageSource$) === StorageKey.BROWSER,
        readStore(cacheStorageData$),
        readStore(replicationSaveBehavior$),
        readStore(statisticsMergeMode$),
        readStore(readingGoalsMergeMode$)
      ),
      files,
      this.cancelSignal,
      readStore(fileCountData$)
    ).catch((catchedError) => catchedError.message);
    this.resetProgress();
    if (error) {
      this.showError(errorTitle, error, 'The selected book could not be imported');
    }
  }
  async openEditorsPick(pick: EditorsPick) {
    if (this.openingPickId || this.replicationToProgress) return;
    this.bookOpenAbort?.abort();
    this.openGeneration++;
    this.openingPickId = pick.id;
    const operation = new AbortController();
    this.pickDownload = operation;
    const signal = operation.signal;
    const owner = currentUser()?.id ?? null;
    try {
      const file = await downloadEditorsPick(pick, signal);
      throwIfAborted(signal);
      const digest = await sha256(await file.arrayBuffer());
      throwIfAborted(signal);
      const storedId = await findEditorsPickCopy(digest, owner, signal);
      throwIfAborted(signal);
      if (storedId !== undefined) {
        await validateEditorsPickCopy(storedId, digest, owner, signal);
        storageSource$.next(StorageKey.BROWSER);
        this.editorsPicksOpen = false;
        await this.openBook(storedId, owner, signal);
        return;
      }
      this.initializeReplicationProgressData();
      const handler = new EditorsPickStorageHandler(window, digest, owner, signal);
      handler.updateSettings(
        window,
        true,
        readStore(replicationSaveBehavior$),
        readStore(statisticsMergeMode$),
        readStore(readingGoalsMergeMode$)
      );
      const importCancellation = this.cancelToken;
      const abortImport = () => importCancellation.abort();
      signal.addEventListener('abort', abortImport, { once: true });
      try {
        const error = await importData(document, handler, [file], this.cancelSignal);
        throwIfAborted(signal);
        if (error) throw new Error(error);
      } finally {
        signal.removeEventListener('abort', abortImport);
        this.resetProgress();
      }
      throwIfAborted(signal);
      if (handler.savedId === undefined)
        throw new Error('The book could not be added to this browser.');
      await validateEditorsPickCopy(handler.savedId, digest, owner, signal);
      storageSource$.next(StorageKey.BROWSER);
      this.editorsPicksOpen = false;
      await this.openBook(handler.savedId, owner, signal);
    } catch (error) {
      if (!signal.aborted)
        this.showError(
          'Could not open book',
          error instanceof Error ? error.message : String(error),
          'The catalog book could not be opened.'
        );
    } finally {
      if (this.pickDownload === operation) {
        this.pickDownload = undefined;
        this.openingPickId = '';
      }
    }
  }
  showError(title: string, message: string, fallbackMessage: string) {
    const showReport = logger.errorCount > 1;
    logger.warn(message);
    dialogManager.dialogs$.next([
      {
        component: showReport ? LogReportDialog : MessageDialog,
        props: {
          title,
          message: showReport ? fallbackMessage : message
        }
      }
    ]);
  }
  initializeReplicationProgressData() {
    this.replicationDone = new Subject<void>();
    replicationProgress$.pipe(takeUntil(this.replicationDone)).subscribe(this.updateProgress);
    this.replicationProgressRemaining = '~ ??:??:??';
    this.replicationProgress = 0;
    this.replicationToProgress = 1;
    this.executionStart = Date.now();
    logger.clearHistory();
    this.cancelToken = new AbortController();
    this.cancelSignal = this.cancelToken.signal;
  }
  resetProgress() {
    this.replicationDone.next();
    this.replicationDone.complete();
    this.replicationToProgress = 0;
    this.replicationProgress = 0;
    this.cancelTooltip = '';
  }
  onSelectAllBooks() {
    if (readStore(storageSource$) === StorageKey.BROWSER && this.libraryWorkspace) {
      this.libraryWorkspace.selectAllVisible();
      return;
    }
    const ids = selectableSavedBookIds(
      readStore(storageSource$) === StorageKey.BROWSER,
      this.selectableBookIds,
      readStore(this.bookCards$) ?? []
    );
    this.selectedBookIds = cloneMutateSet(this.selectedBookIds, (set) => {
      ids.forEach((id) => set.add(id));
    });
  }
  toggleSelectedBooks(bookIds: number[]) {
    if (!bookIds.length) return;
    const allSelected = bookIds.every((id) => this.selectedBookIds.has(id));
    this.selectedBookIds = cloneMutateSet(this.selectedBookIds, (set) => {
      for (const id of bookIds) {
        if (allSelected) set.delete(id);
        else set.add(id);
      }
    });
  }
  toggleCollections() {
    this.collectionsOpen = true;
  }
  backToCurrentBook() {
    const currentBookId = readStore(this.currentBookId$);
    if (!currentBookId || !this.currentBookAvailable) return;
    this.gotoBook(currentBookId);
  }
  async confirmSelectedRemoval() {
    if (
      this.confirmingRemoval ||
      this.replicationToProgress ||
      this.libraryMenu?.selectedActions?.busy
    )
      return;
    const owner = localProfileUser()?.id ?? null;
    const generation = this.openGeneration;
    const scope = this.selectionScopeKey;
    const source = readStore(storageSource$);
    const eligible = new Set(this.selectableBookIds);
    const ids = [...this.selectedBookIds].filter(
      (id) => source !== StorageKey.BROWSER || eligible.has(id)
    );
    if (!ids.length) return;
    this.confirmingRemoval = true;
    try {
      const cancelled = await new Promise<boolean>((resolver) => {
        dialogManager.dialogs$.next([
          {
            component: ConfirmDialog,
            props: {
              dialogHeader: `Delete ${ids.length} selected ${ids.length === 1 ? 'book' : 'books'}?`,
              dialogMessage:
                source === StorageKey.BROWSER
                  ? `Remove the selected saved books and their local reading positions from this browser? Original files in connected folders and unopened previews are not deleted. ${readStore(keepLocalStatisticsOnDeletion$) ? 'Reading statistics will be kept.' : 'Local reading statistics will also be deleted.'}`
                  : 'Delete the selected books from the active storage? This cannot be undone.',
              resolver
            }
          }
        ]);
      });
      if (
        cancelled ||
        !this.pageAlive ||
        generation !== this.openGeneration ||
        scope !== this.selectionScopeKey ||
        source !== readStore(storageSource$) ||
        owner !== (localProfileUser()?.id ?? null)
      )
        return;
      // The confirmed snapshot, never a later selection, owns this destructive operation.
      await this.removeBooks(ids);
    } finally {
      this.confirmingRemoval = false;
    }
  }
  async removeBooks(bookIds: number[]) {
    if (!this.operationAllowed()) {
      return;
    }
    this.cancelTooltip = `Cancels the Deletion\nAlready deleted data will not be restored`;
    this.initializeReplicationProgressData();
    try {
      const currentBookCount = readStore(this.bookCards$).length;
      const handler = getStorageHandler(window, readStore(storageSource$), '');
      const { error, deleted } =
        handler instanceof BrowserStorageHandler
          ? await handler.deleteBookIds(
              bookIds,
              this.cancelSignal,
              readStore(keepLocalStatisticsOnDeletion$)
            )
          : await handler.deleteBookData(
              readStore(this.bookCards$).reduce((toDelete, card) => {
                if (bookIds.includes(card.id)) toDelete.push(card.title);
                return toDelete;
              }, [] as string[]),
              this.cancelSignal,
              readStore(keepLocalStatisticsOnDeletion$)
            );
      await tick();
      if (deleted.length === currentBookCount) {
        this.selectMode = false;
      } else {
        this.selectedBookIds = cloneMutateSet(this.selectedBookIds, (set) => {
          deleted.forEach((deletedBookId) => set.delete(deletedBookId));
        });
      }
      if (error) this.showError('Deletion failed', error, 'Error(s) occurred during deletion');
    } catch (error) {
      this.showError(
        'Deletion failed',
        error instanceof Error ? error.message : String(error),
        'Error(s) occurred during deletion'
      );
    } finally {
      this.resetProgress();
    }
  }
  async onImportBackup(file: File) {
    if (!this.operationAllowed()) {
      return;
    }
    const errorTitle = 'Import failed';
    this.cancelTooltip = `Cancels the current Import\nAlready imported data will not be deleted`;
    this.initializeReplicationProgressData();
    if (!file.name.endsWith('.zip')) {
      this.resetProgress();
      this.showError(errorTitle, 'Invalid file - expected zip archive', '');
      return;
    }
    const error = await importBackup(
      getStorageHandler(
        window,
        StorageKey.BACKUP,
        undefined,
        readStore(storageSource$) === StorageKey.BROWSER,
        readStore(cacheStorageData$),
        readStore(replicationSaveBehavior$),
        readStore(statisticsMergeMode$),
        readStore(readingGoalsMergeMode$)
      ),
      getStorageHandler(
        window,
        readStore(storageSource$),
        '',
        readStore(storageSource$) === StorageKey.BROWSER,
        readStore(cacheStorageData$),
        readStore(replicationSaveBehavior$),
        readStore(statisticsMergeMode$),
        readStore(readingGoalsMergeMode$)
      ),
      file,
      this.cancelSignal
    ).catch((err) => err.message);
    this.resetProgress();
    if (error) {
      this.showError(errorTitle, error, 'Error(s) occurred during import');
    }
  }
  onDomainHintClick() {
    dialogManager.dialogs$.next([
      {
        component: MessageDialog,
        props: {
          title: 'Old Domain',
          message:
            'You are currently using the old domain of ッツ Reader - consider switching to https://reader.ttsu.app to prevent issues and to ensure full features'
        },
        disableCloseOnClick: true
      }
    ]);
  }
  onBugReportClick() {
    dialogManager.dialogs$.next([
      {
        component: LogReportDialog,
        props: {
          title: 'Bug Report',
          message: 'Please include the attached file for your report'
        }
      }
    ]);
  }
  onReplicateData() {
    dialogManager.dialogs$.next([{ component: BookExportDialog, disableCloseOnClick: true }]);
  }
  statisticsAuthority(
    scope: ReturnType<typeof captureLibraryOperation>,
    cancellation?: AbortSignal
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (scope.signal.aborted || cancellation?.aborted) controller.abort();
    scope.signal.addEventListener('abort', abort);
    cancellation?.addEventListener('abort', abort);
    const assertCurrent = () => {
      scope.assertCurrent();
      cancellation?.throwIfAborted();
      controller.signal.throwIfAborted();
    };
    const validate: StatisticsMigrationGuard['validate'] = (book, owner) => {
      assertCurrent();
      if (!book) return;
      if (
        (book.libraryOwner !== undefined && book.libraryOwner !== scope.profileId) ||
        (owner && owner.accountId !== scope.profileId)
      )
        throw new Error('This book belongs to another account.');
    };
    const guard: StatisticsMigrationGuard = {
      assertCurrent,
      signal: controller.signal,
      validate,
      validateCopy: validate
    };
    return {
      guard,
      stop() {
        scope.signal.removeEventListener('abort', abort);
        cancellation?.removeEventListener('abort', abort);
      }
    };
  }
  async openSelectedStatistics() {
    const selectedBooks = readStore(this.bookCards$)
      .filter((card) => this.selectedBookIds.has(card.id))
      .map(({ id, title, contentHash }) => ({ id, title, contentHash }));
    if (!selectedBooks.length) return;
    const scope = captureLibraryOperation();
    const authority = this.statisticsAuthority(scope);
    try {
      const db = await database.db;
      authority.guard.assertCurrent();
      const plans = [];
      for (const book of selectedBooks)
        plans.push(await statisticIdentityPlan(db, book.id, authority.guard, book));
      authority.guard.assertCurrent();
      const previousTitles = readStore(preFilteredTitlesForStatistics$);
      const previousKeys = readStore(preFilteredBookKeysForStatistics$);
      writeStore(preFilteredTitlesForStatistics$, new Set(plans.map((plan) => plan.title)));
      writeStore(preFilteredBookKeysForStatistics$, new Set(plans.flatMap((plan) => plan.keys)));
      try {
        await goto(resolve('/statistics'));
      } catch (error) {
        writeStore(preFilteredTitlesForStatistics$, previousTitles);
        writeStore(preFilteredBookKeysForStatistics$, previousKeys);
        throw error;
      }
    } catch (error) {
      this.showError(
        'Statistics unavailable',
        error instanceof Error ? error.message : String(error),
        'The selected statistics could not be opened.'
      );
    } finally {
      authority.stop();
      scope.stop();
    }
  }
  async onDeleteStatistics() {
    const selectedBooks = readStore(this.bookCards$)
      .filter((card) => this.selectedBookIds.has(card.id))
      .map(({ id, title, contentHash }) => ({ id, title, contentHash }));
    if (!selectedBooks.length) return;
    const scope = captureLibraryOperation();
    let progressStarted = false;
    try {
      let wasCanceled = false;
      if (readStore(confirmStatisticsDeletion$)) {
        wasCanceled = await new Promise((resolver) => {
          dialogManager.dialogs$.next([
            {
              component: ConfirmDialog,
              props: {
                dialogHeader: 'Delete Data',
                dialogMessage: `This will delete all Statistics for the selected ${pluralize(selectedBooks.length, 'Book', false)} (which may include start and/or completion Data)\n\nExecute a one time Sync with an export behavior of "replace" and/or statistics merge mode of "replace" to apply deletions to other devices`,
                contentStyles: 'white-space: pre-line;',
                resolver
              }
            }
          ]);
        });
      }
      if (wasCanceled) return;
      scope.assertCurrent();
      this.cancelTooltip = `Cancels the current Process`;
      this.initializeReplicationProgressData();
      progressStarted = true;
      const authority = this.statisticsAuthority(scope, this.cancelSignal);
      try {
        let failed = 0;
        const db = await database.db;
        authority.guard.assertCurrent();
        replicationProgress$.next({ progressBase: 1, maxProgress: selectedBooks.length });
        for (const book of selectedBooks) {
          try {
            authority.guard.assertCurrent();
            const plan = await statisticIdentityPlan(db, book.id, authority.guard, book);
            if (plan.unresolvedLegacy)
              throw new Error(
                `Older statistics for “${plan.title}” cannot be safely assigned to this copy. ` +
                  'Open Statistics and export the raw history before resolving the duplicate title.'
              );
            await deleteStatisticsForIdentityPlan(db, book.id, plan, authority.guard);
            replicationProgress$.next({ progressToAdd: 1 });
          } catch (error) {
            handleErrorDuringReplication(error, `Error on deleting statistics for ${book.title}: `);
            failed += 1;
          }
        }
        if (failed) {
          const errorMessage = `Unable to delete statistics of ${pluralize(failed, 'Book')}`;
          this.showError('Deletion Failed', errorMessage, errorMessage);
        }
      } finally {
        authority.stop();
      }
    } catch (error) {
      if (!this.cancelSignal.aborted)
        this.showError(
          'Deletion Failed',
          error instanceof Error ? error.message : String(error),
          'The selected statistics were not changed.'
        );
    } finally {
      if (progressStarted) this.resetProgress();
      scope.stop();
    }
  }
  updateProgress(replicationProgressData: ReplicationProgress) {
    if (this.cancelSignal.aborted) {
      return;
    }
    this.progressBase = replicationProgressData.progressBase || this.progressBase || 0;
    this.replicationToProgress =
      replicationProgressData.maxProgress || this.replicationToProgress || 0;
    if (replicationProgressData.skipStep) {
      const progressDiffToAdd =
        Math.ceil(this.replicationProgress / this.progressBase) * this.progressBase -
        this.replicationProgress;
      this.replicationProgress =
        Math.floor(
          (this.replicationProgress + (progressDiffToAdd || this.progressBase) + Number.EPSILON) *
            1000
        ) / 1000;
    } else if (replicationProgressData.completeStep) {
      const progressDiffToAdd = Math.ceil(this.replicationProgress) - this.replicationProgress;
      this.replicationProgress =
        Math.floor((this.replicationProgress + progressDiffToAdd + Number.EPSILON) * 1000) / 1000;
    } else if (replicationProgressData.progressToAdd && replicationProgressData.progressToAdd > 0) {
      this.replicationProgress =
        Math.floor(
          (this.replicationProgress + replicationProgressData.progressToAdd + Number.EPSILON) * 1000
        ) / 1000;
    }
    if (replicationProgressData.progressToAdd) {
      const duration = (Date.now() - this.executionStart) / 1000;
      const processPerSecond = this.replicationProgress / duration;
      const remainingTime =
        (this.replicationToProgress - this.replicationProgress) / processPerSecond;
      this.replicationProgressRemaining =
        this.replicationToProgress > this.replicationProgress
          ? `~ ${this.getTimestamp(Math.ceil(remainingTime))}`
          : '~ 00:00:01';
    }
  }
  getTimestamp(seconds: number) {
    return seconds && Number.isFinite(seconds)
      ? new Date(seconds * 1000).toISOString().substr(11, 8)
      : '??:??:??';
  }
  reconcile() {
    {
      if (!this.selectMode && (this.selectedPreviewKeys.size || this.selectedBookIds.size)) {
        this.selectedPreviewKeys = new Set();
        this.selectedBookIds = new Set();
      }
    }
    if (this.selectionEligibility !== this.reconciledSelectionEligibility) {
      const previousScope = this.reconciledSelectionEligibility.key;
      this.reconciledSelectionEligibility = this.selectionEligibility;
      this.selectionScopeKey = this.selectionEligibility.key;
      this.selectableBookIds = this.selectionEligibility.ids;
      this.selectablePreviewKeys = this.selectionEligibility.previews;
      if (this.selectMode) {
        const reconciled = reconcileSelectionEligibility(
          previousScope,
          this.selectionEligibility,
          this.selectedBookIds,
          this.selectedPreviewKeys
        );
        this.selectedBookIds = reconciled.ids;
        this.selectedPreviewKeys = reconciled.previews;
      }
    }
  }
  start() {
    this.pageAlive = true;
    const stopOpenAccount = localUser.subscribe(() => {
      const owner = localProfileUser()?.id ?? null;
      if (owner !== this.openOwner) {
        this.openOwner = owner;
        this.openGeneration++;
        this.bookOpenAbort?.abort();
        this.pickDownload?.abort();
        dialogManager.dialogs$.next([]);
      }
    });
    const openStorageSubscription = storageSource$
      .pipe(distinctUntilChanged())
      .subscribe(() => this.bookOpenAbort?.abort());
    const retireOpen = () => {
      this.openGeneration++;
      this.bookOpenAbort?.abort();
      this.pickDownload?.abort();
      dialogManager.dialogs$.next([]);
    };
    const stopNavigation = beforeNavigate((navigation) => {
      // A later guard may still deny this attempt. Keep the current Library
      // operation and its dialog alive until departure is actually admitted.
      navigation.beforeCommit(retireOpen);
    });
    // A real Back/Forward can keep this Library instance alive. The qualified
    // history broker suppresses rejected/restoring events before they reach
    // this listener; every accepted traversal revokes an outstanding open.
    window.addEventListener('popstate', retireOpen);
    this.retain(() => {
      stopNavigation();
      window.removeEventListener('popstate', retireOpen);
      this.cancelToken.abort();
      this.replicationDone.next();
      this.replicationDone.complete();
      this.pageAlive = false;
      this.openGeneration++;
      stopOpenAccount();
      openStorageSubscription.unsubscribe();
      this.bookOpenAbort?.abort();
      this.pickDownload?.abort();
      dialogManager.dialogs$.next([]);
    });
    this.watch(
      this.replicator$,
      this.booksAreLoading$,
      booklistSortOptions$,
      storageSource$,
      showExternalPlaceholder$,
      this.bookCards$,
      allLinkedBooks,
      localUser,
      this.currentBookId$,
      cacheStorageData$,
      replicationSaveBehavior$,
      statisticsMergeMode$,
      readingGoalsMergeMode$,
      hideExternalReadHint$,
      isOnline$,
      fileCountData$,
      keepLocalStatisticsOnDeletion$,
      preFilteredTitlesForStatistics$,
      preFilteredBookKeysForStatistics$,
      confirmStatisticsDeletion$,
      lastExportedTarget$,
      lastExportedTypes$
    );
  }
}
