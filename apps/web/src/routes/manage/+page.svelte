<script lang="ts">
  import { progressFraction } from '$lib/library/completion';
  import { goto } from '$app/navigation';
  import BookCardList from '$lib/components/book-card/book-card-list.svelte';
  import LibraryWorkspace from '$lib/library/library-workspace.svelte';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import BookManagerHeader from '$lib/components/book-card/book-manager-header.svelte';
  import BookExportDialog from '$lib/components/book-export/book-export-dialog.svelte';
  import { Button } from '$lib/components/ui/button';
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
  import { inputFile } from '$lib/functions/file-dom/input-file';
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
  import { pluralize } from '$lib/functions/utils';
  import { creatorSortKey } from '$lib/library/book-metadata';
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
  let cancelToken = new AbortController();
  let cancelSignal = cancelToken.signal;
  let cancelTooltip = '';
  let replicationProgress = 0;
  let replicationToProgress = 0;
  let replicationProgressRemaining = '~ ??:??:??';
  let replicationDone = new Subject<void>();
  let progressBase = 0;
  let executionStart: number;
  let firstBookFileInput: HTMLInputElement;
  let collectionsOpen = false;
  let destinationTitle = 'Library';
  let selectionScopeKey = '';
  let selectableBookIds: number[] = [];
  let libraryMenu: LibraryMenuModel | undefined;

  $: {
    if (!selectMode) {
      selectedBookIds = new Set();
    }
  }

  onDestroy(() => dialogManager.dialogs$.next([]));

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

  async function onBookClick(bookId: number) {
    if (!operationAllowed()) {
      return;
    }

    if (!selectMode) {
      dialogManager.dialogs$.next([
        {
          component: '<div/>',
          disableCloseOnClick: true
        }
      ]);

      let idToOpen = bookId;

      try {
        const bookItem =
          $bookCards$.find((book) => book.id === bookId) ??
          ($storageSource$ === StorageKey.BROWSER ? await database.getData(bookId) : undefined);

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

          if (nextAction === 'cancel') {
            return;
          }

          if (nextAction === 'export') {
            selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
              set.add(bookId);
            });
            selectMode = true;

            await tick();

            return onReplicateData();
          }
        }

        dialogManager.dialogs$.next([]);
      } catch (error: any) {
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

      openBook(idToOpen);
      return;
    }

    selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
      if (set.has(bookId)) {
        set.delete(bookId);
        return;
      }
      set.add(bookId);
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

  function openBook(bookId: number) {
    if (!bookId) {
      return;
    }

    database.putLastItem(bookId);
    gotoBook(bookId);
  }

  async function gotoBook(id: number) {
    await goto(`${pagePath}/b?id=${id}`);
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
    if (!currentBookId) return;
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
    class="mx-auto mt-12 max-w-xl rounded-3xl border border-dashed border-border bg-card p-8 text-center"
  >
    <h2 class="text-xl font-semibold">Make room for a good book</h2>
    <p class="mt-2 text-sm text-muted-foreground">
      Open EPUB, HTMLZ, or text files. Your books stay on this device unless you choose a connected
      library.
    </p>
    <Button class="mt-5" size="lg" onclick={() => firstBookFileInput.click()}>
      Add your first book
    </Button>
    <input
      id="first-book-file"
      hidden
      type="file"
      accept="application/epub+zip,.epub,.epub.zip,.htmlz,plain/text,.txt"
      multiple
      aria-label="Add your first book"
      use:inputFile={onFilesChange}
      bind:this={firstBookFileInput}
    />
    <p class="mt-4 text-xs text-muted-foreground">
      You can also drop files here or use Add books for folders, backups, and Ttu imports.
    </p>
  </section>
{/snippet}

<svelte:head>
  <title>{formatPageTitle('Library')}</title>
</svelte:head>

{$replicator$ ?? ''}

<div class="min-h-full">
  <div class="sticky top-0 z-10" bind:clientHeight={libraryHeaderHeight}>
    <BookManagerHeader
      modernLibrary={$storageSource$ === StorageKey.BROWSER}
      title={destinationTitle}
      {libraryMenu}
      collectionsExpanded={collectionsOpen}
      hasBookOpened={!!$currentBookId$}
      selectedCount={selectedBookIds.size}
      hasBooks={!!$bookCards$?.length}
      {cancelTooltip}
      {replicationProgress}
      {replicationToProgress}
      {replicationProgressRemaining}
      bind:selectMode
      on:collectionsClick={toggleCollections}
      on:selectAllClick={onSelectAllBooks}
      on:backToBookClick={backToCurrentBook}
      on:removeClick={() => removeBooks(Array.from(selectedBookIds))}
      on:filesChange={(ev) => onFilesChange(ev.detail)}
      on:domainHintClick={onDomainHintClick}
      on:bugReportClick={onBugReportClick}
      on:cancelReplication={() => {
        if (!cancelSignal.aborted) {
          cancelToken.abort();
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
        currentBookId={$currentBookId$}
        {selectedBookIds}
        {selectMode}
        bind:destinationTitle
        bind:collectionsOpen
        bind:menu={libraryMenu}
        bookCards={$bookCards$}
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
