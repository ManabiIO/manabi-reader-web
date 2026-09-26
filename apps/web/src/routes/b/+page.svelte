<script lang="ts">
  import type { Paginator } from '$lib/foliate-epub/paginator.js';
  import AudiobookLauncher from '$lib/features/whispersync/audiobook-launcher.svelte';
  import * as Sheet from '$lib/components/ui/sheet';
  import { setCompletion } from '$lib/library/commands';
  import { readerUIOwnsEvent } from '$lib/functions/reader-ui-events';
  import {
    auditTime,
    debounceTime,
    distinctUntilChanged,
    EMPTY,
    filter,
    fromEvent,
    map,
    merge,
    NEVER,
    of,
    share,
    shareReplay,
    skip,
    startWith,
    switchMap,
    take,
    takeWhile,
    tap,
    timer
  } from 'rxjs';
  import { quintInOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import faCloudBolt from '@lucide/svelte/icons/cloud-alert';
  import faPause from '@lucide/svelte/icons/pause';
  import faPlay from '@lucide/svelte/icons/play';
  import faSpinner from '@lucide/svelte/icons/loader-circle';
  import { effectivePrimaryReaderFont } from '$lib/data/reader-typography';
  import BookReader from '$lib/components/book-reader/book-reader.svelte';
  import type {
    AutoScroller,
    BookmarkManager,
    PageManager
  } from '$lib/components/book-reader/types';
  import LogReportDialog from '$lib/components/log-report-dialog.svelte';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import StyleSheetRenderer from '$lib/components/style-sheet-renderer.svelte';
  import {
    autoBookmark$,
    autoBookmarkTime$,
    autoPositionOnResize$,
    avoidPageBreak$,
    bookReaderKeybindMap$,
    database,
    enableTapEdgeToFlip$,
    enableTextJustification$,
    enableTextWrapPretty$,
    firstDimensionMargin$,
    fontFamilyGroupOne$,
    fontFamilyGroupTwo$,
    yuKyokashoAvailable$,
    fontSize$,
    fontWeight$,
    furiganaStyle$,
    hideFurigana$,
    hideSpoilerImage$,
    multiplier$,
    pageColumns$,
    prioritizeReaderStyles$,
    secondDimensionMaxValue$,
    showFooterChapterCharacterCounter$,
    showFooterChapterPercentage$,
    textIndentation$,
    textMarginMode$,
    textMarginValue$,
    trackerAutostartTime$,
    verticalMode$,
    writingMode$,
    viewMode$,
    selectionToBookmarkEnabled$,
    lineHeight$,
    syncTarget$,
    autoReplication$,
    skipKeyDownListener$,
    replicationSaveBehavior$,
    cacheStorageData$,
    confirmClose$,
    verticalCustomReadingPosition$,
    horizontalCustomReadingPosition$,
    customReadingPointEnabled$,
    statisticsEnabled$,
    openTrackerOnCompletion$,
    addCharactersOnCompletion$,
    statisticsMergeMode$,
    isOnline$,
    manualBookmark$,
    overwriteBookCompletion$,
    startDayHoursForTracker$,
    readingGoalsMergeMode$,
    pauseTrackerOnCustomPointChange$,
    hideSpoilerImageMode$,
    showCharacterCounter$,
    showPercentage$,
    enableVerticalFontKerning$,
    enableFontVPAL$,
    verticalTextOrientation$
  } from '$lib/data/store';
  import BookCompletionConfetti from '$lib/components/book-reader/book-completion-confetti/book-completion-confetti.svelte';
  import BookReaderHeader from '$lib/components/book-reader/book-reader-header.svelte';
  import DictionarySetup from '$lib/components/book-reader/dictionary-setup.svelte';
  import ReaderAppearance from '$lib/components/book-reader/reader-appearance.svelte';
  import ReaderLineGuide from '$lib/components/book-reader/reader-line-guide.svelte';
  import ReaderSearch from '$lib/components/book-reader/reader-search.svelte';
  import ReaderScrubber from '$lib/components/book-reader/reader-scrubber.svelte';
  import ReaderAnnotations from '$lib/components/book-reader/reader-annotations.svelte';
  import ReaderHighlights from '$lib/components/book-reader/reader-highlights.svelte';
  import {
    exportReaderAnnotations,
    importReaderAnnotations,
    listAnnotationImportConflicts,
    listReaderAnnotations,
    removeReaderAnnotation,
    resolveAnnotationImportConflict,
    saveReaderAnnotation
  } from '$lib/reader-annotations';
  import type { AnnotationImportConflict } from '$lib/reader-annotations';
  import { account, currentUser } from '$lib/manabi/client';
  import { legacyReplicationTypes } from '$lib/manabi/legacy-replication';
  import type { ReaderAnnotation } from '$lib/data/database/books-db/versions/v7/books-db-v7';
  import { ReaderNavigation } from '$lib/reader-navigation';
  import { acquireReaderLease } from '$lib/webdav/reader-lock';
  import { takeLibraryLocation } from '$lib/library/search-navigation';
  import type { ReaderLocator } from '$lib/reader-location';
  import { readerBookKeyFor } from '$lib/reader-identity';
  import { readerSourceFormat } from '$lib/reader-source-format';
  import { TextAlignLeft, X } from 'phosphor-svelte';
  import {
    readerImageGalleryPictures$,
    toggleImageGalleryPictureSpoiler$,
    updateImageGalleryPictureSpoilers$
  } from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
  import BookReaderImageGallery from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery.svelte';
  import {
    getDefaultStatistic,
    isTrackerMenuOpen$,
    isTrackerPaused$
  } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import BookReadingTracker from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker.svelte';
  import {
    getChapterData,
    nextChapter$,
    sectionList$,
    sectionProgress$,
    tocIsOpen$,
    type SectionWithProgress
  } from '$lib/components/book-reader/book-toc/book-toc';
  import BookToc from '$lib/components/book-reader/book-toc/book-toc.svelte';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import NumberDialog from '$lib/components/number-dialog.svelte';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import { preFilteredTitlesForStatistics$ } from '$lib/components/statistics/statistics-types';
  import {
    currentDbVersion,
    type BooksDbBookData,
    type BooksDbBookmarkData,
    type BooksDbStatistic
  } from '$lib/data/database/books-db/versions/books-db';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { pagePath } from '$lib/data/env';
  import { DB_VERSION, PAGE_CHANGE, SKIPKEYLISTENER, SYNCED } from '$lib/data/events';
  import { fullscreenManager } from '$lib/data/fullscreen-manager';
  import { logger } from '$lib/data/logger';
  import { MergeMode } from '$lib/data/merge-mode';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
  import type { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
  import {
    StorageDataType,
    StorageSourceDefault,
    StorageKey
  } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import { readerTheme } from '$lib/data/theme-option';
  import { ViewMode } from '$lib/data/view-mode';
  import loadBookData from '$lib/functions/book-data-loader/load-book-data';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { iffBrowser } from '$lib/functions/rxjs/iff-browser';
  import {
    AutoReplicationType,
    ReplicationSaveBehavior
  } from '$lib/functions/replication/replication-options';
  import { replicateData } from '$lib/functions/replication/replicator';
  import { readableToObservable } from '$lib/functions/rxjs/readable-to-observable';
  import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
  import { takeWhenBrowser } from '$lib/functions/rxjs/take-when-browser';
  import { tapDom } from '$lib/functions/rxjs/tap-dom';
  import { multiClickHandler } from '$lib/functions/multi-click-handler';
  import {
    executeReplicate$,
    type ReplicationContext
  } from '$lib/functions/replication/replication-progress';
  import { getDateKey } from '$lib/functions/statistic-util';
  import { clickOutside } from '$lib/functions/use-click-outside';
  import {
    convertRemToPixels,
    dummyFn,
    isMobile$,
    limitToRange,
    getWeightedAverage
  } from '$lib/functions/utils';
  import { onKeydownReader } from './on-keydown-reader';
  import { onDestroy, onMount, tick } from 'svelte';
  import AppIcon from '$lib/components/app-icon.svelte';
  import {
    getParagraphToPoint,
    getRangeForUserSelection,
    getReferencePoints,
    pulseElement
  } from '$lib/functions/range-util';

  let showSpinner = true;
  let showHeader = false;
  let foliatePagination = false;
  let showAppearance = false;
  let showBookSearch = false;
  let showScrubber = false;
  let scrubberPoint: ReaderLocator | undefined;
  let showAnnotations = false;
  let annotations: ReaderAnnotation[] = [];
  let annotationsOwner: string | null | undefined;
  let annotationImportConflicts: AnnotationImportConflict[] = [];
  let annotationSelection: ReaderLocator[] = [];
  let annotationPoint: ReaderLocator | undefined;
  let annotationError = '';
  let annotationStatus = '';
  let annotationBusy = false;
  let annotationSavedVersion = 0;
  let activeSearchLocator: ReaderLocator | undefined;
  let readerContentEpoch = 0;
  let bookReaderComponent: BookReader | undefined;
  const readerNavigation = new ReaderNavigation();
  let navigationPreviewing = false;
  let searchOrigin: ReaderLocator | undefined;
  let pendingPreviewAdoption = false;
  let suppressResumeSave = false;
  let revealingReaderLocator = false;
  let previewTrackerWasPaused = false;
  let readerBookKey = '';
  let libraryTarget: ReaderLocator | undefined;
  let libraryNavigationTask = false;
  let libraryNavigationEpoch = 0;
  let librarySearchMessage = '';
  $: if (
    browser &&
    libraryTarget &&
    bookReaderComponent &&
    readerBookKey &&
    guideContentEl &&
    !libraryNavigationTask
  )
    void openLibraryTarget();
  $: if (browser && $rawBookData$?.id) {
    const book = $rawBookData$;
    void readerBookKeyFor(book.id, book.contentHash).then((key) => {
      if ($rawBookData$?.id === book.id) readerBookKey = key;
    });
  }
  $: if (browser && readerBookKey && $account.status) {
    const key = readerBookKey;
    const owner = $account.session?.user?.id ?? null;
    if (annotationsOwner !== owner) {
      annotations = [];
      annotationImportConflicts = [];
      annotationsOwner = owner;
    }
    void listReaderAnnotations(key)
      .then((items) => {
        if (readerBookKey === key && (currentUser()?.id ?? null) === owner) annotations = items;
      })
      .catch(() => undefined);
  }
  let lineGuideEnabled = browser && localStorage.getItem('manabi-line-guide') === 'true';
  let lineGuideLines: 1 | 3 =
    browser && localStorage.getItem('manabi-line-guide-lines') === '3' ? 3 : 1;
  let lineGuideDimming = browser
    ? Math.max(
        0.1,
        Math.min(0.6, Number(localStorage.getItem('manabi-line-guide-dimming')) || 0.28)
      )
    : 0.28;
  let guideContentEl: HTMLElement | undefined;
  let dictionarySetup: DictionarySetup | undefined;
  $: if (browser) localStorage.setItem('manabi-line-guide', String(lineGuideEnabled));
  $: if (browser) localStorage.setItem('manabi-line-guide-lines', String(lineGuideLines));
  $: if (browser) localStorage.setItem('manabi-line-guide-dimming', String(lineGuideDimming));
  let isBookmarkScreen = false;
  let showFooter = true;
  let exploredCharCount = 0;
  let bookCharCount = 0;
  let autoScroller: AutoScroller | undefined;
  let bookmarkManager: BookmarkManager | undefined;
  let pageManager: PageManager | undefined;
  let bookmarkData: Promise<BooksDbBookmarkData | undefined> = Promise.resolve(undefined);
  let customReadingPointTop = -2;
  let customReadingPointLeft = -2;
  let customReadingPoint = $verticalMode$
    ? $verticalCustomReadingPosition$
    : $horizontalCustomReadingPosition$;
  let customReadingPointScrollOffset = 0;
  let customReadingPointRange: Range | undefined;
  let lastSelectedRange: Range | undefined;
  let lastSelectedRangeWasEmpty = true;
  let isSelectingCustomReadingPoint = false;
  let showCustomReadingPoint = false;
  let localStorageHandler: BrowserStorageHandler;
  let dataToReplicate: StorageDataType[] = [];
  let dataToReplicateQueue: StorageDataType[] = [];
  let externalStorageHandler: BaseStorageHandler | undefined;
  let personalManagedBookId: number | undefined;
  const personalReplicationTypes = [StorageDataType.PROGRESS, StorageDataType.STATISTICS];
  let externalStorageErrors = 0;
  let isReplicating = false;
  let storedExploredCharacter = 0;
  let hasBookmarkData = false;
  let blockDataUpdates = false;
  let trackerElm: BookReadingTracker;
  let showTrackerIcon = false;
  let wasTrackerPaused = true;
  let frozenPosition = -1;
  let skipFirstFreezeChange = false;
  let bookCompleted = false;
  let confettiWidthModifier = 36;
  let confettiMaxRuns = 0;
  let showReaderImageGallery = false;
  let dismissDialogs = true;
  let syncedResolver: () => void;

  const syncedPromise = new Promise<void>((resolver) => {
    syncedResolver = resolver;
  });
  const queuedReaderImageGalleryPictures = new Map<string, boolean>();
  const fontFeatureSettings = [
    $enableVerticalFontKerning$ && '"vkrn"',
    $enableFontVPAL$ && '"vpal"'
  ]
    .filter((f) => !!f && $verticalMode$)
    .join(', ');
  const verticalTextOrientation = $verticalMode$ ? $verticalTextOrientation$ : '';

  const bookId$ = iffBrowser(() => readableToObservable(page)).pipe(
    map((pageObj) => Number(pageObj.url.searchParams.get('id'))),
    distinctUntilChanged(),
    shareReplay({ refCount: true, bufferSize: 1 })
  );

  const readerLeaseLifetime = new AbortController();
  let readerLease: Promise<void> | undefined;
  const rawBookData$ = bookId$.pipe(
    switchMap(async (id) => {
      let bookData: BooksDbBookData | undefined;

      try {
        readerLease ??= acquireReaderLease(readerLeaseLifetime.signal);
        await readerLease;
        if (readerLeaseLifetime.signal.aborted) return undefined;
        localStorageHandler = getStorageHandler(
          window,
          StorageKey.BROWSER,
          undefined,
          true,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        );

        localStorageHandler.startContext({ id, title: '' });
        bookData = await localStorageHandler.getBook();

        if (!bookData) {
          return bookData;
        }

        const personalReadingAuthority = await hasPersonalReadingAuthority(bookData);
        personalManagedBookId = personalReadingAuthority ? bookData.id : undefined;

        const currentContext = {
          id: bookData.id,
          title: bookData.title,
          imagePath: bookData.coverImage
        };

        localStorageHandler.startContext(currentContext);

        if (bookData.storageSource) {
          externalStorageHandler = await getStorageHandlerByName(bookData.storageSource, true);
        } else if ($autoReplication$ !== AutoReplicationType.Off) {
          externalStorageHandler = await getStorageHandlerByName($syncTarget$);
        }

        bookData.lastBookOpen = new Date().getTime();

        await localStorageHandler.updateLastRead(bookData);
        await syncDownData(externalStorageHandler, currentContext, bookData);

        if (!$statisticsEnabled$) {
          const wasNew = (
            await database.setFirstBookRead(
              currentContext.title,
              $startDayHoursForTracker$,
              undefined,
              currentContext.id
            )
          )[1];

          if (wasNew) {
            scheduleReplication(StorageDataType.STATISTICS);
          }
        }

        bookData = await saveExternalLastRead(externalStorageHandler, bookData);

        if (bookData.language) {
          document.documentElement.lang = bookData.language;
        }
      } catch (error: any) {
        if (readerLeaseLifetime.signal.aborted) return undefined;
        const message = `Error loading book: ${error.message}`;

        logger.warn(message);

        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: {
              title: 'Load Error',
              message
            }
          }
        ]);
        return undefined;
      } finally {
        syncedResolver();

        showSpinner = false;
      }

      if (externalStorageHandler) {
        externalStorageHandler.updateSettings(
          window,
          true,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$,
          $cacheStorageData$,
          false,
          bookData.storageSource || $syncTarget$
        );
      }

      return bookData;
    }),
    share()
  );

  const leaveIfBookMissing$ = rawBookData$.pipe(
    tap((data) => {
      if (!data && !readerLeaseLifetime.signal.aborted) {
        goto(`${pagePath}${mergeEntries.MANAGE.routeId}`);
      }
    }),
    reduceToEmptyString()
  );

  const bookData$ = rawBookData$.pipe(
    switchMap((rawBookData) => {
      if (!rawBookData) return EMPTY;

      // Initialize from this book before publishing renderable HTML. A hidden
      // template subscription to the non-replayed raw stream can miss its only
      // emission when Svelte mounts the conditional Reader subtree lazily.
      bookmarkData = database.getBookmark(rawBookData.id);
      const incomingLocation = takeLibraryLocation(
        rawBookData.id,
        currentUser()?.id ?? null,
        $page.url.searchParams.get('library-search')
      );
      if (incomingLocation) {
        libraryTarget = incomingLocation;
        suppressResumeSave = true;
        pauseTracker();
      }
      sectionList$.next(rawBookData.sections || []);

      return loadBookData(
        rawBookData,
        '.book-content',
        document,
        $viewMode$ === ViewMode.Paginated,
        $hideSpoilerImageMode$
      );
    }),
    shareReplay({ refCount: true, bufferSize: 1 })
  );

  const resize$ = iffBrowser(() =>
    visualViewport ? fromEvent(visualViewport, 'resize') : of()
  ).pipe(share());

  const containerViewportWidth$ = resize$.pipe(
    startWith(0),
    map(() => visualViewport?.width || 0),
    takeWhenBrowser()
  );

  const containerViewportHeight$ = resize$.pipe(
    startWith(0),
    map(() => visualViewport?.height || 0),
    takeWhenBrowser()
  );

  const themeOption$ = of(readerTheme);

  const backgroundColor$ = themeOption$.pipe(map((o) => o.backgroundColor));

  const collectReaderImageGallerySpoilerToggles$ = toggleImageGalleryPictureSpoiler$.pipe(
    tap((readerImageGalleryPicture) => {
      queuedReaderImageGalleryPictures.set(
        readerImageGalleryPicture.url,
        readerImageGalleryPicture.unspoilered
      );

      updateImageGalleryPictureSpoilers$.next();
    }),
    reduceToEmptyString()
  );

  const handleUpdateImageGalleryPictureSpoilers$ = updateImageGalleryPictureSpoilers$.pipe(
    debounceTime(250),
    tap(() => {
      $readerImageGalleryPictures$ = $readerImageGalleryPictures$.map((galleryPicture) => {
        const picture = galleryPicture;

        if (queuedReaderImageGalleryPictures.has(picture.url)) {
          picture.unspoilered = queuedReaderImageGalleryPictures.get(picture.url)!;
        }

        return picture;
      });

      queuedReaderImageGalleryPictures.clear();
    }),
    reduceToEmptyString()
  );

  const backgroundStyleName = 'background-color';
  const setBackgroundColor$ = backgroundColor$.pipe(
    tapDom(
      () => document.body,
      (backgroundColor, body) => body.style.setProperty(backgroundStyleName, backgroundColor),
      (body) => body.style.removeProperty(backgroundStyleName)
    ),
    reduceToEmptyString(),
    takeWhenBrowser()
  );

  const writingModeStyleName = 'writing-mode';
  const setWritingMode$ = writingMode$.pipe(
    tapDom(
      () => document.documentElement,
      (writingMode, documentElement) =>
        documentElement.style.setProperty(writingModeStyleName, writingMode),
      (documentElement) => documentElement.style.removeProperty(writingModeStyleName)
    ),
    reduceToEmptyString(),
    takeWhenBrowser()
  );

  const sectionData$ = iffBrowser(() => sectionProgress$).pipe(
    map((sectionProgress) => [...sectionProgress.values()])
  );

  const previewAdoption$ = iffBrowser(() => fromEvent(document, PAGE_CHANGE)).pipe(
    tap(() => {
      if (!pendingPreviewAdoption || !readerNavigation.previewing) return;
      pendingPreviewAdoption = false;
      void continueAtPreview();
    }),
    reduceToEmptyString()
  );

  function noteReaderSelection(range: Range | undefined) {
    if (!range && lastSelectedRangeWasEmpty) {
      lastSelectedRange = undefined;
    } else if (range) {
      lastSelectedRange = range;
      lastSelectedRangeWasEmpty = false;
    } else {
      lastSelectedRangeWasEmpty = true;
    }
  }

  const textSelector$ = iffBrowser(() => fromEvent(document, 'selectionchange')).pipe(
    debounceTime(200),
    tap(() => {
      const selection = window.getSelection();
      noteReaderSelection(selection?.toString() ? selection.getRangeAt(0).cloneRange() : undefined);
    }),
    reduceToEmptyString()
  );

  const replicator$ = executeReplicate$.pipe(
    auditTime(60000),
    switchMap(() => executeReplication()),
    reduceToEmptyString()
  );

  const autoStartTracker$ = iffBrowser(() =>
    $statisticsEnabled$ && $trackerAutostartTime$ > 0 ? fromEvent(document, PAGE_CHANGE) : NEVER
  ).pipe(
    debounceTime($trackerAutostartTime$ * 1000),
    take(1),
    tap(() => {
      wasTrackerPaused = false;
      isTrackerPaused$.next(wasTrackerPaused);
    }),
    reduceToEmptyString()
  );

  $: if ($tocIsOpen$) {
    autoScroller?.off();
  }

  $: if (browser && bookCharCount) {
    document.dispatchEvent(new CustomEvent(PAGE_CHANGE, { detail: { exploredCharCount } }));
  }

  $: if (browser) {
    document.dispatchEvent(new CustomEvent(PAGE_CHANGE, { detail: { bookCharCount } }));
  }

  $: if (showCustomReadingPoint) {
    pauseTracker();

    pulseElement(customReadingPointRange?.endContainer?.parentElement, 'add', 1);

    fromEvent(document, 'click')
      .pipe(skip(1), take(1))
      .subscribe(() => {
        showCustomReadingPoint = false;
        pulseElement(customReadingPointRange?.endContainer?.parentElement, 'remove', 1);
        restartTrackerAfterCharacterChangeOrTime(1);
      });
  }

  $: if (frozenPosition !== -1 && exploredCharCount >= frozenPosition) {
    if (skipFirstFreezeChange) {
      skipFirstFreezeChange = false;
    } else {
      frozenPosition = -1;
    }
  }

  $: isPaginated = $viewMode$ === ViewMode.Paginated;

  $: firstDimensionMargin =
    browser && $enableTapEdgeToFlip$ && isPaginated && $verticalMode$
      ? limitToRange(convertRemToPixels(window, 0.5), window.innerWidth, $firstDimensionMargin$)
      : ($firstDimensionMargin$ ?? 0);

  $: tapButtonHeight = 'calc(100% - 10rem - env(safe-area-inset-bottom))';

  $: tapButtonTop = 'calc(4.5rem + env(safe-area-inset-top))';

  $: footerChapterProgress = getCurrentChapterProgress($sectionData$);

  $: upSyncEnabled =
    externalStorageHandler &&
    ($autoReplication$ === AutoReplicationType.Up || $autoReplication$ === AutoReplicationType.All);

  $: bookmarkData.then((data) => {
    hasBookmarkData = !!data;
    storedExploredCharacter = data?.exploredCharCount || 0;
  });

  /** Experimental Code - May be removed any time without warning */

  $: if (browser) {
    document.dispatchEvent(new CustomEvent(SKIPKEYLISTENER, { detail: $skipKeyDownListener$ }));
  }

  onMount(() => document.addEventListener('ttu-action', handleAction, false));

  function handleAction({ detail }: any) {
    if (!detail.type) {
      return;
    }

    if (detail.type === 'dbVersion') {
      document.dispatchEvent(new CustomEvent(DB_VERSION, { detail: currentDbVersion }));
    } else if (detail.type === 'waitForSync') {
      syncedPromise.finally(() => document.dispatchEvent(new CustomEvent(SYNCED)));
    } else if (detail.type === 'skipKeyDownListener') {
      skipKeyDownListener$.next(detail.params.value);
    } else if (
      detail.type === 'sync' &&
      (detail.syncType === StorageDataType.AUDIOBOOK ||
        detail.syncType === StorageDataType.SUBTITLE)
    ) {
      scheduleReplication(detail.syncType);
    }
  }
  /** Experimental Code - May be removed any time without warning */

  onDestroy(() => {
    readerLeaseLifetime.abort();
    libraryNavigationEpoch++;
    if (browser) {
      document.removeEventListener('ttu-action', handleAction, false);
      document.documentElement.lang = 'ja';
    }

    readerImageGalleryPictures$.next([]);

    if (dismissDialogs) {
      dialogManager.dialogs$.next([]);
    }
  });

  function handleUnload(event: BeforeUnloadEvent) {
    if (
      $confirmClose$ &&
      (isReplicating ||
        storedExploredCharacter !== exploredCharCount ||
        (upSyncEnabled && dataToReplicate.length) ||
        (upSyncEnabled && dataToReplicateQueue.length))
    ) {
      event.preventDefault();
      // eslint-disable-next-line no-param-reassign
      return (event.returnValue = 'Are you sure you want to exit?');
    }

    return event;
  }

  function trackerSingleClickHandler() {
    if (!$statisticsEnabled$) {
      return;
    }

    wasTrackerPaused = $isTrackerPaused$;
    isTrackerPaused$.next(true);
    isTrackerMenuOpen$.next(true);
  }

  function trackerDblClickHandler() {
    if (!$statisticsEnabled$) {
      return;
    }

    dialogManager.dialogs$.next([]);
    wasTrackerPaused = !$isTrackerPaused$;
    isTrackerPaused$.next(wasTrackerPaused);
  }

  async function handleJump() {
    const dataId = getBookIdSync();

    if (!bookmarkManager || !dataId) {
      return;
    }

    pauseTracker();
    skipKeyDownListener$.next(true);

    const target = await new Promise<number | undefined>((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: NumberDialog,
          props: {
            dialogHeader: 'Jump to Position',
            minValue: 1,
            maxValue: bookCharCount || 1,
            resolver
          }
        }
      ]);
    });

    skipKeyDownListener$.next(false);

    if (typeof target !== 'number') {
      restartTrackerAfterCharacterChangeOrTime(1);
      return;
    }

    restartTrackerAfterCharacterChangeOrTime(1000);

    bookmarkManager.scrollToBookmark(
      {
        dataId: dataId,
        exploredCharCount: target,
        lastBookmarkModified: new Date().getTime(),
        progress: 0
      },
      customReadingPointScrollOffset
    );
  }

  async function completeBook() {
    if (!$rawBookData$) {
      return;
    }

    const wasAutoscrollerEnabled = autoScroller?.wasAutoScrollerEnabled$.getValue();
    const wasTrackerPausedBefore = $statisticsEnabled$ ? $isTrackerPaused$ : true;

    showHeader = false;
    autoScroller?.off();

    if ($statisticsEnabled$) {
      wasTrackerPaused = true;
      isTrackerPaused$.next(true);
    }

    const diffToComplete =
      $statisticsEnabled$ && $addCharactersOnCompletion$
        ? Math.max(0, bookCharCount - exploredCharCount)
        : 0;
    const wasCanceled = await new Promise((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: ConfirmDialog,
          props: {
            dialogHeader: 'Complete Book',
            dialogMessage: `Would you like to complete this Book${
              diffToComplete ? ` and capture ${diffToComplete} characters read` : ''
            }?`,
            resolver
          }
        }
      ]);
    });

    if (wasCanceled) {
      if ($statisticsEnabled$ && !wasTrackerPausedBefore) {
        wasTrackerPaused = false;
        $isTrackerPaused$ = false;
      }

      if (wasAutoscrollerEnabled) {
        autoScroller?.toggle();
      }

      return;
    }

    dialogManager.dialogs$.next([
      {
        component: '<div/>',
        disableCloseOnClick: true
      }
    ]);

    try {
      if (diffToComplete) {
        const [hadError] = await trackerElm.processStatistics(diffToComplete);

        if (hadError) {
          throw new Error('Character Update failed');
        }
      }

      const finishedStatistic = await database.getStatisticForCompletedBook(
        $rawBookData$.title,
        $rawBookData$.id
      );
      const todayKey = getDateKey($startDayHoursForTracker$);
      const statisticsUntilToday = await database.getStatisticsUntilDate(
        $rawBookData$.title,
        todayKey,
        $rawBookData$.id
      );
      const todayStatistic =
        statisticsUntilToday.find((statistic) => statistic.dateKey === todayKey) ||
        getDefaultStatistic($rawBookData$.title, todayKey);
      const statisticsToStore: BooksDbStatistic[] = [];
      const lastStatisticModified = Date.now();

      todayStatistic.lastStatisticModified = lastStatisticModified;
      todayStatistic.completedBook = 1;
      todayStatistic.completedData = {
        ...{ dateKey: todayKey },
        ...BaseStorageHandler.getStatisticsMetadata(
          BaseStorageHandler.getStatisticsFileName(
            statisticsUntilToday,
            todayStatistic.lastStatisticModified
          )
        )
      };

      let updateFinishedStatistic = false;

      if (!finishedStatistic) {
        statisticsToStore.push(todayStatistic);
      } else if (
        $overwriteBookCompletion$ &&
        finishedStatistic.dateKey !== todayStatistic.dateKey
      ) {
        delete finishedStatistic.completedBook;
        delete finishedStatistic.completedData;
        finishedStatistic.lastStatisticModified = lastStatisticModified;
        statisticsToStore.push(todayStatistic, finishedStatistic);
        updateFinishedStatistic = true;
      } else if ($overwriteBookCompletion$) {
        statisticsToStore.push(todayStatistic);
      }

      if (statisticsToStore.length) {
        await database.storeStatistics(
          $rawBookData$.title,
          statisticsToStore,
          ReplicationSaveBehavior.Overwrite,
          MergeMode.LOCAL,
          lastStatisticModified,
          $rawBookData$.id
        );

        trackerElm?.updateCompletedBook(
          todayStatistic,
          updateFinishedStatistic ? finishedStatistic : undefined
        );

        scheduleReplication(StorageDataType.STATISTICS);
      }

      if (bookmarkManager) {
        const data = {
          ...bookmarkManager.formatBookmarkData($rawBookData$.id, customReadingPointScrollOffset),
          dataId: $rawBookData$.id,
          lastBookmarkModified: Date.now(),
          exploredCharCount: Math.max(0, bookCharCount - 1),
          progress: 1
        };

        // Persist the final reading position and explicit finish atomically. This
        // supersedes Still Reading without exposing a half-written state to an
        // overlapping autosave.
        await setCompletion(data.dataId, 'finished', undefined, data);

        bookmarkData = database.getBookmark(data.dataId);

        scheduleReplication(StorageDataType.PROGRESS);
      }

      if ($statisticsEnabled$ && $openTrackerOnCompletion$) {
        confettiWidthModifier = 36;
        confettiMaxRuns = 0;
        bookCompleted = window.matchMedia('(min-width: 900px)').matches;
        isTrackerMenuOpen$.next(true);
      } else {
        dialogManager.dialogs$.next([]);
        confettiWidthModifier = 0;
        confettiMaxRuns = 3;
        bookCompleted = true;

        merge(fromEvent(document, 'pointerup'), timer(10000))
          .pipe(take(1))
          .subscribe(() => {
            bookCompleted = false;
          });
      }
    } catch ({ message }: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Error',
            message: `Error completing Book: ${message}`
          }
        }
      ]);
    }
  }

  function getCurrentChapterProgress(sectionData: SectionWithProgress[]) {
    if (
      (!$showFooterChapterCharacterCounter$ && !$showFooterChapterPercentage$) ||
      !sectionData?.length
    ) {
      return '';
    }

    let chapterProgress = '';
    let chapterCharacters = '';

    const [mainChapters, chapterIndex, referenceId] = getChapterData($sectionData$);

    if ($showFooterChapterPercentage$) {
      const relevantSections = sectionData.filter(
        (section) => section.reference === referenceId || section.parentChapter === referenceId
      );

      chapterProgress = `${getWeightedAverage(
        relevantSections.map((section) => section.progress),
        relevantSections.map((section) => section.charactersWeight)
      ).toFixed(2)}%`;
    }

    if ($showFooterChapterCharacterCounter$) {
      const currentChapter = mainChapters[chapterIndex];

      if (currentChapter) {
        const endCharacter = currentChapter.characters as number;

        chapterCharacters = `${Math.min(
          Math.max(exploredCharCount - (currentChapter.startCharacter as number), 0),
          endCharacter
        )} / ${endCharacter}`;
      }
    }

    return [chapterCharacters, chapterProgress, 'C'].filter(Boolean).join(' ');
  }

  async function copyCurrentProgress(currentProgress: string) {
    try {
      await navigator.clipboard.writeText(currentProgress);
    } catch (error: any) {
      logger.error(`Error writing Progress to Clipboard: ${error.message}`);
    }
  }

  function freezeTrackerPosition() {
    if (!$statisticsEnabled$) {
      return;
    }

    if (frozenPosition > -1) {
      frozenPosition = -1;
    } else {
      skipFirstFreezeChange = true;
      frozenPosition = exploredCharCount;
    }
  }

  async function getStorageHandlerByName(storageSourceName: string, throwIfNotFound = false) {
    if (!storageSourceName) {
      if (throwIfNotFound) {
        throw new Error(`No storage source found`);
      }

      return undefined;
    }

    if (storageSourceName === StorageSourceDefault.GDRIVE_DEFAULT) {
      if (!$isOnline$) {
        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: {
              title: 'Load Error',
              message:
                'Sync disabled due to missing Online Connection - refresh Page after going Online to try again'
            }
          }
        ]);

        return undefined;
      }

      return getStorageHandler(
        window,
        StorageKey.GDRIVE,
        storageSourceName,
        true,
        $cacheStorageData$,
        $replicationSaveBehavior$,
        $statisticsMergeMode$,
        $readingGoalsMergeMode$
      );
    }
    if (storageSourceName === StorageSourceDefault.ONEDRIVE_DEFAULT) {
      if (!$isOnline$) {
        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: {
              title: 'Load Error',
              message:
                'Sync disabled due to missing Online Connection - refresh Page after going Online to try again'
            }
          }
        ]);

        return undefined;
      }

      return getStorageHandler(
        window,
        StorageKey.ONEDRIVE,
        storageSourceName,
        true,
        $cacheStorageData$,
        $replicationSaveBehavior$,
        $statisticsMergeMode$,
        $readingGoalsMergeMode$
      );
    }
    if (storageSourceName) {
      const db = await database.db;
      const storageSource = await db.get('storageSource', storageSourceName);

      if (storageSource) {
        if (storageSource.type !== StorageKey.FS && !$isOnline$) {
          dialogManager.dialogs$.next([
            {
              component: MessageDialog,
              props: {
                title: 'Load Error',
                message:
                  'Sync disabled due to missing Online Connection - refresh Page after going Online to try again'
              }
            }
          ]);

          return undefined;
        }

        return getStorageHandler(
          window,
          storageSource.type,
          storageSourceName,
          true,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        );
      }
      if (throwIfNotFound) {
        throw new Error(`No storage source with name ${storageSourceName} found`);
      }
    }

    const message = `No storage source with name ${storageSourceName} found - skipping auto import/export`;

    logger.warn(message);

    dialogManager.dialogs$.next([
      {
        component: MessageDialog,
        props: {
          title: 'Configuration Error',
          message
        }
      }
    ]);

    return undefined;
  }

  async function saveExternalLastRead(
    storageHandler: BaseStorageHandler | undefined,
    localBookData: BooksDbBookData
  ) {
    if (!storageHandler) {
      return localBookData;
    }

    // eslint-disable-next-line prefer-const
    let { id, ...bookData } = localBookData;

    if (localBookData.storageSource) {
      const externalBookData = await storageHandler.getBook();

      if (externalBookData && !(externalBookData instanceof File)) {
        bookData = {
          ...externalBookData,
          ...{
            id: localBookData.id,
            lastBookOpen: localBookData.lastBookOpen,
            storageSource: localBookData.storageSource
          }
        };
      }
    } else if (!localBookData.elementHtml) {
      throw new Error('Book has no data stored');
    }

    const dataToReturn = { id, ...bookData };

    await storageHandler.updateLastRead(dataToReturn).catch((error: any) => {
      const message = `Failed to update last read on external storage: ${error.message}`;

      logger.warn(message);

      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Update Error',
            message
          }
        }
      ]);
    });

    return dataToReturn;
  }

  async function hasPersonalReadingAuthority(book: BooksDbBookData): Promise<boolean> {
    if (currentUser() && book.contentHash && /^[a-f0-9]{64}$/i.test(book.contentHash)) return true;
    try {
      const db = await database.db;
      return !!(await db.get('readerBookScope', book.id));
    } catch {
      // If ownership cannot be checked, do not let legacy replication become a
      // second writer for personal reading data.
      return true;
    }
  }

  async function syncDownData(
    storageHandler: BaseStorageHandler | undefined,
    context: ReplicationContext,
    book: BooksDbBookData
  ) {
    if (localStorageHandler && storageHandler) {
      storageHandler.startContext(context);
    }

    if (
      localStorageHandler &&
      storageHandler &&
      ($autoReplication$ === AutoReplicationType.Down ||
        $autoReplication$ === AutoReplicationType.All)
    ) {
      const error = await replicateData(
        storageHandler,
        localStorageHandler,
        false,
        [context],
        legacyReplicationTypes(
          [
            StorageDataType.PROGRESS,
            StorageDataType.STATISTICS,
            StorageDataType.READING_GOALS,
            StorageDataType.AUDIOBOOK,
            StorageDataType.SUBTITLE
          ],
          await hasPersonalReadingAuthority(book),
          personalReplicationTypes
        )
      );

      if (error) {
        throw new Error(error);
      }
    }
  }

  function onKeydown(ev: KeyboardEvent) {
    if (readerUIOwnsEvent(ev)) return;
    if (
      $skipKeyDownListener$ ||
      ev.altKey ||
      ev.ctrlKey ||
      ev.shiftKey ||
      ev.metaKey ||
      ev.repeat
    ) {
      return;
    }

    const result = onKeydownReader(
      ev,
      bookReaderKeybindMap$.getValue(),
      bookmarkPage,
      scrollToBookmark,
      (x) => multiplier$.next(multiplier$.getValue() + x),
      autoScroller,
      pageManager,
      $verticalMode$,
      changeChapter,
      handleSetCustomReadingPoint,
      trackerDblClickHandler,
      freezeTrackerPosition
    );

    if (!result) return;

    // Keep the active book frame focused so subsequent configured shortcuts
    // continue to reach the same reader. Do not blur its browsing context.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.localName !== 'iframe') active.blur();
    ev.preventDefault();
  }

  function getBookIdSync() {
    let bookId: number | undefined;
    bookId$.subscribe((x) => (bookId = x)).unsubscribe();
    return bookId;
  }

  function bookmarkPage() {
    showHeader = false;
    return saveBookmark();
  }

  // Autosave is persistence, not a toolbar action. It must not unmount the
  // trigger of an open menu or steal keyboard focus while somebody uses it.
  async function saveBookmark() {
    if (readerNavigation.previewing || suppressResumeSave) return;
    const bookId = getBookIdSync();
    if (!bookId || !bookmarkManager) return;

    let data: BooksDbBookmarkData | undefined;

    if (isPaginated) {
      const userSelectedRange = $selectionToBookmarkEnabled$
        ? getRangeForUserSelection(window, lastSelectedRange)
        : undefined;
      const bookmarkRange = userSelectedRange || customReadingPointRange;

      pulseElement(bookmarkRange?.endContainer?.parentElement, 'add', 0.5, 500);

      data = bookmarkManager.formatBookmarkDataByRange(bookId, bookmarkRange);

      // A resume save must not dismiss a selection that the reader is using
      // for a dictionary lookup or a new highlight.
    } else {
      data = bookmarkManager.formatBookmarkData(bookId, customReadingPointScrollOffset);
    }

    // A font/layout pass has not produced a trustworthy reading position yet.
    // Keep the last good bookmark rather than saving a sentinel or zero progress.
    if (!data) return;

    await database.putBookmark(data);

    bookmarkData = Promise.resolve(data);

    scheduleReplication(StorageDataType.PROGRESS);
  }

  async function scrollToBookmark() {
    const data = await bookmarkData;
    if (!data || !bookmarkManager) return;

    if (data.exploredCharCount !== exploredCharCount) {
      pauseTracker(true);
    }

    bookmarkManager.scrollToBookmark(data, customReadingPointScrollOffset);
  }

  async function previewLocator(
    locator: ReaderLocator,
    source: 'search' | 'scrubber' | 'annotations' = 'search'
  ) {
    if (!bookReaderComponent || !readerBookKey) return;
    // Capturing the origin can await layout. Fence resume autosaves before that
    // first await, so a page-change fired while a sheet closes cannot replace it.
    suppressResumeSave = true;
    // Modal sheets can lock or shift the reader scrollport. Keep the source
    // point captured before opening the sheet instead of sampling covered text.
    const sheetOrigin =
      source === 'search' ? searchOrigin : source === 'scrubber' ? scrubberPoint : annotationPoint;
    const origin =
      readerNavigation.returnPoint ??
      sheetOrigin ??
      (await bookReaderComponent.captureReaderPoint(
        readerBookKey,
        $rawBookData$?.publicationManifest
      ));
    if (!origin) {
      suppressResumeSave = false;
      return;
    }
    const wasPaused = $isTrackerPaused$;
    if (!readerNavigation.previewing) previewTrackerWasPaused = wasPaused;
    pauseTracker();
    showBookSearch = false;
    showScrubber = false;
    showAnnotations = false;
    const reopen = () => {
      if (source === 'search') showBookSearch = true;
      else if (source === 'scrubber') showScrubber = true;
      else showAnnotations = true;
    };
    let revealed = false;
    revealingReaderLocator = true;
    try {
      await tick();
      revealed = await bookReaderComponent.revealReaderLocator(locator, readerBookKey);
    } catch (error) {
      logger.error(
        `Could not open reader location: ${error instanceof Error ? error.message : String(error)}`
      );
      suppressResumeSave = false;
      revealingReaderLocator = false;
      reopen();
      if (!wasPaused) isTrackerPaused$.next(false);
      return;
    }
    if (!revealed) {
      suppressResumeSave = false;
      revealingReaderLocator = false;
      reopen();
      if (!wasPaused) isTrackerPaused$.next(false);
      return;
    }
    readerNavigation.preview(origin, locator);
    activeSearchLocator = source === 'search' ? locator : undefined;
    navigationPreviewing = true;
    suppressResumeSave = false;
    revealingReaderLocator = false;
  }

  async function openLibraryTarget() {
    const target = libraryTarget;
    if (!target || libraryNavigationTask) return;
    libraryTarget = undefined;
    libraryNavigationTask = true;
    const epoch = ++libraryNavigationEpoch;
    const id = $rawBookData$?.id;
    const owner = currentUser()?.id ?? null;
    const current = () =>
      epoch === libraryNavigationEpoch &&
      id === $rawBookData$?.id &&
      owner === (currentUser()?.id ?? null);
    try {
      const deadline = Date.now() + 10000;
      await bookmarkData;
      while (current() && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 32));
        if (
          bookReaderComponent &&
          readerBookKey === target.bookKey &&
          guideContentEl?.isConnected &&
          !guideContentEl.closest('[aria-busy="true"]') &&
          bookmarkManager?.formatBookmarkData(id!, customReadingPointScrollOffset)
        ) {
          // Let the initial resume/reflow callbacks finish before capturing Return.
          await tick();
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
          if (!current()) return;
          await previewLocator(target, 'search');
          if (!readerNavigation.previewing)
            throw new Error('The saved passage no longer resolves in this book.');
          return;
        }
      }
      if (current())
        throw new Error('The reader could not open this passage. Search the book to try again.');
    } catch (error) {
      if (current())
        librarySearchMessage =
          error instanceof Error ? error.message : 'Could not open the passage.';
    } finally {
      if (current()) {
        libraryNavigationTask = false;
        suppressResumeSave = false;
      }
    }
  }

  async function openBookSearch() {
    if (!bookReaderComponent || !readerBookKey) return;
    searchOrigin =
      readerNavigation.returnPoint ??
      (await bookReaderComponent.captureReaderPoint(
        readerBookKey,
        $rawBookData$?.publicationManifest
      ));
    showHeader = false;
    showBookSearch = true;
  }

  async function openScrubber() {
    if (!bookReaderComponent || !readerBookKey) return;
    scrubberPoint = await bookReaderComponent.captureReaderPoint(
      readerBookKey,
      $rawBookData$?.publicationManifest
    );
    showHeader = false;
    showScrubber = true;
  }

  async function openAnnotations() {
    if (!bookReaderComponent || !readerBookKey) return;
    annotationError = '';
    annotationStatus = '';
    const manifest = $rawBookData$?.publicationManifest;
    try {
      // Capture before focus moves into the sheet; the DOM selection is ephemeral.
      annotationSelection = await bookReaderComponent.captureReaderSelection(
        readerBookKey,
        manifest,
        lastSelectedRange
      );
      annotationPoint = await bookReaderComponent.captureReaderPoint(readerBookKey, manifest);
      annotations = await listReaderAnnotations(readerBookKey);
      annotationImportConflicts = await listAnnotationImportConflicts(readerBookKey);
      showHeader = false;
      showAnnotations = true;
    } catch (error) {
      annotationError = error instanceof Error ? error.message : String(error);
      showAnnotations = true;
    }
  }

  async function addAnnotation(kind: ReaderAnnotation['kind'], body?: string) {
    if (annotationBusy || !readerBookKey) return;
    const targets =
      kind === 'bookmark' ? (annotationPoint ? [annotationPoint] : []) : annotationSelection;
    if (!targets.length) {
      annotationError =
        kind === 'bookmark'
          ? 'The current reading position is not ready yet.'
          : 'Select a passage in this book first.';
      return;
    }
    annotationBusy = true;
    annotationError = '';
    try {
      await saveReaderAnnotation(
        { bookKey: readerBookKey, kind, targets, body },
        currentUser()?.id
      );
      annotations = await listReaderAnnotations(readerBookKey);
      if (kind === 'note') annotationSavedVersion += 1;
    } catch (error) {
      annotationError = error instanceof Error ? error.message : String(error);
    } finally {
      annotationBusy = false;
    }
  }

  async function removeAnnotation(id: string) {
    if (annotationBusy) return;
    annotationBusy = true;
    annotationError = '';
    try {
      await removeReaderAnnotation(id, currentUser()?.id);
      annotations = await listReaderAnnotations(readerBookKey);
    } catch (error) {
      annotationError = error instanceof Error ? error.message : String(error);
    } finally {
      annotationBusy = false;
    }
  }

  async function exportAnnotations() {
    if (annotationBusy) return;
    annotationBusy = true;
    annotationError = '';
    annotationStatus = '';
    try {
      const json = await exportReaderAnnotations();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'manabi-reader-annotations.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      annotationStatus = 'Notes archive downloaded.';
    } catch (error) {
      annotationError = error instanceof Error ? error.message : String(error);
    } finally {
      annotationBusy = false;
    }
  }

  async function importAnnotations(file: File) {
    if (annotationBusy) return;
    annotationBusy = true;
    annotationError = '';
    annotationStatus = '';
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('The annotation archive is too large.');
      const result = await importReaderAnnotations(await file.text(), currentUser()?.id);
      annotations = await listReaderAnnotations(readerBookKey);
      annotationImportConflicts = await listAnnotationImportConflicts(readerBookKey);
      annotationStatus = `${result.imported} imported, ${result.alreadyPresent} already present, ${result.conflicts} kept for conflict review. Archives may include notes for books not currently connected.`;
    } catch (error) {
      annotationError = error instanceof Error ? error.message : String(error);
    } finally {
      annotationBusy = false;
    }
  }

  async function resolveImportConflict(id: string, choice: 'keep-local' | 'restore-archive') {
    if (annotationBusy) return;
    annotationBusy = true;
    annotationError = '';
    try {
      await resolveAnnotationImportConflict(id, choice, currentUser()?.id);
      annotations = await listReaderAnnotations(readerBookKey);
      annotationImportConflicts = await listAnnotationImportConflicts(readerBookKey);
      annotationStatus =
        choice === 'restore-archive' ? 'Archived passage restored.' : 'Current copy kept.';
    } catch (error) {
      annotationError = error instanceof Error ? error.message : String(error);
    } finally {
      annotationBusy = false;
    }
  }

  async function returnToReadingPoint() {
    const origin = readerNavigation.returnPoint;
    if (!origin || !bookReaderComponent || !readerBookKey) return;
    revealingReaderLocator = true;
    try {
      if (!(await bookReaderComponent.revealReaderLocator(origin, readerBookKey))) return;
      readerNavigation.returnToOrigin();
      pendingPreviewAdoption = false;
      activeSearchLocator = undefined;
      navigationPreviewing = false;
      isTrackerPaused$.next(previewTrackerWasPaused);
    } finally {
      revealingReaderLocator = false;
    }
  }

  async function continueAtPreview() {
    if (!readerNavigation.previewing) return;
    readerNavigation.continueHere();
    pendingPreviewAdoption = false;
    activeSearchLocator = undefined;
    navigationPreviewing = false;
    await saveBookmark();
    isTrackerPaused$.next(previewTrackerWasPaused);
  }

  async function restorePreviewAfterReflow(epoch: number) {
    const target = readerNavigation.visiblePoint;
    if (revealingReaderLocator || !target || !bookReaderComponent || !readerBookKey) return;
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (
      epoch !== readerContentEpoch ||
      revealingReaderLocator ||
      !readerNavigation.previewing ||
      target !== readerNavigation.visiblePoint
    )
      return;
    await bookReaderComponent.revealReaderLocator(target, readerBookKey);
  }

  function onFullscreenClick() {
    showHeader = false;

    if (!fullscreenManager.fullscreenElement) {
      fullscreenManager.requestFullscreen(document.documentElement);
      return;
    }
    fullscreenManager.exitFullscreen();
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

  function changeChapter(offset: number) {
    if (!$sectionData$?.length) {
      return;
    }

    const [mainChapters, currentChapterIndex] = getChapterData($sectionData$);

    if (
      (!currentChapterIndex && offset === -1) ||
      (offset === 1 && currentChapterIndex === mainChapters.length - 1)
    ) {
      return;
    }

    const nextChapter = mainChapters[currentChapterIndex + offset];

    if (!nextChapter) {
      return;
    }

    if (nextChapter.startCharacter !== exploredCharCount) {
      pauseTracker(true);
    }

    nextChapter$.next(nextChapter.reference);
  }

  async function executeReplication(isSilent = true) {
    if (isReplicating || !dataToReplicate.length || !$rawBookData$ || !externalStorageHandler) {
      return;
    }

    const bookForReplication = $rawBookData$;
    const handlerForReplication = externalStorageHandler;
    isReplicating = true;
    const personalReadingAuthority = await hasPersonalReadingAuthority(bookForReplication);
    if (
      $rawBookData$?.id !== bookForReplication.id ||
      externalStorageHandler !== handlerForReplication
    ) {
      dataToReplicate = [];
      dataToReplicateQueue = [];
      isReplicating = false;
      return;
    }
    dataToReplicate = legacyReplicationTypes(
      dataToReplicate,
      personalReadingAuthority,
      personalReplicationTypes
    );
    dataToReplicateQueue = legacyReplicationTypes(
      dataToReplicateQueue,
      personalReadingAuthority,
      personalReplicationTypes
    );
    if (!dataToReplicate.length) {
      dataToReplicate = dataToReplicateQueue;
      dataToReplicateQueue = [];
      isReplicating = false;
      if (dataToReplicate.length) executeReplicate$.next();
      return;
    }

    if (!isSilent) {
      skipKeyDownListener$.next(true);
      logger.clearHistory();
      openActionBackdrop();
    }

    const currentHandlerStorageSource = $rawBookData$.storageSource || $syncTarget$;

    externalStorageHandler.updateSettings(
      window,
      false,
      $replicationSaveBehavior$,
      $statisticsMergeMode$,
      $readingGoalsMergeMode$,
      $cacheStorageData$,
      !isSilent,
      currentHandlerStorageSource
    );

    const error = await replicateData(
      localStorageHandler,
      externalStorageHandler,
      !isSilent && $storageSource$ === externalStorageHandler.storageType,
      [
        {
          id: $rawBookData$.id,
          title: $rawBookData$.title,
          imagePath: $rawBookData$.coverImage
        }
      ],
      dataToReplicate
    ).catch((err: any) => err.message);

    externalStorageHandler.updateSettings(
      window,
      true,
      $replicationSaveBehavior$,
      $statisticsMergeMode$,
      $readingGoalsMergeMode$,
      $cacheStorageData$,
      false,
      currentHandlerStorageSource
    );

    isReplicating = false;

    if (error) {
      if (!isSilent) {
        const showReport = logger.errorCount > 1;

        logger.warn(error);

        dialogManager.dialogs$.next([
          {
            component: showReport ? LogReportDialog : MessageDialog,
            props: {
              title: 'Error Processing Data',
              message: showReport
                ? `Some or all data could not be stored on an external storage`
                : error
            }
          }
        ]);
      }

      externalStorageErrors += 1;
    } else {
      externalStorageErrors = 0;

      if (!isSilent) {
        dialogManager.dialogs$.next([]);
      }

      if (dataToReplicateQueue.length) {
        const isAudioBookOnly =
          dataToReplicate.length === 1 && dataToReplicate[0] === StorageDataType.AUDIOBOOK;
        dataToReplicate = JSON.parse(JSON.stringify(dataToReplicateQueue));
        dataToReplicateQueue = [];

        if (isSilent || isAudioBookOnly) {
          executeReplicate$.next();
        } else if (!isAudioBookOnly) {
          await executeReplication(false);
        } else {
          dataToReplicate = [];
        }
      } else {
        dataToReplicate = [];
      }
    }

    if (!isSilent) {
      skipKeyDownListener$.next(false);
    }
  }

  function openActionBackdrop() {
    dialogManager.dialogs$.next([
      {
        component: '<div/>',
        disableCloseOnClick: true
      }
    ]);
  }

  async function leaveReader(routeId: string, deleteLastItem = true) {
    let message;

    try {
      blockDataUpdates = true;

      await tick();

      autoScroller?.off();
      wasTrackerPaused = true;
      isTrackerPaused$.next(true);

      if ($confirmClose$ && storedExploredCharacter !== exploredCharCount) {
        const wasCanceled = await new Promise((resolver) => {
          dialogManager.dialogs$.next([
            {
              component: ConfirmDialog,
              props: {
                dialogHeader: 'Confirm Exit',
                dialogMessage: 'Your current location was not bookmarked. Continue leaving?',
                resolver
              },

              disableCloseOnClick: true
            }
          ]);
        });

        if (wasCanceled) {
          blockDataUpdates = false;
          return;
        }

        await tick();
      }

      openActionBackdrop();

      if (deleteLastItem) {
        await database.deleteLastItem();
      }

      if (!$manualBookmark$) {
        await bookmarkPage();
      }

      if ($statisticsEnabled$ && trackerElm) {
        const [hadError, updated] = await trackerElm.flushUpdates(true);

        if (hadError) {
          throw new Error('Error updating Statistics');
        }

        if (updated) {
          scheduleReplication(StorageDataType.STATISTICS);
        }
      }

      dialogManager.dialogs$.next([]);

      if (upSyncEnabled) {
        await executeReplication(false);
      }
    } catch (error: any) {
      message = error.message;
    }

    if (message) {
      logger.error(message);

      dismissDialogs = false;
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Error',
            message
          },
          disableCloseOnClick: true
        }
      ]);
    }

    goto(`${pagePath}${routeId}`);
  }

  function handleSetCustomReadingPoint() {
    if (!$customReadingPointEnabled$ && !isPaginated) {
      return;
    }

    const contentEl = document.querySelector('.book-content');

    if (!contentEl) {
      return;
    }

    autoScroller?.off();

    if ($pauseTrackerOnCustomPointChange$) {
      pauseTracker();
    }

    if (isPaginated) {
      customReadingPointTop = window.innerHeight / 2 - 2;
      customReadingPointLeft = window.innerWidth / 2 - 2;
    }

    showHeader = false;
    isSelectingCustomReadingPoint = true;
    document.body.classList.add('cursor-crosshair');

    const {
      elLeftReferencePoint,
      elTopReferencePoint,
      elRightReferencePoint,
      elBottomReferencePoint,
      pointGap
    } = getReferencePoints(window, contentEl, $verticalMode$, firstDimensionMargin);

    merge(fromEvent(document, 'pointerup'), fromEvent(document, 'pointermove'))
      // eslint-disable-next-line rxjs/no-ignored-takewhile-value
      .pipe(takeWhile(() => isSelectingCustomReadingPoint))
      .subscribe((event: Event) => {
        if (!(event instanceof PointerEvent)) {
          return;
        }

        if (event.type === 'pointerup') {
          document.body.classList.remove('cursor-crosshair');
          isSelectingCustomReadingPoint = false;

          tick().then(() => {
            customReadingPointLeft = $verticalMode$ ? event.x : customReadingPointLeft;
            customReadingPointTop = $verticalMode$ ? customReadingPointTop : event.y;

            const result = getParagraphToPoint(customReadingPointLeft, customReadingPointTop);

            if (result) {
              pulseElement(result.parent, 'add', 0.5, 500);
            }

            if (isPaginated) {
              customReadingPointRange = result?.range;
            } else {
              let newPercentage = 0;

              if ($verticalMode$) {
                newPercentage = Math.ceil(
                  (Math.max(0, customReadingPointLeft - elLeftReferencePoint) /
                    (elRightReferencePoint - elLeftReferencePoint)) *
                    100
                );

                verticalCustomReadingPosition$.next(newPercentage);
              } else {
                newPercentage = Math.ceil(
                  (Math.max(0, customReadingPointTop - elTopReferencePoint) /
                    (elBottomReferencePoint - elTopReferencePoint)) *
                    100
                );

                horizontalCustomReadingPosition$.next(newPercentage);
              }

              customReadingPoint = newPercentage;
            }

            if ($pauseTrackerOnCustomPointChange$) {
              restartTrackerAfterCharacterChangeOrTime(1000);
            }
          });
        } else {
          const insideXBound =
            event.x >= elLeftReferencePoint + pointGap && event.x <= elRightReferencePoint;
          const insideYBound =
            event.y >= elTopReferencePoint && event.y <= elBottomReferencePoint - pointGap;

          if (isPaginated) {
            customReadingPointTop = insideYBound ? event.y : customReadingPointTop;
            customReadingPointLeft = insideXBound ? event.x : customReadingPointLeft;
          } else if ($verticalMode$ && insideXBound) {
            customReadingPointLeft = event.x;
          } else if (!$verticalMode$ && insideYBound) {
            customReadingPointTop = event.y;
          }
        }
      });
  }

  function pauseTracker(restartAfterCharacterChange = false) {
    if ($statisticsEnabled$ && !$isTrackerPaused$) {
      wasTrackerPaused = false;
      $isTrackerPaused$ = true;

      if (restartAfterCharacterChange) {
        restartTrackerAfterCharacterChangeOrTime();
      }
    }
  }

  function restartTrackerAfterCharacterChangeOrTime(timerAmount = 0) {
    if (!$statisticsEnabled$ || wasTrackerPaused) {
      return;
    }

    merge(fromEvent(document, PAGE_CHANGE), timerAmount ? timer(timerAmount) : NEVER)
      .pipe(debounceTime(200), take(1))
      .subscribe(() => {
        if (readerNavigation.previewing || suppressResumeSave) return;
        wasTrackerPaused = false;
        $isTrackerPaused$ = false;
      });
  }

  function scheduleReplication(dataType: StorageDataType) {
    if (
      personalReplicationTypes.includes(dataType) &&
      ((personalManagedBookId !== undefined && personalManagedBookId === getBookIdSync()) ||
        (!!currentUser() &&
          !!$rawBookData$?.contentHash &&
          /^[a-f0-9]{64}$/i.test($rawBookData$.contentHash)))
    )
      return;
    if (upSyncEnabled) {
      const toReplicate = isReplicating ? dataToReplicateQueue : dataToReplicate;

      if (!toReplicate.includes(dataType)) {
        toReplicate.push(dataType);
      }

      if (!isReplicating) {
        dataToReplicate = [...dataToReplicate];
      }

      if (!blockDataUpdates) {
        executeReplicate$.next();
      }
    }
  }
</script>

<svelte:head>
  <title>{formatPageTitle($rawBookData$?.title ?? '')}</title>
</svelte:head>

{$collectReaderImageGallerySpoilerToggles$ ?? ''}
{$handleUpdateImageGalleryPictureSpoilers$ ?? ''}
<div
  class="reader-context writing-horizontal-tb"
  aria-hidden="true"
  style:color={$themeOption$?.tooltipTextFontColor}
>
  {$rawBookData$?.title ?? ''}
</div>
{#if !foliatePagination || showHeader}
  <button
    type="button"
    aria-label={showHeader ? 'Hide reading controls' : 'Show reading controls'}
    aria-expanded={showHeader}
    data-reader-controls
    class="reader-controls writing-horizontal-tb fixed z-20 flex size-11 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm"
    on:click={() => (showHeader = !showHeader)}
    >{#if showHeader}<X class="size-5" aria-hidden="true" />{:else}<TextAlignLeft
        class="size-5"
        aria-hidden="true"
      />{/if}</button
  >
{/if}
{#if showHeader}
  <div
    class="writing-horizontal-tb fixed inset-x-0 top-0 z-20 w-full"
    transition:fly|local={{ y: -80, duration: foliatePagination ? 0 : 160, easing: quintInOut }}
    use:clickOutside={(event) => {
      const target = event.target;
      if (target instanceof Element) {
        if (target.closest('[data-reader-controls]')) return;
        if (
          target.matches('foliate-paginator') &&
          (target as Paginator).isPageNumberControlAt(event.clientX, event.clientY)
        )
          return;
      }
      showHeader = false;
    }}
  >
    <BookReaderHeader
      bookTitle={$rawBookData$?.title ?? ''}
      on:appearanceClick={() => (showAppearance = true)}
      hasChapterData={!!$sectionData$?.length}
      hasText={!!bookCharCount}
      hasCustomReadingPoint={!!(
        ($customReadingPointEnabled$ || isPaginated) &&
        ((isPaginated && customReadingPointRange) ||
          (!isPaginated && customReadingPointLeft > -1 && customReadingPointTop > -1))
      )}
      showFullscreenButton={fullscreenManager.fullscreenEnabled}
      autoScrollMultiplier={$multiplier$}
      {hasBookmarkData}
      on:tocClick={() => {
        pauseTracker();

        showHeader = false;
        tocIsOpen$.next(true);
      }}
      on:jumpClick={handleJump}
      on:searchBookClick={() => {
        void openBookSearch();
      }}
      on:scrubClick={openScrubber}
      on:lineGuideClick={() => {
        showHeader = false;
        lineGuideEnabled = !lineGuideEnabled;
      }}
      on:completeBook={completeBook}
      on:setCustomReadingPoint={handleSetCustomReadingPoint}
      on:showCustomReadingPoint={() => {
        showHeader = false;
        showCustomReadingPoint = true;
      }}
      on:resetCustomReadingPoint={() => {
        showHeader = false;

        if ($pauseTrackerOnCustomPointChange$) {
          pauseTracker();
        }

        if (isPaginated) {
          customReadingPointRange = undefined;
        } else if ($verticalMode$) {
          verticalCustomReadingPosition$.next(100);
          customReadingPoint = 100;
        } else {
          horizontalCustomReadingPosition$.next(0);
          customReadingPoint = 0;
        }

        if ($pauseTrackerOnCustomPointChange$) {
          restartTrackerAfterCharacterChangeOrTime(1000);
        }
      }}
      on:fullscreenClick={onFullscreenClick}
      on:bookmarkClick={bookmarkPage}
      on:annotationsClick={openAnnotations}
      on:scrollToBookmarkClick={() => {
        showHeader = false;
        scrollToBookmark();
      }}
      on:statisticsClick={() => {
        if ($rawBookData$) {
          $preFilteredTitlesForStatistics$ = new Set([$rawBookData$.title]);
        }

        leaveReader(mergeEntries.STATISTICS.routeId, false);
      }}
      on:readerImageGalleryClick={() => {
        showHeader = false;
        showReaderImageGallery = true;
      }}
      on:settingsClick={() => leaveReader(mergeEntries.SETTINGS.routeId, false)}
      on:dictionarySetupClick={() => dictionarySetup?.show()}
      on:domainHintClick={onDomainHintClick}
      on:bookManagerClick={() => leaveReader(mergeEntries.MANAGE.routeId)}
    />
  </div>
{/if}

{#if $bookData$ && $rawBookData$}
  <DictionarySetup bind:this={dictionarySetup} contentReady={!!guideContentEl} />
  {#if $statisticsEnabled$}
    <BookReadingTracker
      bookTitle={$rawBookData$.title}
      bookId={$rawBookData$.id}
      sectionData={$sectionData$}
      {frozenPosition}
      {exploredCharCount}
      {bookCharCount}
      {autoScroller}
      {blockDataUpdates}
      bind:wasTrackerPaused
      bind:this={trackerElm}
      on:freezeCurrentLocation={freezeTrackerPosition}
      on:statisticsSaved={() => {
        if (!blockDataUpdates) {
          scheduleReplication(StorageDataType.STATISTICS);
        }
      }}
      on:trackerAvailable={() => (showTrackerIcon = true)}
      on:trackerMenuClosed={() => {
        if (!wasTrackerPaused) {
          isTrackerPaused$.next(false);
        }

        isTrackerMenuOpen$.next(false);

        bookCompleted = false;
      }}
    />
  {/if}
  <StyleSheetRenderer styleSheet={$bookData$.styleSheet} />
  <BookReader
    bind:this={bookReaderComponent}
    on:readerKeydown={(event) => onKeydown(event.detail)}
    bind:sheetPagination={foliatePagination}
    controlsVisible={showHeader}
    on:pageTurnStart={() => (showHeader = false)}
    on:toggleControls={() => (showHeader = !showHeader)}
    previewNavigationActive={navigationPreviewing || suppressResumeSave}
    htmlContent={$bookData$.htmlContent}
    styleSheet={$bookData$.styleSheet}
    publicationManifest={$rawBookData$.publicationManifest}
    epubResources={$bookData$.epubResources}
    sourceFormat={readerSourceFormat($rawBookData$)}
    width={$containerViewportWidth$ ?? 0}
    height={$containerViewportHeight$ ?? 0}
    {fontFeatureSettings}
    {verticalTextOrientation}
    prioritizeReaderStyles={$prioritizeReaderStyles$}
    enableTextJustification={$enableTextJustification$}
    enableTextWrapPretty={$enableTextWrapPretty$}
    verticalMode={$verticalMode$}
    fontColor={$themeOption$?.fontColor}
    backgroundColor={$backgroundColor$}
    hintFuriganaFontColor={$themeOption$?.hintFuriganaFontColor}
    hintFuriganaShadowColor={$themeOption$?.hintFuriganaShadowColor}
    fontFamilyGroupOne={effectivePrimaryReaderFont($fontFamilyGroupOne$, $yuKyokashoAvailable$)}
    fontFamilyGroupTwo={$fontFamilyGroupTwo$}
    fontWeight={$fontWeight$}
    fontSize={$fontSize$}
    lineHeight={$lineHeight$}
    textIndentation={$textIndentation$}
    textMarginMode={$textMarginMode$}
    textMarginValue={$textMarginValue$}
    hideSpoilerImage={$hideSpoilerImage$}
    hideFurigana={$hideFurigana$}
    furiganaStyle={$furiganaStyle$}
    viewMode={$viewMode$}
    secondDimensionMaxValue={$secondDimensionMaxValue$}
    {firstDimensionMargin}
    autoPositionOnResize={$autoPositionOnResize$}
    avoidPageBreak={$avoidPageBreak$}
    pageColumns={$pageColumns$}
    autoBookmark={$autoBookmark$}
    autoBookmarkTime={$autoBookmarkTime$}
    multiplier={$multiplier$}
    bind:exploredCharCount
    bind:bookCharCount
    bind:isBookmarkScreen
    bind:bookmarkData
    bind:autoScroller
    bind:bookmarkManager
    bind:pageManager
    bind:customReadingPoint
    bind:customReadingPointTop
    bind:customReadingPointLeft
    bind:customReadingPointScrollOffset
    bind:customReadingPointRange
    bind:showCustomReadingPoint
    on:bookmark={saveBookmark}
    on:trackerPause={() => pauseTracker(true)}
    on:selectionChange={(ev) => noteReaderSelection(ev.detail)}
    on:userNavigation={() => {
      if (readerNavigation.previewing) pendingPreviewAdoption = true;
    }}
    on:contentChange={(event) => {
      guideContentEl = event.detail;
      readerContentEpoch += 1;
      if (readerNavigation.previewing && !revealingReaderLocator)
        void restorePreviewAfterReflow(readerContentEpoch);
    }}
  />
  {#if librarySearchMessage}<p
      role="alert"
      class="fixed inset-x-4 top-16 z-50 rounded-xl bg-card p-4 text-foreground"
    >
      {librarySearchMessage}
    </p>{/if}
  <ReaderHighlights
    contentEl={guideContentEl}
    {annotations}
    active={activeSearchLocator}
    bookKey={readerBookKey}
    epoch={readerContentEpoch}
  />
  <ReaderLineGuide
    bind:enabled={lineGuideEnabled}
    contentEl={guideContentEl}
    verticalMode={$verticalMode$}
    bind:visibleLines={lineGuideLines}
    bind:dimming={lineGuideDimming}
    epoch={readerContentEpoch}
  />
  {$setBackgroundColor$ ?? ''}
  {$setWritingMode$ ?? ''}
  {$textSelector$ ?? ''}
  {$previewAdoption$ ?? ''}
  {$replicator$ ?? ''}
  {$autoStartTracker$ ?? ''}
{:else}
  {$leaveIfBookMissing$ ?? ''}
{/if}

<ReaderAppearance
  bind:open={showAppearance}
  on:settingsClick={() => leaveReader(mergeEntries.SETTINGS.routeId, false)}
/>

<ReaderSearch
  bind:open={showBookSearch}
  rawHtml={$rawBookData$?.elementHtml ?? ''}
  manifest={$rawBookData$?.publicationManifest}
  bookKey={readerBookKey}
  bookTitle={$rawBookData$?.title ?? ''}
  on:select={(event) => previewLocator(event.detail, 'search')}
/>

<ReaderScrubber
  bind:open={showScrubber}
  rawHtml={$rawBookData$?.elementHtml ?? ''}
  manifest={$rawBookData$?.publicationManifest}
  bookKey={readerBookKey}
  current={scrubberPoint}
  on:select={(event) => previewLocator(event.detail, 'scrubber')}
/>

<ReaderAnnotations
  bookId={$rawBookData$?.id ?? 0}
  bookKey={readerBookKey}
  bind:open={showAnnotations}
  {annotations}
  importConflicts={annotationImportConflicts}
  hasSelection={annotationSelection.length > 0}
  error={annotationError}
  status={annotationStatus}
  busy={annotationBusy}
  savedVersion={annotationSavedVersion}
  on:bookmark={() => addAnnotation('bookmark')}
  on:highlight={() => addAnnotation('highlight')}
  on:note={(event) => addAnnotation('note', event.detail)}
  on:openAnnotation={(event) => {
    showAnnotations = false;
    void previewLocator(event.detail.targets[0], 'annotations');
  }}
  on:remove={(event) => removeAnnotation(event.detail)}
  on:export={exportAnnotations}
  on:import={(event) => importAnnotations(event.detail)}
  on:resolveImport={(event) => resolveImportConflict(event.detail.id, event.detail.choice)}
/>

{#if navigationPreviewing}
  <div
    class="writing-horizontal-tb fixed bottom-16 left-4 z-20 flex items-center gap-1 rounded-full border border-border bg-background p-1 shadow-sm"
  >
    <button
      type="button"
      class="min-h-11 rounded-full px-3 text-sm font-medium"
      on:click={returnToReadingPoint}>Return to where I was</button
    >
    <button
      type="button"
      class="min-h-11 rounded-full px-3 text-sm text-muted-foreground"
      on:click={continueAtPreview}>Continue Here</button
    >
  </div>
{/if}

<Sheet.Root
  open={$tocIsOpen$}
  onOpenChange={(open) => {
    if (!open) {
      if ($statisticsEnabled$ && !wasTrackerPaused) isTrackerPaused$.next(false);
      tocIsOpen$.next(false);
    }
  }}
>
  <Sheet.Content
    side="left"
    showCloseButton={false}
    class="writing-horizontal-tb data-[side=left]:w-full data-[side=left]:sm:max-w-md"
    onCloseAutoFocus={(event) => {
      event.preventDefault();
      document.querySelector<HTMLButtonElement>('[aria-label="Show reading controls"]')?.focus();
    }}
  >
    <Sheet.Title class="sr-only">Table of contents</Sheet.Title>
    <Sheet.Description class="sr-only">Chapter navigation and reading progress.</Sheet.Description>
    {#if $sectionData$}<BookToc
        bookTitle={$rawBookData$?.title ?? ''}
        sectionData={$sectionData$}
        verticalMode={$verticalMode$}
        {exploredCharCount}
        {wasTrackerPaused}
      />{/if}
  </Sheet.Content>
</Sheet.Root>

{#if showReaderImageGallery}
  <BookReaderImageGallery on:close={() => (showReaderImageGallery = false)} />
{/if}

{#if (isSelectingCustomReadingPoint && !$isMobile$) || (!isPaginated && showCustomReadingPoint)}
  <div
    class="fixed left-0 z-20 h-[1px] w-full border border-red-500"
    style:top={`${customReadingPointTop}px`}
  ></div>
  <div
    class="fixed top-0 z-20 h-full w-[1px] border border-red-500"
    style:left={`${customReadingPointLeft}px`}
  ></div>
{/if}

{#if $enableTapEdgeToFlip$ && isPaginated && !$skipKeyDownListener$}
  <button
    aria-label={$verticalMode$ ? 'Next page' : 'Previous page'}
    class="fixed left-0 z-10 w-5"
    on:click={$verticalMode$ ? () => pageManager?.nextPage() : () => pageManager?.prevPage()}
    style:height={tapButtonHeight}
    style:top={tapButtonTop}
  ></button>
  <button
    aria-label={$verticalMode$ ? 'Previous page' : 'Next page'}
    class="fixed right-0 z-10 w-5"
    on:click={$verticalMode$ ? () => pageManager?.prevPage() : () => pageManager?.nextPage()}
    style:height={tapButtonHeight}
    style:top={tapButtonTop}
  ></button>
{/if}

{#if showSpinner}
  <div class="fixed inset-0 flex h-full w-full items-center justify-center text-7xl">
    <AppIcon icon={faSpinner} spin />
  </div>
{/if}

<footer
  id="ttu-page-footer"
  class="reader-footer writing-horizontal-tb fixed bottom-0 left-0 z-10 flex w-full items-center justify-between text-xs leading-none"
  class:controls-expanded={showHeader}
  class:foliate-chrome-hidden={foliatePagination && !showHeader}
  class:many-controls={showTrackerIcon && !!dataToReplicate.length}
  data-reader-controls
  style:color={$themeOption$?.tooltipTextFontColor}
>
  <div class="flex h-full items-center">
    {#if !foliatePagination}<button
        class="progress-toggle h-11 px-2"
        aria-expanded={showFooter}
        on:click={() => (showFooter = !showFooter)}>Progress</button
      >{/if}
    {#if $bookData$ && $rawBookData$}
      {#key `${$rawBookData$.id}:${$rawBookData$.title}`}
        <AudiobookLauncher
          bookId={$rawBookData$.id}
          bookTitle={$rawBookData$.title}
          htmlContent={$bookData$.htmlContent}
          contentRoot={guideContentEl}
          layoutKey={$viewMode$}
          {bookmarkManager}
          onFollow={() => autoScroller?.off()}
        />
      {/key}
    {/if}
    {#if showTrackerIcon}
      <button
        type="button"
        aria-label="Open reading tracker"
        title="Open Tracker Menu; double-click to toggle tracking"
        class="flex size-11 items-center justify-center rounded-full text-base hover:bg-muted"
        class:text-red-500={$isTrackerPaused$}
        class:animate-pulse={frozenPosition > -1}
        use:multiClickHandler={[trackerSingleClickHandler, trackerDblClickHandler]}
      >
        <AppIcon icon={$isTrackerPaused$ ? faPlay : faPause} /><span class="sr-only">Tracker</span>
      </button>
    {/if}
    {#if dataToReplicate.length}
      <button
        type="button"
        aria-label="Sync reading data"
        class="flex size-11 items-center justify-center rounded-full text-base hover:bg-muted"
        class:text-red-500={externalStorageErrors > 1}
        class:animate-pulse={externalStorageErrors > 1 || isReplicating}
        on:click|stopPropagation={() => {
          if ($statisticsEnabled$) {
            wasTrackerPaused = $isTrackerPaused$;
            isTrackerPaused$.next(true);
          }

          executeReplication(false).finally(() => {
            if ($statisticsEnabled$ && !wasTrackerPaused) {
              isTrackerPaused$.next(false);
            }
          });
        }}
        on:keyup={dummyFn}
      >
        <AppIcon icon={faCloudBolt} /><span class="sr-only">Sync</span>
      </button>
    {/if}
  </div>
  {#if showFooter && bookCharCount && !foliatePagination}
    {@const currentProgress = [
      $showCharacterCounter$ ? `${exploredCharCount} / ${bookCharCount}` : '',
      $showPercentage$ ? `${((exploredCharCount / bookCharCount) * 100).toFixed(2)}%` : '',
      $showFooterChapterCharacterCounter$ || $showFooterChapterPercentage$ ? 'T' : ''
    ]
      .filter(Boolean)
      .join(' ')}
    <button
      type="button"
      title="Copy Progress"
      class="reader-progress writing-horizontal-tb absolute z-10 text-xs leading-none select-none"
      class:invisible={!$showCharacterCounter$ &&
        !$showPercentage$ &&
        !$showFooterChapterCharacterCounter$ &&
        !$showFooterChapterPercentage$}
      style:color={$themeOption$?.tooltipTextFontColor}
      on:click|stopPropagation={({ target }) => {
        if (!$showCharacterCounter$ && !$showPercentage$) {
          return;
        }

        copyCurrentProgress(currentProgress.replace(/ T$/, ''));

        if (target instanceof HTMLElement) {
          pulseElement(target.parentElement || target, 'add', 0.5, 500);
        }
      }}
      on:keyup={dummyFn}
    >
      <span class="progress-details" class:hidden={!showHeader}>{footerChapterProgress}</span>
      <span class:invisible={!$showCharacterCounter$ && !$showPercentage$}
        >{showHeader || !$showPercentage$
          ? currentProgress
          : `${Math.floor((exploredCharCount / bookCharCount) * 100)}%`}</span
      >
    </button>
  {/if}
</footer>

{#if bookCompleted}
  <BookCompletionConfetti {confettiWidthModifier} {confettiMaxRuns} {window} />
{/if}

<svelte:window
  on:keydown={onKeydown}
  on:beforeunload={handleUnload}
  on:resize={() => {
    if ($statisticsEnabled$ && !$isTrackerPaused$) {
      pauseTracker();

      merge(fromEvent(document, PAGE_CHANGE), timer(1000))
        .pipe(debounceTime(1000), take(1))
        .subscribe(() => {
          restartTrackerAfterCharacterChangeOrTime(1000);
        });
    }
  }}
/>

<style>
  .reader-context {
    position: fixed;
    top: calc(1.5rem + env(safe-area-inset-top));
    left: 4rem;
    right: 4rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    font-family: system-ui, sans-serif;
    font-size: 0.75rem;
    pointer-events: none;
  }
  .reader-controls {
    right: max(1rem, env(safe-area-inset-right));
    bottom: calc(4.5rem + env(safe-area-inset-bottom));
  }
  .reader-controls:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 3px;
  }
  .reader-footer {
    height: calc(4.5rem + env(safe-area-inset-bottom));
    padding: 0 max(1rem, env(safe-area-inset-left)) env(safe-area-inset-bottom);
    pointer-events: none;
  }
  .reader-footer :global(button) {
    pointer-events: auto;
  }
  .reader-footer.foliate-chrome-hidden {
    visibility: hidden;
  }
  .reader-footer.foliate-chrome-hidden :global(button) {
    pointer-events: none;
  }
  .reader-progress {
    left: 50%;
    bottom: calc(1rem + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    min-height: 44px;
    max-width: calc(100% - 9rem);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .progress-toggle {
    display: none;
  }
  .controls-expanded .progress-toggle {
    display: block;
  }
  .controls-expanded .reader-progress,
  .many-controls .reader-progress {
    bottom: calc(4.25rem + env(safe-area-inset-bottom));
    padding: 0.5rem 0.75rem;
    border-radius: 1rem;
    background: var(--background);
    max-width: calc(100% - 2rem);
    width: max-content;
  }
  .progress-details {
    color: var(--muted-foreground);
  }
</style>
