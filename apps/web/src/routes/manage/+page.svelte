<script lang="ts">
  import { progressFraction } from '$lib/library/completion';
  import { resolve } from '$app/paths';
  import { beforeNavigate, goto } from '$app/navigation';
  import BookCardList from '$lib/components/book-card/book-card-list.svelte';
  import LibraryWorkspace from '$lib/library/library-workspace.svelte';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import BookManagerHeader from '$lib/components/book-card/book-manager-header.svelte';
  import BookExportDialog from '$lib/components/book-export/book-export-dialog.svelte';
  import { Button } from '$lib/components/ui/button';
  import { CaretRightIcon } from 'phosphor-svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import ExternalReadDialog from '$lib/components/external-read-dialog.svelte';
  import LogReportDialog from '$lib/components/log-report-dialog.svelte';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import { preFilteredTitlesForStatistics$ } from '$lib/components/statistics/statistics-types';
  import { pxScreen } from '$lib/css-classes';
  import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { pagePath } from '$lib/data/env';
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
  import { getDropEventFiles } from '$lib/functions/file-dom/get-drop-event-files';
  import { prepareBookImportFiles } from '$lib/functions/file-dom/prepare-book-import-files';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { keyBy } from '$lib/functions/key-by';
  import { handleErrorDuringReplication } from '$lib/functions/replication/error-handler';
  import { importBackup, importData, replicateData } from '$lib/functions/replication/replicator';
  import { throwIfAborted } from '$lib/functions/replication/replication-error';
  import {
    replicationProgress$,
    executeReplicate$,
    type ReplicationProgress
  } from '$lib/functions/replication/replication-progress';
  import { isMobile$, pluralize } from '$lib/functions/utils';
  import { creatorSortKey } from '$lib/library/book-metadata';
  import { visibleLibraryEntries } from '$lib/library/account-visibility';
  import EditorsPicks from '$lib/library/editors-picks.svelte';
  import { downloadEditorsPick, type EditorsPick } from '$lib/library/editors-picks';
  import {
    EditorsPickStorageHandler,
    findEditorsPickCopy,
    validateEditorsPickCopy
  } from '$lib/library/editors-pick-storage';
  import { account, currentUser } from '$lib/manabi/client';
  import type { ReaderLocator } from '$lib/reader-location';
  import { clearLibraryLocation, queueLibraryLocation } from '$lib/library/search-navigation';
  import { allLinkedBooks } from '$lib/manabi/books';
  import { sha256 } from '$lib/manabi/sources';
  import type { LibraryMenuModel } from '$lib/library/library-menu';
  import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
  import pLimit from 'p-limit';
  import { combineLatest, map, Observable, share, Subject, switchMap, takeUntil } from 'rxjs';
  import { onDestroy, tick } from 'svelte';

  const booksAreLoading$ = database.listLoading$.pipe(map((isLoading) => isLoading));

  const bookCards$: Observable<BookCardProps[]> = combineLatest([
    database.dataList$,
    database.bookmarks$,
    booklistSortOptions$
  ]).pipe(
    map(([dataList, bookmarks]) => {
      const sortProp = $booklistSortOptions$[$storageSource$];
      const isTextSort = sortProp.property === 'title' || sortProp.property === 'author';

      if ($storageSource$ === StorageKey.BROWSER) {
        const bookmarkMap = keyBy(bookmarks, 'dataId');

        return [
          ...dataList
            .filter((d) => $showExternalPlaceholder$ || !d.isPlaceholder)
            .map((d) => ({
              ...d,
              ...bookmarkToProgress(bookmarkMap.get(d.id))
            }))
            .sort((card1: BookCardProps, card2: BookCardProps) =>
              sortBookCards(card1, card2, sortProp, isTextSort)
            )
        ];
      }

      return [
        ...dataList.sort((card1: BookCardProps, card2: BookCardProps) =>
          sortBookCards(card1, card2, sortProp, isTextSort)
        )
      ];
    }),
    share()
  );

  const currentBookId$ = database.lastItem$.pipe(
    map((item) => item?.dataId),
    share()
  );

  let selectedBookIds: ReadonlySet<number> = new Set();
  let selectMode = false;
  let libraryHeaderHeight = 64;
  let libraryScrollY = 0;
  let cancelToken = new AbortController();
  let cancelSignal = cancelToken.signal;
  let cancelTooltip = '';
  let replicationProgress = 0;
  let replicationToProgress = 0;
  let replicationProgressRemaining = '~ ??:??:??';
  let replicationDone = new Subject<void>();
  let progressBase = 0;
  let executionStart: number;
  let bookManagerHeader: BookManagerHeader | undefined;
  let editorsPicksOpen = false;
  let openingPickId = '';
  let pickDownload: AbortController | undefined;
  let collectionsOpen = false;
  let destinationTitle = 'Library';
  let selectionScopeKey = '';
  let selectableBookIds: number[] = [];
  let libraryMenu: LibraryMenuModel | undefined;
  let pageAlive = true;
  let openGeneration = 0;
  let openOwner = currentUser()?.id ?? null;
  const stopOpenAccount = account.subscribe(() => {
    const owner = currentUser()?.id ?? null;
    if (owner !== openOwner) {
      openOwner = owner;
      openGeneration++;
      pickDownload?.abort();
      dialogManager.dialogs$.next([]);
    }
  });
  beforeNavigate(() => {
    openGeneration++;
    pickDownload?.abort();
    dialogManager.dialogs$.next([]);
  });

  $: activeLibraryCards = visibleLibraryEntries(
    $bookCards$ ?? [],
    $allLinkedBooks,
    $account.session?.user?.id ?? null
  ).cards;
  $: activeLibraryCardIds = new Set(activeLibraryCards.map((card) => card.id));
  $: currentBookAvailable =
    !!$currentBookId$ &&
    ($storageSource$ !== StorageKey.BROWSER || activeLibraryCardIds.has($currentBookId$));

  $: {
    if (!selectMode) {
      selectedBookIds = new Set();
    }
  }

  onDestroy(() => {
    pageAlive = false;
    openGeneration++;
    stopOpenAccount();
    pickDownload?.abort();
    dialogManager.dialogs$.next([]);
  });

  function bookmarkToProgress(b: BooksDbBookmarkData | undefined) {
    return {
      progress: progressFraction(b?.progress),
      lastBookmarkModified: b?.lastBookmarkModified || 0,
      completion: b?.completion
    };
  }

  function sortBookCards(
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

  async function onBookClick(
    bookId?: number,
    prepare?: () => Promise<number>,
    locator?: ReaderLocator
  ) {
    if (!operationAllowed()) {
      return;
    }

    const request = ++openGeneration;
    const owner = currentUser()?.id ?? null;
    const storage = $storageSource$;
    const current = () =>
      pageAlive &&
      request === openGeneration &&
      owner === (currentUser()?.id ?? null) &&
      storage === $storageSource$;

    if (!selectMode) {
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
          $bookCards$.find((book) => book.id === bookId) ??
          ($storageSource$ === StorageKey.BROWSER ? await database.getData(bookId) : undefined);

        if (!current()) return;
        if (!bookItem) {
          throw new Error('Book title not found');
        }

        const isForBrowser = $storageSource$ === StorageKey.BROWSER;
        const handler = getStorageHandler(
          window,
          $storageSource$,
          '',
          isForBrowser,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        );

        if (!cacheStorageData$) {
          handler.clearData(false);
        }

        handler.startContext({
          id: isForBrowser ? bookItem.id : 0,
          title: bookItem.title,
          imagePath: 'imagePath' in bookItem ? bookItem.imagePath : ''
        });

        idToOpen = await handler.prepareBookForReading();
        if (!current()) return;

        if (!$hideExternalReadHint$ && handler instanceof ApiStorageHandler) {
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
            selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
              set.add(preparedId);
            });
            selectMode = true;

            await tick();
            if (!current()) return;
            return onReplicateData();
          }
        }

        dialogManager.dialogs$.next([]);
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

      if (!current() || idToOpen === undefined) return;
      clearLibraryLocation();
      const librarySearch =
        locator && idToOpen === bookId ? queueLibraryLocation(idToOpen, owner, locator) : undefined;
      openBook(idToOpen, librarySearch);
      return;
    }

    if (bookId === undefined) return;
    const selectedId = bookId;
    selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
      if (set.has(selectedId)) {
        set.delete(selectedId);
        return;
      }
      set.add(selectedId);
    });
  }

  function operationAllowed() {
    const connectivityPass = !(
      ($storageSource$ === StorageKey.GDRIVE || $storageSource$ === StorageKey.ONEDRIVE) &&
      !$isOnline$
    );

    if (!connectivityPass && !replicationToProgress) {
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

    return !replicationToProgress && connectivityPass;
  }

  function openBook(bookId: number, librarySearch?: string) {
    if (!bookId) {
      return;
    }

    database.putLastItem(bookId);
    gotoBook(bookId, librarySearch);
  }

  async function gotoBook(id: number, librarySearch?: string) {
    await goto(
      `${pagePath}/b?id=${id}${librarySearch ? `&library-search=${encodeURIComponent(librarySearch)}` : ''}`
    );
  }

  async function onFilesChange(fileList: FileList | File[]) {
    if (!operationAllowed()) {
      return;
    }

    cancelTooltip = `Cancels the current Import\nAlready imported data will not be deleted`;

    initializeReplicationProgressData();

    const errorTitle = 'Bookimport failed';
    let files: File[];
    try {
      files = await prepareBookImportFiles(fileList, cancelSignal);
    } catch (error) {
      resetProgress();
      showError(
        errorTitle,
        error instanceof Error ? error.message : String(error),
        'Unable to prepare the selected EPUB package'
      );
      return;
    }

    if (!files.length) {
      resetProgress();

      showError(
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
        $storageSource$,
        '',
        $storageSource$ === StorageKey.BROWSER,
        $cacheStorageData$,
        $replicationSaveBehavior$,
        $statisticsMergeMode$,
        $readingGoalsMergeMode$
      ),
      files,
      cancelSignal,
      $fileCountData$
    ).catch((catchedError) => catchedError.message);

    resetProgress();

    if (error) {
      showError(errorTitle, error, 'Error(s) occurred during bookimport');
    }
  }

  async function openEditorsPick(pick: EditorsPick) {
    if (openingPickId || replicationToProgress) return;
    openingPickId = pick.id;
    const operation = new AbortController();
    pickDownload = operation;
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
        editorsPicksOpen = false;
        openBook(storedId);
        return;
      }

      initializeReplicationProgressData();
      const handler = new EditorsPickStorageHandler(window, digest, owner, signal);
      handler.updateSettings(
        window,
        true,
        $replicationSaveBehavior$,
        $statisticsMergeMode$,
        $readingGoalsMergeMode$
      );
      const importCancellation = cancelToken;
      const abortImport = () => importCancellation.abort();
      signal.addEventListener('abort', abortImport, { once: true });
      try {
        const error = await importData(document, handler, [file], cancelSignal);
        throwIfAborted(signal);
        if (error) throw new Error(error);
      } finally {
        signal.removeEventListener('abort', abortImport);
        resetProgress();
      }
      throwIfAborted(signal);
      if (handler.savedId === undefined)
        throw new Error('The book could not be added to this browser.');
      await validateEditorsPickCopy(handler.savedId, digest, owner, signal);
      storageSource$.next(StorageKey.BROWSER);
      editorsPicksOpen = false;
      openBook(handler.savedId);
    } catch (error) {
      if (!signal.aborted && !(error instanceof DOMException && error.name === 'AbortError'))
        showError(
          'Could not open book',
          error instanceof Error ? error.message : String(error),
          'The catalog book could not be opened.'
        );
    } finally {
      if (pickDownload === operation) {
        pickDownload = undefined;
        openingPickId = '';
      }
    }
  }

  function showError(title: string, message: string, fallbackMessage: string) {
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

  function initializeReplicationProgressData() {
    replicationDone = new Subject<void>();
    replicationProgress$.pipe(takeUntil(replicationDone)).subscribe(updateProgress);
    replicationProgressRemaining = '~ ??:??:??';
    replicationProgress = 0;
    replicationToProgress = 1;
    executionStart = Date.now();

    logger.clearHistory();

    cancelToken = new AbortController();
    cancelSignal = cancelToken.signal;
  }

  function resetProgress() {
    replicationDone.next();
    replicationDone.complete();
    replicationToProgress = 0;
    replicationProgress = 0;
    cancelTooltip = '';
  }

  function onSelectAllBooks() {
    selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
      selectableBookIds.forEach((id) => set.add(id));
    });
  }

  function toggleSelectedBooks(bookIds: number[]) {
    if (!bookIds.length) return;
    const allSelected = bookIds.every((id) => selectedBookIds.has(id));
    selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
      for (const id of bookIds) {
        if (allSelected) set.delete(id);
        else set.add(id);
      }
    });
  }

  function updateSelectionScope(key: string, ids: number[]) {
    selectableBookIds = ids;
    if (key !== selectionScopeKey) {
      selectionScopeKey = key;
      selectedBookIds = new Set();
    } else {
      const eligible = new Set(ids);
      selectedBookIds = new Set([...selectedBookIds].filter((id) => eligible.has(id)));
    }
  }

  function toggleCollections() {
    collectionsOpen = true;
  }

  function backToCurrentBook() {
    const currentBookId = $currentBookId$;
    if (!currentBookId || !currentBookAvailable) return;
    gotoBook(currentBookId);
  }

  async function removeBooks(bookIds: number[]) {
    if (!operationAllowed()) {
      return;
    }

    cancelTooltip = `Cancels the Deletion\nAlready deleted data will not be restored`;

    initializeReplicationProgressData();

    const currentBookCount = $bookCards$.length;
    const handler = getStorageHandler(window, $storageSource$, '');
    const { error, deleted } =
      handler instanceof BrowserStorageHandler
        ? await handler.deleteBookIds(bookIds, cancelSignal, $keepLocalStatisticsOnDeletion$)
        : await handler.deleteBookData(
            $bookCards$.reduce((toDelete, card) => {
              if (bookIds.includes(card.id)) toDelete.push(card.title);
              return toDelete;
            }, [] as string[]),
            cancelSignal,
            $keepLocalStatisticsOnDeletion$
          );

    resetProgress();

    await tick();

    if (deleted.length === currentBookCount) {
      selectMode = false;
    } else {
      selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
        deleted.forEach((deletedBookId) => set.delete(deletedBookId));
      });
    }

    if (error) {
      showError('Deletion failed', error, 'Error(s) occurred during deletion');
    }
  }

  async function onImportBackup(file: File) {
    if (!operationAllowed()) {
      return;
    }

    const errorTitle = 'Import failed';

    cancelTooltip = `Cancels the current Import\nAlready imported data will not be deleted`;

    initializeReplicationProgressData();

    if (!file.name.endsWith('.zip')) {
      resetProgress();

      showError(errorTitle, 'Invalid file - expected zip archive', '');
      return;
    }

    const error = await importBackup(
      getStorageHandler(
        window,
        StorageKey.BACKUP,
        undefined,
        $storageSource$ === StorageKey.BROWSER,
        $cacheStorageData$,
        $replicationSaveBehavior$,
        $statisticsMergeMode$,
        $readingGoalsMergeMode$
      ),
      getStorageHandler(
        window,
        $storageSource$,
        '',
        $storageSource$ === StorageKey.BROWSER,
        $cacheStorageData$,
        $replicationSaveBehavior$,
        $statisticsMergeMode$,
        $readingGoalsMergeMode$
      ),
      file,
      cancelSignal
    ).catch((err) => err.message);

    resetProgress();

    if (error) {
      showError(errorTitle, error, 'Error(s) occurred during import');
    }
  }

  function onDomainHintClick() {
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

  function onBugReportClick() {
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

  function onReplicateData() {
    dialogManager.dialogs$.next([{ component: BookExportDialog, disableCloseOnClick: true }]);
  }

  async function onDeleteStatistics() {
    const titles = $bookCards$
      .filter((card) => selectedBookIds.has(card.id))
      .map((book) => book.title);

    let wasCanceled = false;

    if ($confirmStatisticsDeletion$) {
      wasCanceled = await new Promise((resolver) => {
        dialogManager.dialogs$.next([
          {
            component: ConfirmDialog,
            props: {
              dialogHeader: 'Delete Data',
              dialogMessage: `This will delete all Statistics for the selected ${pluralize(
                titles.length,
                'Title',
                false
              )} (which may include start and/or completion Data)\n\nExecute a one time Sync with an export behavior of "replace" and/or statistics merge mode of "replace" to apply deletions to other devices`,
              contentStyles: 'white-space: pre-line;',
              resolver
            }
          }
        ]);
      });
    }

    if (wasCanceled) {
      return;
    }

    cancelTooltip = `Cancels the current Process`;

    initializeReplicationProgressData();

    const limiter = pLimit(1);
    const tasks: Promise<void>[] = [];

    let failed = 0;

    replicationProgress$.next({ progressBase: 1, maxProgress: titles.length });

    titles.forEach((title) => {
      tasks.push(
        limiter(async () => {
          try {
            throwIfAborted(cancelSignal);
            await database.deleteStatisticEntries([title], true);

            replicationProgress$.next({ progressToAdd: 1 });
          } catch (error) {
            handleErrorDuringReplication(error, `Error on deleting statistics for ${title}: `, [
              limiter
            ]);

            failed += 1;
          }
        })
      );
    });

    await Promise.all(tasks).catch(() => {});

    resetProgress();

    if (failed) {
      const errorMessage = `Unable to delete statistics of ${pluralize(failed, 'Title')}`;

      showError('Deletion Failed', errorMessage, errorMessage);
    }
  }

  function updateProgress(replicationProgressData: ReplicationProgress) {
    if (cancelSignal.aborted) {
      return;
    }

    progressBase = replicationProgressData.progressBase || progressBase || 0;
    replicationToProgress = replicationProgressData.maxProgress || replicationToProgress || 0;

    if (replicationProgressData.skipStep) {
      const progressDiffToAdd =
        Math.ceil(replicationProgress / progressBase) * progressBase - replicationProgress;

      replicationProgress =
        Math.floor(
          (replicationProgress + (progressDiffToAdd || progressBase) + Number.EPSILON) * 1000
        ) / 1000;
    } else if (replicationProgressData.completeStep) {
      const progressDiffToAdd = Math.ceil(replicationProgress) - replicationProgress;

      replicationProgress =
        Math.floor((replicationProgress + progressDiffToAdd + Number.EPSILON) * 1000) / 1000;
    } else if (replicationProgressData.progressToAdd && replicationProgressData.progressToAdd > 0) {
      replicationProgress =
        Math.floor(
          (replicationProgress + replicationProgressData.progressToAdd + Number.EPSILON) * 1000
        ) / 1000;
    }

    if (replicationProgressData.progressToAdd) {
      const duration = (Date.now() - executionStart) / 1000;
      const processPerSecond = replicationProgress / duration;
      const remainingTime = (replicationToProgress - replicationProgress) / processPerSecond;

      replicationProgressRemaining =
        replicationToProgress > replicationProgress
          ? `~ ${getTimestamp(Math.ceil(remainingTime))}`
          : '~ 00:00:01';
    }
  }

  const replicator$ = executeReplicate$.pipe(
    switchMap(async () => {
      if (!operationAllowed()) {
        return;
      }

      cancelTooltip = 'Cancels the current export';

      initializeReplicationProgressData();

      const handlers = [$storageSource$, $lastExportedTarget$].map((storageType) =>
        getStorageHandler(
          window,
          storageType,
          '',
          $lastExportedTarget$ === StorageKey.BROWSER,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        )
      );
      const books = $bookCards$.filter((card) => selectedBookIds.has(card.id));
      const error = await replicateData(
        handlers[0],
        handlers[1],
        false,
        books.map((book) => ({ id: book.id, title: book.title, imagePath: book.imagePath })),
        $lastExportedTypes$,
        cancelSignal
      ).catch((err) => err.message);

      resetProgress();

      if (error) {
        showError('Export failed', error, 'Error(s) occurred during export');
      }
    }),
    reduceToEmptyString()
  );

  function getTimestamp(seconds: number) {
    return seconds && Number.isFinite(seconds)
      ? new Date(seconds * 1000).toISOString().substr(11, 8)
      : '??:??:??';
  }
</script>

{#snippet emptyLibrary()}
  <section
    data-slot="library-empty-state"
    class="mx-auto mt-6 min-w-0 max-w-4xl rounded-3xl border border-border bg-card p-[20px] text-left shadow-sm sm:mt-10 sm:p-8"
  >
    <h2 class="text-xl font-semibold">Make room for a good book</h2>
    <p class="mt-2 text-sm text-muted-foreground">
      Add your own books, connect a library, or open one of our picks.
    </p>
    <div class="mt-7 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-7 sm:grid-cols-2">
      <section aria-labelledby="add-books-heading">
        <h3 id="add-books-heading" class="text-base font-semibold">Add books</h3>
        <div class="mt-3 grid gap-2">
          <Button
            class="min-h-11 w-full"
            size="lg"
            onclick={() => bookManagerHeader?.openFilePicker()}>Import File(s)</Button
          >
          {#if !$isMobile$}<Button
              class="min-h-11 w-full justify-start"
              variant="outline"
              onclick={() => bookManagerHeader?.openFolderPicker()}>Import Folder(s)</Button
            >{/if}
          <Button
            class="min-h-11 w-full justify-start"
            variant="outline"
            onclick={() => bookManagerHeader?.openBackupPicker()}>Import Backup</Button
          >
          <Button href={resolve('/import-ttu')} class="min-h-11 w-full justify-start" variant="link"
            ><span>Import from Ttu Ebook Reader</span><CaretRightIcon
              class="size-4 rtl:rotate-180"
              aria-hidden="true"
            /></Button
          >
          <Button
            href={resolve('/import-ttu?source=yatsu')}
            class="min-h-11 w-full justify-start"
            variant="link"
            ><span>Import from Yatsu Reader</span><CaretRightIcon
              class="size-4 rtl:rotate-180"
              aria-hidden="true"
            /></Button
          >
        </div>
        <p class="mt-3 text-xs text-muted-foreground">You can also drop ebook files here.</p>
      </section>
      <section aria-labelledby="connect-library-heading">
        <h3 id="connect-library-heading" class="text-base font-semibold">Connect a library</h3>
        <div class="mt-3 grid gap-2">
          <Button
            href={`${resolve('/connections')}#local-heading`}
            class="min-h-11 w-full justify-start"
            variant="secondary">Local folder</Button
          >
          <Button
            href={`${resolve('/connections')}#cloud-heading`}
            class="min-h-11 w-full justify-start"
            variant="secondary">Google Drive</Button
          >
          <Button
            href={`${resolve('/connections')}#cloud-heading`}
            class="min-h-11 w-full justify-start"
            variant="secondary">Dropbox</Button
          >
          <Button
            href={`${resolve('/connections')}#cloud-heading`}
            class="min-h-11 w-full justify-start"
            variant="secondary">OneDrive</Button
          >
        </div>
      </section>
    </div>
    <!-- Unknown ownership is not an empty Library. Do not start an optional
         catalog request just to cancel it as soon as saved cards become visible. -->
    {#if $storageSource$ !== StorageKey.BROWSER || ($allLinkedBooks !== null && $account.status !== 'loading' && !activeLibraryCards.length)}
      <div class="mt-8">
        <EditorsPicks
          embedded
          headingId="editors-picks-empty-heading"
          openingId={openingPickId}
          on:open={(event) => openEditorsPick(event.detail)}
        />
      </div>
    {/if}
  </section>
{/snippet}

<svelte:head>
  <title>{formatPageTitle('Library')}</title>
</svelte:head>

<svelte:window onpagehide={() => pickDownload?.abort()} bind:scrollY={libraryScrollY} />

{$replicator$ ?? ''}

<div class="min-h-full">
  <div
    class:scrolled={libraryScrollY > 8}
    class:library-nav-shell={$storageSource$ === StorageKey.BROWSER}
    class="sticky top-0 z-10"
    bind:clientHeight={libraryHeaderHeight}
  >
    <BookManagerHeader
      bind:this={bookManagerHeader}
      modernLibrary={$storageSource$ === StorageKey.BROWSER}
      title={destinationTitle}
      {libraryMenu}
      collectionsExpanded={collectionsOpen}
      hasBookOpened={currentBookAvailable}
      selectedCount={selectedBookIds.size}
      hasBooks={$storageSource$ === StorageKey.BROWSER
        ? !!activeLibraryCards.length
        : !!$bookCards$?.length}
      {cancelTooltip}
      {replicationProgress}
      {replicationToProgress}
      {replicationProgressRemaining}
      bind:selectMode
      on:collectionsClick={toggleCollections}
      on:editorsPicksClick={() => (editorsPicksOpen = true)}
      on:selectAllClick={onSelectAllBooks}
      on:backToBookClick={backToCurrentBook}
      on:removeClick={() => removeBooks(Array.from(selectedBookIds))}
      on:filesChange={(ev) => onFilesChange(ev.detail)}
      on:domainHintClick={onDomainHintClick}
      on:bugReportClick={onBugReportClick}
      on:cancelReplication={() => {
        if (!cancelSignal.aborted) {
          cancelToken.abort();
          pickDownload?.abort();
          replicationProgressRemaining = 'Canceling ...';
        }
      }}
      on:selectionToStatistics={() => {
        $preFilteredTitlesForStatistics$ = new Set(
          $bookCards$.filter((card) => selectedBookIds.has(card.id)).map((book) => book.title)
        );

        goto(`${pagePath}${mergeEntries.STATISTICS.routeId}`);
      }}
      on:deleteStatistics={onDeleteStatistics}
      on:replicateData={onReplicateData}
      on:importBackup={(ev) => onImportBackup(ev.detail)}
    />
  </div>

  <div
    role="region"
    aria-label="Book library"
    style:--library-header-height={`${libraryHeaderHeight}px`}
    class={$storageSource$ === StorageKey.BROWSER ? 'min-h-full' : `${pxScreen} min-h-full pt-3`}
    on:dragenter={(ev) => ev.preventDefault()}
    on:dragover={(ev) => ev.preventDefault()}
    on:dragend={(ev) => ev.preventDefault()}
    on:drop={(ev) => ev.preventDefault()}
    on:drop={(ev) => getDropEventFiles(ev).then(onFilesChange)}
  >
    {#if !$bookCards$ || $booksAreLoading$}
      Loading...
    {:else if $storageSource$ === StorageKey.BROWSER}
      <LibraryWorkspace
        currentBookId={currentBookAvailable ? $currentBookId$ : undefined}
        {selectedBookIds}
        {selectMode}
        bind:destinationTitle
        bind:collectionsOpen
        bind:menu={libraryMenu}
        bookCards={$bookCards$}
        on:prepareBook={(ev) => onBookClick(undefined, ev.detail.prepare, ev.detail.locator)}
        on:bookClick={(ev) => onBookClick(ev.detail.id)}
        on:selectionManyClick={(ev) => toggleSelectedBooks(ev.detail.ids)}
        on:selectionScopeChange={(ev) => updateSelectionScope(ev.detail.key, ev.detail.ids)}
        on:removeBookClick={(ev) => removeBooks([ev.detail.id])}
      >
        {@render emptyLibrary()}
      </LibraryWorkspace>
    {:else if $bookCards$.length}
      <BookCardList
        currentBookId={$currentBookId$}
        {selectedBookIds}
        bookCards={$bookCards$}
        on:bookClick={(ev) => onBookClick(ev.detail.id)}
        on:removeBookClick={(ev) => removeBooks([ev.detail.id])}
      />
    {:else}
      {@render emptyLibrary()}
    {/if}
  </div>
</div>

<Dialog.Root bind:open={editorsPicksOpen}>
  <Dialog.Content class="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Title class="sr-only">Editor's Picks</Dialog.Title>
    <Dialog.Description class="sr-only">Open a book selected by Manabi.</Dialog.Description>
    {#if editorsPicksOpen}
      <EditorsPicks
        headingId="editors-picks-dialog-heading"
        openingId={openingPickId}
        on:open={(event) => openEditorsPick(event.detail)}
      />
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  .library-nav-shell {
    pointer-events: none;
  }
  .library-nav-shell::before {
    content: '';
    position: absolute;
    inset: 0 0 -20px;
    pointer-events: none;
    opacity: 0;
    background: linear-gradient(
      to bottom,
      color-mix(in oklch, var(--background) 94%, transparent),
      color-mix(in oklch, var(--background) 94%, transparent) calc(100% - 20px),
      transparent
    );
    backdrop-filter: blur(14px);
    /* Keep the entire wrapped toolbar legible; only fade below its edge. */
    mask-image: linear-gradient(to bottom, #000 0%, #000 calc(100% - 20px), transparent 100%);
    transition: opacity 180ms ease;
  }
  .library-nav-shell.scrolled::before {
    opacity: 1;
  }
  .library-nav-shell :global(header) {
    position: relative;
    pointer-events: auto;
  }
  @media (min-width: 1024px) {
    .library-nav-shell::before {
      left: 16rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .library-nav-shell::before {
      transition: none;
    }
  }
</style>
