/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { createBookReader } from './book-reader-controller';
import type { createDictionary } from './dictionary-controller';
import type { createTracker } from './tracker-controller';
import { ReaderChrome } from '$lib/reader-chrome';
import { bindReaderChromeInteractions } from '$lib/reader-chrome-events';
import { setCompletion } from '$lib/library/commands';
import { readerUIOwnsEvent } from '$lib/functions/reader-ui-events';
import {
  auditTime,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
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
import { browser } from '../runtime/environment';
import { page } from '../runtime/stores';
import { goto } from '../runtime/navigation';
import type { AutoScroller, BookmarkManager, PageManager } from '$lib/components/book-reader/types';
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
import {
  account,
  currentUser,
  localProfileUser,
  localUser,
  refreshAccount
} from '$lib/manabi/client';
import { integrationDB } from '$lib/manabi/persistence';
import { readerAccessOwners } from '$lib/library/account-visibility';
import { legacyReplicationTypes } from '$lib/manabi/legacy-replication';
import type { ReaderAnnotation } from '$lib/data/database/books-db/versions/v7/books-db-v7';
import { ReaderNavigation } from '$lib/reader-navigation';
import { acquireReaderLease } from '$lib/webdav/reader-lock';
import { takeLibraryLocation } from '$lib/library/search-navigation';
import type { ReaderLocator } from '$lib/reader-location';
import { readerBookKeyFor } from '$lib/reader-identity';
import {
  readerImageGalleryPictures$,
  toggleImageGalleryPictureSpoiler$,
  updateImageGalleryPictureSpoilers$
} from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
import {
  getDefaultStatistic,
  isTrackerMenuOpen$,
  isTrackerPaused$
} from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import {
  getChapterData,
  nextChapter$,
  sectionList$,
  sectionProgress$,
  tocIsOpen$,
  type SectionWithProgress
} from '$lib/components/book-reader/book-toc/book-toc';
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
import { ReaderFullscreen } from '$lib/reader-fullscreen';
import { logger } from '$lib/data/logger';
import { MergeMode } from '$lib/data/merge-mode';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import type { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
import { StorageDataType, StorageSourceDefault, StorageKey } from '$lib/data/storage/storage-types';
import { storageSource$ } from '$lib/data/storage/storage-view';
import { readerTheme } from '$lib/data/theme-option';
import { ViewMode } from '$lib/data/view-mode';
import loadBookData from '$lib/functions/book-data-loader/load-book-data';
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
import {
  executeReplicate$,
  type ReplicationContext
} from '$lib/functions/replication/replication-progress';
import { getDateKey } from '$lib/functions/statistic-util';
import {
  convertRemToPixels,
  isMobile$,
  limitToRange,
  getWeightedAverage
} from '$lib/functions/utils';
import { onKeydownReader } from '../routes/b/on-keydown-reader';
import {
  getParagraphToPoint,
  getRangeForUserSelection,
  getReferencePoints,
  pulseElement
} from '$lib/functions/range-util';
import { ReaderController, readerTick, writeStore, type StoreValue } from './controller';
import { LogReportDialog, MessageDialog, ConfirmDialog, NumberDialog } from '../ui/dialogs';
export interface SessionProps {}

export function createSession(
  props: SessionProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let isPaginated: boolean;
  let firstDimensionMargin: number;
  let tapButtonHeight: string;
  let tapButtonTop: string;
  let footerChapterProgress: string;
  let upSyncEnabled: boolean | undefined;
  let $rawBookData$: StoreValue<typeof rawBookData$> = undefined as never;
  let $account: StoreValue<typeof account> = __readerController.read(account);
  let $verticalMode$: StoreValue<typeof verticalMode$> = __readerController.read(verticalMode$);
  let $verticalCustomReadingPosition$: StoreValue<typeof verticalCustomReadingPosition$> =
    __readerController.read(verticalCustomReadingPosition$);
  let $horizontalCustomReadingPosition$: StoreValue<typeof horizontalCustomReadingPosition$> =
    __readerController.read(horizontalCustomReadingPosition$);
  let $enableVerticalFontKerning$: StoreValue<typeof enableVerticalFontKerning$> =
    __readerController.read(enableVerticalFontKerning$);
  let $enableFontVPAL$: StoreValue<typeof enableFontVPAL$> =
    __readerController.read(enableFontVPAL$);
  let $verticalTextOrientation$: StoreValue<typeof verticalTextOrientation$> =
    __readerController.read(verticalTextOrientation$);
  let $cacheStorageData$: StoreValue<typeof cacheStorageData$> =
    __readerController.read(cacheStorageData$);
  let $replicationSaveBehavior$: StoreValue<typeof replicationSaveBehavior$> =
    __readerController.read(replicationSaveBehavior$);
  let $statisticsMergeMode$: StoreValue<typeof statisticsMergeMode$> =
    __readerController.read(statisticsMergeMode$);
  let $readingGoalsMergeMode$: StoreValue<typeof readingGoalsMergeMode$> =
    __readerController.read(readingGoalsMergeMode$);
  let $autoReplication$: StoreValue<typeof autoReplication$> =
    __readerController.read(autoReplication$);
  let $syncTarget$: StoreValue<typeof syncTarget$> = __readerController.read(syncTarget$);
  let $statisticsEnabled$: StoreValue<typeof statisticsEnabled$> =
    __readerController.read(statisticsEnabled$);
  let $startDayHoursForTracker$: StoreValue<typeof startDayHoursForTracker$> =
    __readerController.read(startDayHoursForTracker$);
  let $page: StoreValue<typeof page> = __readerController.read(page);
  let $viewMode$: StoreValue<typeof viewMode$> = __readerController.read(viewMode$);
  let $hideSpoilerImageMode$: StoreValue<typeof hideSpoilerImageMode$> =
    __readerController.read(hideSpoilerImageMode$);
  let $readerImageGalleryPictures$: StoreValue<typeof readerImageGalleryPictures$> =
    __readerController.read(readerImageGalleryPictures$);
  let $trackerAutostartTime$: StoreValue<typeof trackerAutostartTime$> =
    __readerController.read(trackerAutostartTime$);
  let $tocIsOpen$: StoreValue<typeof tocIsOpen$> = __readerController.read(tocIsOpen$);
  let $enableTapEdgeToFlip$: StoreValue<typeof enableTapEdgeToFlip$> =
    __readerController.read(enableTapEdgeToFlip$);
  let $firstDimensionMargin$: StoreValue<typeof firstDimensionMargin$> =
    __readerController.read(firstDimensionMargin$);
  let $sectionData$: StoreValue<typeof sectionData$> = undefined as never;
  let $skipKeyDownListener$: StoreValue<typeof skipKeyDownListener$> =
    __readerController.read(skipKeyDownListener$);
  let $confirmClose$: StoreValue<typeof confirmClose$> = __readerController.read(confirmClose$);
  let $isTrackerPaused$: StoreValue<typeof isTrackerPaused$> =
    __readerController.read(isTrackerPaused$);
  let $addCharactersOnCompletion$: StoreValue<typeof addCharactersOnCompletion$> =
    __readerController.read(addCharactersOnCompletion$);
  let $overwriteBookCompletion$: StoreValue<typeof overwriteBookCompletion$> =
    __readerController.read(overwriteBookCompletion$);
  let $openTrackerOnCompletion$: StoreValue<typeof openTrackerOnCompletion$> =
    __readerController.read(openTrackerOnCompletion$);
  let $showFooterChapterCharacterCounter$: StoreValue<typeof showFooterChapterCharacterCounter$> =
    __readerController.read(showFooterChapterCharacterCounter$);
  let $showFooterChapterPercentage$: StoreValue<typeof showFooterChapterPercentage$> =
    __readerController.read(showFooterChapterPercentage$);
  let $isOnline$: StoreValue<typeof isOnline$> = __readerController.read(isOnline$);
  let $selectionToBookmarkEnabled$: StoreValue<typeof selectionToBookmarkEnabled$> =
    __readerController.read(selectionToBookmarkEnabled$);
  let $storageSource$: StoreValue<typeof storageSource$> = __readerController.read(storageSource$);
  let $manualBookmark$: StoreValue<typeof manualBookmark$> =
    __readerController.read(manualBookmark$);
  let $customReadingPointEnabled$: StoreValue<typeof customReadingPointEnabled$> =
    __readerController.read(customReadingPointEnabled$);
  let $pauseTrackerOnCustomPointChange$: StoreValue<typeof pauseTrackerOnCustomPointChange$> =
    __readerController.read(pauseTrackerOnCustomPointChange$);
  let $collectReaderImageGallerySpoilerToggles$: StoreValue<
    typeof collectReaderImageGallerySpoilerToggles$
  > = undefined as never;
  let $handleUpdateImageGalleryPictureSpoilers$: StoreValue<
    typeof handleUpdateImageGalleryPictureSpoilers$
  > = undefined as never;
  let $themeOption$: StoreValue<typeof themeOption$> = undefined as never;
  let $multiplier$: StoreValue<typeof multiplier$> = __readerController.read(multiplier$);
  let $preFilteredTitlesForStatistics$: StoreValue<typeof preFilteredTitlesForStatistics$> =
    __readerController.read(preFilteredTitlesForStatistics$);
  let $bookData$: StoreValue<typeof bookData$> = undefined as never;
  let $containerViewportWidth$: StoreValue<typeof containerViewportWidth$> = undefined as never;
  let $containerViewportHeight$: StoreValue<typeof containerViewportHeight$> = undefined as never;
  let $prioritizeReaderStyles$: StoreValue<typeof prioritizeReaderStyles$> =
    __readerController.read(prioritizeReaderStyles$);
  let $enableTextJustification$: StoreValue<typeof enableTextJustification$> =
    __readerController.read(enableTextJustification$);
  let $enableTextWrapPretty$: StoreValue<typeof enableTextWrapPretty$> =
    __readerController.read(enableTextWrapPretty$);
  let $backgroundColor$: StoreValue<typeof backgroundColor$> = undefined as never;
  let $fontFamilyGroupOne$: StoreValue<typeof fontFamilyGroupOne$> =
    __readerController.read(fontFamilyGroupOne$);
  let $yuKyokashoAvailable$: StoreValue<typeof yuKyokashoAvailable$> =
    __readerController.read(yuKyokashoAvailable$);
  let $fontFamilyGroupTwo$: StoreValue<typeof fontFamilyGroupTwo$> =
    __readerController.read(fontFamilyGroupTwo$);
  let $fontWeight$: StoreValue<typeof fontWeight$> = __readerController.read(fontWeight$);
  let $fontSize$: StoreValue<typeof fontSize$> = __readerController.read(fontSize$);
  let $lineHeight$: StoreValue<typeof lineHeight$> = __readerController.read(lineHeight$);
  let $textIndentation$: StoreValue<typeof textIndentation$> =
    __readerController.read(textIndentation$);
  let $textMarginMode$: StoreValue<typeof textMarginMode$> =
    __readerController.read(textMarginMode$);
  let $textMarginValue$: StoreValue<typeof textMarginValue$> =
    __readerController.read(textMarginValue$);
  let $hideSpoilerImage$: StoreValue<typeof hideSpoilerImage$> =
    __readerController.read(hideSpoilerImage$);
  let $hideFurigana$: StoreValue<typeof hideFurigana$> = __readerController.read(hideFurigana$);
  let $furiganaStyle$: StoreValue<typeof furiganaStyle$> = __readerController.read(furiganaStyle$);
  let $secondDimensionMaxValue$: StoreValue<typeof secondDimensionMaxValue$> =
    __readerController.read(secondDimensionMaxValue$);
  let $autoPositionOnResize$: StoreValue<typeof autoPositionOnResize$> =
    __readerController.read(autoPositionOnResize$);
  let $avoidPageBreak$: StoreValue<typeof avoidPageBreak$> =
    __readerController.read(avoidPageBreak$);
  let $pageColumns$: StoreValue<typeof pageColumns$> = __readerController.read(pageColumns$);
  let $autoBookmark$: StoreValue<typeof autoBookmark$> = __readerController.read(autoBookmark$);
  let $autoBookmarkTime$: StoreValue<typeof autoBookmarkTime$> =
    __readerController.read(autoBookmarkTime$);
  let $setBackgroundColor$: StoreValue<typeof setBackgroundColor$> = undefined as never;
  let $setWritingMode$: StoreValue<typeof setWritingMode$> = undefined as never;
  let $textSelector$: StoreValue<typeof textSelector$> = undefined as never;
  let $previewAdoption$: StoreValue<typeof previewAdoption$> = undefined as never;
  let $replicator$: StoreValue<typeof replicator$> = undefined as never;
  let $autoStartTracker$: StoreValue<typeof autoStartTracker$> = undefined as never;
  let $leaveIfBookMissing$: StoreValue<typeof leaveIfBookMissing$> = undefined as never;
  let $isMobile$: StoreValue<typeof isMobile$> = __readerController.read(isMobile$);
  let $showCharacterCounter$: StoreValue<typeof showCharacterCounter$> =
    __readerController.read(showCharacterCounter$);
  let $showPercentage$: StoreValue<typeof showPercentage$> =
    __readerController.read(showPercentage$);
  let showSpinner = true;
  let foliatePagination = false;
  let showHeader = true;
  let chromeVisible = true;
  let readerChrome: ReaderChrome | undefined;
  let readerAlive = false;
  let fullscreenActive = false;
  let fullscreenAvailable = false;
  let fullscreenBusy = false;
  let fullscreenError = '';
  let readerFullscreen: ReaderFullscreen | undefined;
  let chromeBookId: number | undefined;
  let chromeNavigationRevision = 0;
  __readerController.effect(
    () => [readerAlive, $rawBookData$],
    () => {
      if (readerAlive && $rawBookData$?.id !== chromeBookId) {
        __readerController.changed((chromeBookId = $rawBookData$?.id));
        readerChrome?.dispose();
        __readerController.changed((chromeVisible = true));
        __readerController.changed((showHeader = true));
        __readerController.changed(
          (readerChrome = new ReaderChrome((mode) => {
            __readerController.changed((chromeVisible = mode !== 'hidden'));
            __readerController.changed((showHeader = chromeVisible));
          }, chromeProtected))
        );
      }
    }
  );
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
  let snippetCapture:
    | {
        html: string;
        title: string;
        item: string;
        owner: string | null;
      }
    | undefined;
  let annotationError = '';
  let annotationStatus = '';
  let annotationBusy = false;
  let annotationSavedVersion = 0;
  let activeSearchLocator: ReaderLocator | undefined;
  let readerContentEpoch = 0;
  let bookReaderComponent: ReturnType<typeof createBookReader> | undefined;
  const readerNavigation = new ReaderNavigation();
  let navigationPreviewing = false;
  let searchOrigin: ReaderLocator | undefined;
  let pendingPreviewAdoption = false;
  let suppressResumeSave = false;
  let revealingReaderLocator = false;
  let previewTrackerWasPaused = false;
  let readerBookKey = '';
  let readerProtectedOwners: string[] = [];
  const stopReaderOwner = localUser.subscribe((user) => {
    if (
      browser &&
      readerProtectedOwners.length &&
      $account.status !== 'loading' &&
      !readerProtectedOwners.includes(user?.id ?? '')
    )
      void goto(`${pagePath}${mergeEntries.MANAGE.routeId}`);
  });
  let libraryTarget: ReaderLocator | undefined;
  let libraryNavigationTask = false;
  let libraryNavigationEpoch = 0;
  let librarySearchMessage = '';
  __readerController.effect(
    () => [
      libraryTarget,
      bookReaderComponent,
      readerBookKey,
      guideContentEl,
      libraryNavigationTask
    ],
    () => {
      if (
        browser &&
        libraryTarget &&
        bookReaderComponent &&
        readerBookKey &&
        guideContentEl &&
        !libraryNavigationTask
      )
        void openLibraryTarget();
    }
  );
  __readerController.effect(
    () => [$rawBookData$],
    () => {
      if (browser && $rawBookData$?.id) {
        const book = $rawBookData$;
        void readerBookKeyFor(book.id, book.contentHash).then((key) => {
          if ($rawBookData$?.id === book.id) __readerController.changed((readerBookKey = key));
        });
      }
    }
  );
  __readerController.effect(
    () => [readerBookKey, $account],
    () => {
      if (browser && readerBookKey && $account.status) {
        const key = readerBookKey;
        const owner = localProfileUser()?.id ?? null;
        if (annotationsOwner !== owner) {
          __readerController.changed((annotations = []));
          __readerController.changed((annotationImportConflicts = []));
          __readerController.changed((annotationsOwner = owner));
        }
        void listReaderAnnotations(key)
          .then((items) => {
            if (readerBookKey === key && (localProfileUser()?.id ?? null) === owner)
              __readerController.changed((annotations = items));
          })
          .catch(() => undefined);
      }
    }
  );
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
  let dictionarySetup: ReturnType<typeof createDictionary> | undefined;
  __readerController.effect(
    () => [lineGuideEnabled],
    () => {
      if (browser) localStorage.setItem('manabi-line-guide', String(lineGuideEnabled));
    }
  );
  __readerController.effect(
    () => [lineGuideLines],
    () => {
      if (browser) localStorage.setItem('manabi-line-guide-lines', String(lineGuideLines));
    }
  );
  __readerController.effect(
    () => [lineGuideDimming],
    () => {
      if (browser) localStorage.setItem('manabi-line-guide-dimming', String(lineGuideDimming));
    }
  );
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
  let trackerElm: ReturnType<typeof createTracker> | undefined;
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
    __readerController.changed((syncedResolver = resolver));
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
      __readerController.changed((readerProtectedOwners = []));
      try {
        __readerController.changed(
          (readerLease ??= acquireReaderLease(readerLeaseLifetime.signal))
        );
        await readerLease;
        if (readerLeaseLifetime.signal.aborted) return undefined;
        __readerController.changed(
          (localStorageHandler = getStorageHandler(
            window,
            StorageKey.BROWSER,
            undefined,
            true,
            $cacheStorageData$,
            $replicationSaveBehavior$,
            $statisticsMergeMode$,
            $readingGoalsMergeMode$
          ))
        );
        localStorageHandler.startContext({ id, title: '' });
        bookData = await localStorageHandler.getBook();
        if (!bookData) {
          return bookData;
        }
        const integration = await integrationDB();
        const booksDb = await database.db;
        const [links, readerScope] = await Promise.all([
          integration.getAll('books').then((items) => items.filter((link) => link.bookId === id)),
          booksDb.get('readerBookScope', id)
        ]);
        const protectedOwners = readerAccessOwners(bookData, readerScope, links);
        if (!protectedOwners) return undefined;
        if (protectedOwners.length && $account.status === 'loading') await refreshAccount();
        if (protectedOwners.length && !protectedOwners.includes(localProfileUser()?.id ?? ''))
          return undefined;
        __readerController.changed((readerProtectedOwners = protectedOwners));
        const personalReadingAuthority = await hasPersonalReadingAuthority(bookData);
        __readerController.changed(
          (personalManagedBookId = personalReadingAuthority ? bookData.id : undefined)
        );
        const currentContext = {
          id: bookData.id,
          title: bookData.title,
          imagePath: bookData.coverImage
        };
        localStorageHandler.startContext(currentContext);
        if (bookData.storageSource) {
          __readerController.changed(
            (externalStorageHandler = await getStorageHandlerByName(bookData.storageSource, true))
          );
        } else if ($autoReplication$ !== AutoReplicationType.Off) {
          __readerController.changed(
            (externalStorageHandler = await getStorageHandlerByName($syncTarget$))
          );
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
        __readerController.changed((showSpinner = false));
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
      // Initialize resume and library-location state before publishing renderable
      // HTML, so every conditional reader consumer sees the same book lifetime.
      __readerController.changed((bookmarkData = database.getBookmark(rawBookData.id)));
      const incomingLocation = takeLibraryLocation(
        rawBookData.id,
        localProfileUser()?.id ?? null,
        $page.url.searchParams.get('library-search')
      );
      if (incomingLocation) {
        __readerController.changed((libraryTarget = incomingLocation));
        __readerController.changed((suppressResumeSave = true));
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
    window.visualViewport ? fromEvent(window.visualViewport, 'resize') : of()
  ).pipe(share());
  const containerViewportWidth$ = resize$.pipe(
    startWith(0),
    map(() => window.visualViewport?.width || window.innerWidth),
    takeWhenBrowser()
  );
  const containerViewportHeight$ = resize$.pipe(
    startWith(0),
    map(() => window.visualViewport?.height || window.innerHeight),
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
      writeStore(
        readerImageGalleryPictures$,
        $readerImageGalleryPictures$.map((galleryPicture) => {
          const picture = galleryPicture;
          if (queuedReaderImageGalleryPictures.has(picture.url)) {
            picture.unspoilered = queuedReaderImageGalleryPictures.get(picture.url)!;
          }
          return picture;
        })
      );
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
      __readerController.changed((pendingPreviewAdoption = false));
      void continueAtPreview();
    }),
    reduceToEmptyString()
  );
  function noteReaderSelection(range: Range | undefined) {
    if (!range && lastSelectedRangeWasEmpty) {
      __readerController.changed((lastSelectedRange = undefined));
    } else if (range) {
      __readerController.changed((lastSelectedRange = range));
      __readerController.changed((lastSelectedRangeWasEmpty = false));
    } else {
      __readerController.changed((lastSelectedRangeWasEmpty = true));
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
      __readerController.changed((wasTrackerPaused = false));
      isTrackerPaused$.next(wasTrackerPaused);
    }),
    reduceToEmptyString()
  );
  __readerController.effect(
    () => [$tocIsOpen$, autoScroller],
    () => {
      if ($tocIsOpen$) {
        autoScroller?.off();
      }
    }
  );
  __readerController.effect(
    () => [bookCharCount],
    () => {
      if (browser && bookCharCount) {
        document.dispatchEvent(new CustomEvent(PAGE_CHANGE, { detail: { exploredCharCount } }));
      }
    }
  );
  __readerController.effect(
    () => [],
    () => {
      if (browser) {
        document.dispatchEvent(new CustomEvent(PAGE_CHANGE, { detail: { bookCharCount } }));
      }
    }
  );
  __readerController.effect(
    () => [customReadingPointRange],
    () => {
      if (showCustomReadingPoint) {
        pauseTracker();
        pulseElement(customReadingPointRange?.endContainer?.parentElement, 'add', 1);
        fromEvent(document, 'click')
          .pipe(skip(1), take(1))
          .subscribe(() => {
            __readerController.changed((showCustomReadingPoint = false));
            pulseElement(customReadingPointRange?.endContainer?.parentElement, 'remove', 1);
            restartTrackerAfterCharacterChangeOrTime(1);
          });
      }
    }
  );
  __readerController.effect(
    () => [exploredCharCount],
    () => {
      if (frozenPosition !== -1 && exploredCharCount >= frozenPosition) {
        if (skipFirstFreezeChange) {
          __readerController.changed((skipFirstFreezeChange = false));
        } else {
          __readerController.changed((frozenPosition = -1));
        }
      }
    }
  );
  __readerController.effect(
    () => [$viewMode$],
    () => {
      __readerController.changed((isPaginated = $viewMode$ === ViewMode.Paginated));
    }
  );
  __readerController.effect(
    () => [$enableTapEdgeToFlip$, isPaginated, $verticalMode$, $firstDimensionMargin$],
    () => {
      __readerController.changed(
        (firstDimensionMargin =
          browser && $enableTapEdgeToFlip$ && isPaginated && $verticalMode$
            ? limitToRange(
                convertRemToPixels(window, 0.5),
                window.innerWidth,
                $firstDimensionMargin$
              )
            : ($firstDimensionMargin$ ?? 0))
      );
    }
  );
  __readerController.effect(
    () => [],
    () => {
      __readerController.changed(
        (tapButtonHeight = 'calc(100% - 10rem - env(safe-area-inset-bottom))')
      );
    }
  );
  __readerController.effect(
    () => [],
    () => {
      __readerController.changed((tapButtonTop = 'calc(4.5rem + env(safe-area-inset-top))'));
    }
  );
  __readerController.effect(
    () => [$sectionData$],
    () => {
      __readerController.changed(
        (footerChapterProgress = getCurrentChapterProgress($sectionData$))
      );
    }
  );
  __readerController.effect(
    () => [externalStorageHandler, $autoReplication$],
    () => {
      __readerController.changed(
        (upSyncEnabled =
          externalStorageHandler &&
          ($autoReplication$ === AutoReplicationType.Up ||
            $autoReplication$ === AutoReplicationType.All))
      );
    }
  );
  __readerController.effect(
    () => [bookmarkData],
    () => {
      bookmarkData.then((data) => {
        __readerController.changed((hasBookmarkData = !!data));
        __readerController.changed((storedExploredCharacter = data?.exploredCharCount || 0));
      });
    }
  );
  __readerController.effect(
    () => [$skipKeyDownListener$],
    () => {
      if (browser) {
        document.dispatchEvent(new CustomEvent(SKIPKEYLISTENER, { detail: $skipKeyDownListener$ }));
      }
    }
  );
  __readerController.onMount(() => document.addEventListener('ttu-action', handleAction, false));
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
  __readerController.onDestroy(() => {
    stopReaderOwner();
    readerLeaseLifetime.abort();
    __readerController.changed(libraryNavigationEpoch++);
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
    __readerController.changed((wasTrackerPaused = $isTrackerPaused$));
    isTrackerPaused$.next(true);
    isTrackerMenuOpen$.next(true);
  }
  function trackerDblClickHandler() {
    if (!$statisticsEnabled$) {
      return;
    }
    dialogManager.dialogs$.next([]);
    __readerController.changed((wasTrackerPaused = !$isTrackerPaused$));
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
    hideReaderChrome();
    autoScroller?.off();
    if ($statisticsEnabled$) {
      __readerController.changed((wasTrackerPaused = true));
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
            dialogMessage: `Would you like to complete this Book${diffToComplete ? ` and capture ${diffToComplete} characters read` : ''}?`,
            resolver
          }
        }
      ]);
    });
    if (wasCanceled) {
      if ($statisticsEnabled$ && !wasTrackerPausedBefore) {
        __readerController.changed((wasTrackerPaused = false));
        writeStore(isTrackerPaused$, false);
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
        if (!trackerElm) throw new Error('Reading tracker is not ready. Please try again.');
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
        __readerController.changed((bookmarkData = database.getBookmark(data.dataId)));
        scheduleReplication(StorageDataType.PROGRESS);
      }
      const celebrateCompletion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if ($statisticsEnabled$ && $openTrackerOnCompletion$) {
        __readerController.changed((confettiWidthModifier = 36));
        __readerController.changed((confettiMaxRuns = 0));
        __readerController.changed(
          (bookCompleted = celebrateCompletion && window.matchMedia('(min-width: 900px)').matches)
        );
        isTrackerMenuOpen$.next(true);
      } else {
        dialogManager.dialogs$.next([]);
        __readerController.changed((confettiWidthModifier = 0));
        __readerController.changed((confettiMaxRuns = 3));
        __readerController.changed((bookCompleted = celebrateCompletion));
        if (bookCompleted) {
          merge(fromEvent(document, 'pointerup'), timer(10000))
            .pipe(take(1))
            .subscribe(() => {
              __readerController.changed((bookCompleted = false));
            });
        }
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
        chapterCharacters = `${Math.min(Math.max(exploredCharCount - (currentChapter.startCharacter as number), 0), endCharacter)} / ${endCharacter}`;
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
      __readerController.changed((frozenPosition = -1));
    } else {
      __readerController.changed((skipFirstFreezeChange = true));
      __readerController.changed((frozenPosition = exploredCharCount));
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
  function hideReaderChrome() {
    readerChrome?.hide();
    __readerController.changed((showHeader = false));
    __readerController.changed((chromeVisible = false));
  }
  let chromeMousePointer = false;
  function hasVisibleModalSurface() {
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="menu"]')].some(
      (element) => {
        if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
        const style = getComputedStyle(element);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          element.getClientRects().length > 0
        );
      }
    );
  }
  function chromeProtected() {
    return (
      showSpinner ||
      showAppearance ||
      showBookSearch ||
      showScrubber ||
      showAnnotations ||
      showReaderImageGallery ||
      $tocIsOpen$ ||
      $skipKeyDownListener$ ||
      hasVisibleModalSurface() ||
      !!document.activeElement?.closest('[data-reader-chrome]') ||
      (chromeMousePointer && !!document.querySelector('[data-reader-chrome]:hover')) ||
      !!window.getSelection()?.toString() ||
      !!guideContentEl?.ownerDocument.getSelection()?.toString()
    );
  }
  __readerController.onMount(() => {
    __readerController.changed((readerAlive = true));
    // Touch emulation can leave :hover stuck on the newly mounted controls.
    // Protect an actual mouse hover without extending the initial touch reveal.
    const noteChromePointer = (event: PointerEvent) => {
      __readerController.changed((chromeMousePointer = event.pointerType === 'mouse'));
    };
    window.addEventListener('pointermove', noteChromePointer, true);
    window.addEventListener('pointerdown', noteChromePointer, true);
    __readerController.changed(
      (readerChrome = new ReaderChrome((mode) => {
        __readerController.changed((chromeVisible = mode !== 'hidden'));
        __readerController.changed((showHeader = chromeVisible));
      }, chromeProtected))
    );
    const stopChromeInteractions = bindReaderChromeInteractions(window, {
      activity: (kind) => readerChrome?.[kind](),
      navigationRevision: () => chromeNavigationRevision,
      selection: () => window.getSelection()?.toString() ?? ''
    });
    __readerController.changed(
      (readerFullscreen = new ReaderFullscreen(
        fullscreenManager,
        document.documentElement,
        (state) => {
          __readerController.changed((fullscreenAvailable = state.available));
          __readerController.changed((fullscreenActive = state.active));
          __readerController.changed((fullscreenBusy = state.busy));
          __readerController.changed((fullscreenError = state.error));
        }
      ))
    );
    const fullscreenChanged = () => {
      readerFullscreen?.sync();
      readerChrome?.pin();
    };
    document.addEventListener('fullscreenchange', fullscreenChanged);
    document.addEventListener('webkitfullscreenchange', fullscreenChanged);
    return () => {
      __readerController.changed((readerAlive = false));
      readerChrome?.dispose();
      window.removeEventListener('pointermove', noteChromePointer, true);
      window.removeEventListener('pointerdown', noteChromePointer, true);
      stopChromeInteractions();
      document.removeEventListener('fullscreenchange', fullscreenChanged);
      document.removeEventListener('webkitfullscreenchange', fullscreenChanged);
      readerFullscreen?.dispose();
    };
  });
  function onKeydown(ev: KeyboardEvent) {
    if (readerUIOwnsEvent(ev)) return;
    if ($skipKeyDownListener$ || ev.altKey || ev.ctrlKey || ev.shiftKey || ev.metaKey) {
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
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    ev.preventDefault();
  }
  function getBookIdSync() {
    let bookId: number | undefined;
    bookId$.subscribe((x) => (bookId = x)).unsubscribe();
    return bookId;
  }
  function bookmarkPage() {
    hideReaderChrome();
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
    __readerController.changed((bookmarkData = Promise.resolve(data)));
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
    const reader = bookReaderComponent;
    const bookKey = readerBookKey;
    if (!reader || !bookKey) return;
    const request = readerNavigation.beginRequest();
    const current = () =>
      request.isCurrent() && reader === bookReaderComponent && bookKey === readerBookKey;
    // Capturing the origin can await layout. Fence resume autosaves before that
    // first await, so a page-change fired while a sheet closes cannot replace it.
    __readerController.changed((suppressResumeSave = true));
    // Modal sheets can lock or shift the reader scrollport. Keep the source
    // point captured before opening the sheet instead of sampling covered text.
    const sheetOrigin =
      source === 'search' ? searchOrigin : source === 'scrubber' ? scrubberPoint : annotationPoint;
    const origin =
      readerNavigation.returnPoint ??
      sheetOrigin ??
      (await reader.captureReaderPoint(bookKey, $rawBookData$?.publicationManifest));
    if (!current()) return;
    if (!origin) {
      __readerController.changed((suppressResumeSave = false));
      return;
    }
    const wasPaused = $isTrackerPaused$;
    if (!readerNavigation.previewing)
      __readerController.changed((previewTrackerWasPaused = wasPaused));
    pauseTracker();
    __readerController.changed((showBookSearch = false));
    __readerController.changed((showScrubber = false));
    __readerController.changed((showAnnotations = false));
    const reopen = () => {
      if (source === 'search') __readerController.changed((showBookSearch = true));
      else if (source === 'scrubber') __readerController.changed((showScrubber = true));
      else __readerController.changed((showAnnotations = true));
    };
    let revealed = false;
    __readerController.changed((revealingReaderLocator = true));
    try {
      await readerTick();
      if (!current()) return;
      revealed = await reader.revealReaderLocator(locator, bookKey);
    } catch (error) {
      if (!current()) return;
      logger.error(
        `Could not open reader location: ${error instanceof Error ? error.message : String(error)}`
      );
      __readerController.changed((suppressResumeSave = false));
      __readerController.changed((revealingReaderLocator = false));
      reopen();
      if (!wasPaused) isTrackerPaused$.next(false);
      return;
    }
    if (!current()) return;
    if (!revealed) {
      __readerController.changed((suppressResumeSave = false));
      __readerController.changed((revealingReaderLocator = false));
      reopen();
      if (!wasPaused) isTrackerPaused$.next(false);
      return;
    }
    readerNavigation.preview(origin, locator);
    __readerController.changed(
      (activeSearchLocator = source === 'search' ? readerNavigation.visiblePoint : undefined)
    );
    __readerController.changed((navigationPreviewing = true));
    __readerController.changed((suppressResumeSave = false));
    __readerController.changed((revealingReaderLocator = false));
  }
  async function openLibraryTarget() {
    const target = libraryTarget;
    if (!target || libraryNavigationTask) return;
    __readerController.changed((libraryTarget = undefined));
    __readerController.changed((libraryNavigationTask = true));
    const epoch = __readerController.changed(++libraryNavigationEpoch);
    const id = $rawBookData$?.id;
    const owner = localProfileUser()?.id ?? null;
    const current = () =>
      epoch === libraryNavigationEpoch &&
      id === $rawBookData$?.id &&
      owner === (localProfileUser()?.id ?? null);
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
          await readerTick();
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
        __readerController.changed(
          (librarySearchMessage =
            error instanceof Error ? error.message : 'Could not open the passage.')
        );
    } finally {
      if (current()) {
        __readerController.changed((libraryNavigationTask = false));
        __readerController.changed((suppressResumeSave = false));
      }
    }
  }
  async function openBookSearch() {
    if (!bookReaderComponent || !readerBookKey) return;
    __readerController.changed(
      (searchOrigin =
        readerNavigation.returnPoint ??
        (await bookReaderComponent.captureReaderPoint(
          readerBookKey,
          $rawBookData$?.publicationManifest
        )))
    );
    hideReaderChrome();
    __readerController.changed((showBookSearch = true));
  }
  async function openScrubber() {
    if (!bookReaderComponent || !readerBookKey) return;
    __readerController.changed(
      (scrubberPoint = await bookReaderComponent.captureReaderPoint(
        readerBookKey,
        $rawBookData$?.publicationManifest
      ))
    );
    hideReaderChrome();
    __readerController.changed((showScrubber = true));
  }
  async function openAnnotations() {
    if (!bookReaderComponent || !readerBookKey) return;
    __readerController.changed((annotationError = ''));
    __readerController.changed((annotationStatus = ''));
    const manifest = $rawBookData$?.publicationManifest;
    try {
      // Capture before focus moves into the sheet; the DOM selection is ephemeral.
      __readerController.changed(
        (snippetCapture = {
          html: bookReaderComponent.captureSnippetHTML(lastSelectedRange),
          title: $rawBookData$?.title ?? '',
          item: readerBookKey,
          owner: localProfileUser()?.id ?? null
        })
      );
      __readerController.changed(
        (annotationSelection = await bookReaderComponent.captureReaderSelection(
          readerBookKey,
          manifest,
          lastSelectedRange
        ))
      );
      __readerController.changed(
        (annotationPoint = await bookReaderComponent.captureReaderPoint(readerBookKey, manifest))
      );
      __readerController.changed((annotations = await listReaderAnnotations(readerBookKey)));
      __readerController.changed(
        (annotationImportConflicts = await listAnnotationImportConflicts(readerBookKey))
      );
      hideReaderChrome();
      __readerController.changed((showAnnotations = true));
    } catch (error) {
      __readerController.changed(
        (annotationError = error instanceof Error ? error.message : String(error))
      );
      __readerController.changed((showAnnotations = true));
    }
  }
  async function addAnnotation(kind: ReaderAnnotation['kind'], body?: string) {
    if (annotationBusy || !readerBookKey) return;
    const targets =
      kind === 'bookmark' ? (annotationPoint ? [annotationPoint] : []) : annotationSelection;
    if (!targets.length) {
      __readerController.changed(
        (annotationError =
          kind === 'bookmark'
            ? 'The current reading position is not ready yet.'
            : 'Select a passage in this book first.')
      );
      return;
    }
    __readerController.changed((annotationBusy = true));
    __readerController.changed((annotationError = ''));
    try {
      await saveReaderAnnotation(
        { bookKey: readerBookKey, kind, targets, body },
        localProfileUser()?.id
      );
      __readerController.changed((annotations = await listReaderAnnotations(readerBookKey)));
      if (kind === 'note') __readerController.changed((annotationSavedVersion += 1));
    } catch (error) {
      __readerController.changed(
        (annotationError = error instanceof Error ? error.message : String(error))
      );
    } finally {
      __readerController.changed((annotationBusy = false));
    }
  }
  async function removeAnnotation(id: string) {
    if (annotationBusy) return;
    __readerController.changed((annotationBusy = true));
    __readerController.changed((annotationError = ''));
    try {
      await removeReaderAnnotation(id, localProfileUser()?.id);
      __readerController.changed((annotations = await listReaderAnnotations(readerBookKey)));
    } catch (error) {
      __readerController.changed(
        (annotationError = error instanceof Error ? error.message : String(error))
      );
    } finally {
      __readerController.changed((annotationBusy = false));
    }
  }
  async function exportAnnotations() {
    if (annotationBusy) return;
    __readerController.changed((annotationBusy = true));
    __readerController.changed((annotationError = ''));
    __readerController.changed((annotationStatus = ''));
    try {
      const json = await exportReaderAnnotations();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'manabi-reader-annotations.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      __readerController.changed((annotationStatus = 'Notes archive downloaded.'));
    } catch (error) {
      __readerController.changed(
        (annotationError = error instanceof Error ? error.message : String(error))
      );
    } finally {
      __readerController.changed((annotationBusy = false));
    }
  }
  async function importAnnotations(file: File) {
    if (annotationBusy) return;
    __readerController.changed((annotationBusy = true));
    __readerController.changed((annotationError = ''));
    __readerController.changed((annotationStatus = ''));
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('The annotation archive is too large.');
      const result = await importReaderAnnotations(await file.text(), localProfileUser()?.id);
      __readerController.changed((annotations = await listReaderAnnotations(readerBookKey)));
      __readerController.changed(
        (annotationImportConflicts = await listAnnotationImportConflicts(readerBookKey))
      );
      __readerController.changed(
        (annotationStatus = `${result.imported} imported, ${result.alreadyPresent} already present, ${result.conflicts} kept for conflict review. Archives may include notes for books not currently connected.`)
      );
    } catch (error) {
      __readerController.changed(
        (annotationError = error instanceof Error ? error.message : String(error))
      );
    } finally {
      __readerController.changed((annotationBusy = false));
    }
  }
  async function resolveImportConflict(id: string, choice: 'keep-local' | 'restore-archive') {
    if (annotationBusy) return;
    __readerController.changed((annotationBusy = true));
    __readerController.changed((annotationError = ''));
    try {
      await resolveAnnotationImportConflict(id, choice, localProfileUser()?.id);
      __readerController.changed((annotations = await listReaderAnnotations(readerBookKey)));
      __readerController.changed(
        (annotationImportConflicts = await listAnnotationImportConflicts(readerBookKey))
      );
      __readerController.changed(
        (annotationStatus =
          choice === 'restore-archive' ? 'Archived passage restored.' : 'Current copy kept.')
      );
    } catch (error) {
      __readerController.changed(
        (annotationError = error instanceof Error ? error.message : String(error))
      );
    } finally {
      __readerController.changed((annotationBusy = false));
    }
  }
  async function returnToReadingPoint() {
    const origin = readerNavigation.returnPoint;
    if (!origin || !bookReaderComponent || !readerBookKey) return;
    __readerController.changed((revealingReaderLocator = true));
    try {
      if (!(await bookReaderComponent.revealReaderLocator(origin, readerBookKey))) return;
      readerNavigation.returnToOrigin();
      __readerController.changed((pendingPreviewAdoption = false));
      __readerController.changed((activeSearchLocator = undefined));
      __readerController.changed((navigationPreviewing = false));
      isTrackerPaused$.next(previewTrackerWasPaused);
    } finally {
      __readerController.changed((revealingReaderLocator = false));
    }
  }
  async function continueAtPreview() {
    if (!readerNavigation.previewing) return;
    readerNavigation.continueHere();
    __readerController.changed((pendingPreviewAdoption = false));
    __readerController.changed((activeSearchLocator = undefined));
    __readerController.changed((navigationPreviewing = false));
    await saveBookmark();
    isTrackerPaused$.next(previewTrackerWasPaused);
  }
  async function restorePreviewAfterReflow(epoch: number) {
    const target = readerNavigation.visiblePoint;
    if (revealingReaderLocator || !target || !bookReaderComponent || !readerBookKey) return;
    await readerTick();
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
    readerChrome?.pin();
    void readerFullscreen?.toggle();
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
  let replicationOperation: Promise<void> | undefined;
  function executeReplication(isSilent = true): Promise<void> {
    if (replicationOperation) return replicationOperation;
    replicationOperation = performReplication(isSilent).finally(() => {
      replicationOperation = undefined;
      __readerController.changed((isReplicating = false));
    });
    return replicationOperation;
  }
  async function performReplication(isSilent = true): Promise<void> {
    if (isReplicating || !dataToReplicate.length || !$rawBookData$ || !externalStorageHandler) {
      return;
    }
    const bookForReplication = $rawBookData$;
    const handlerForReplication = externalStorageHandler;
    __readerController.changed((isReplicating = true));
    const personalReadingAuthority = await hasPersonalReadingAuthority(bookForReplication);
    if (
      $rawBookData$?.id !== bookForReplication.id ||
      externalStorageHandler !== handlerForReplication
    ) {
      __readerController.changed((dataToReplicate = []));
      __readerController.changed((dataToReplicateQueue = []));
      __readerController.changed((isReplicating = false));
      return;
    }
    __readerController.changed(
      (dataToReplicate = legacyReplicationTypes(
        dataToReplicate,
        personalReadingAuthority,
        personalReplicationTypes
      ))
    );
    __readerController.changed(
      (dataToReplicateQueue = legacyReplicationTypes(
        dataToReplicateQueue,
        personalReadingAuthority,
        personalReplicationTypes
      ))
    );
    if (!dataToReplicate.length) {
      __readerController.changed((dataToReplicate = dataToReplicateQueue));
      __readerController.changed((dataToReplicateQueue = []));
      __readerController.changed((isReplicating = false));
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
    __readerController.changed((isReplicating = false));
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
      __readerController.changed((externalStorageErrors += 1));
    } else {
      __readerController.changed((externalStorageErrors = 0));
      if (!isSilent) {
        dialogManager.dialogs$.next([]);
      }
      if (dataToReplicateQueue.length) {
        const isAudioBookOnly =
          dataToReplicate.length === 1 && dataToReplicate[0] === StorageDataType.AUDIOBOOK;
        __readerController.changed(
          (dataToReplicate = JSON.parse(JSON.stringify(dataToReplicateQueue)))
        );
        __readerController.changed((dataToReplicateQueue = []));
        if (isSilent || isAudioBookOnly) {
          executeReplicate$.next();
        } else if (!isAudioBookOnly) {
          await performReplication(false);
        } else {
          __readerController.changed((dataToReplicate = []));
        }
      } else {
        __readerController.changed((dataToReplicate = []));
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
  let closeOperation: Promise<boolean> | undefined;
  let exitHandler: (() => void) | undefined;
  function setExitHandler(handler: (() => void) | undefined) {
    exitHandler = handler;
  }
  function requestClose(): Promise<boolean> {
    return leaveReader(undefined);
  }
  function leaveReader(routeId?: string, deleteLastItem = true): Promise<boolean> {
    if (__readerController.disposed) return Promise.resolve(false);
    closeOperation ??= performLeaveReader(routeId, deleteLastItem).finally(() => {
      closeOperation = undefined;
    });
    return closeOperation;
  }
  async function performLeaveReader(routeId?: string, deleteLastItem = true): Promise<boolean> {
    let message;
    try {
      __readerController.changed((blockDataUpdates = true));
      await readerTick();
      autoScroller?.off();
      __readerController.changed((wasTrackerPaused = true));
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
          __readerController.changed((blockDataUpdates = false));
          return false;
        }
        await readerTick();
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
        // An existing background upload owns its settlement. Do not let Back
        // retire the session merely because a second sync call was ignored.
        if (replicationOperation) await replicationOperation;
        do {
          if (__readerController.disposed || !$rawBookData$ || !externalStorageHandler) {
            __readerController.changed((blockDataUpdates = false));
            return false;
          }
          await executeReplication(false);
          if (externalStorageErrors && (dataToReplicate.length || dataToReplicateQueue.length)) {
            __readerController.changed((blockDataUpdates = false));
            return false;
          }
        } while (dataToReplicate.length || dataToReplicateQueue.length);
      }
    } catch (error: any) {
      message = error.message;
    }
    if (message) {
      logger.error(message);
      __readerController.changed((dismissDialogs = false));
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
    if (message || __readerController.disposed) {
      __readerController.changed((blockDataUpdates = false));
      return false;
    }
    if (routeId === mergeEntries.MANAGE.routeId && exitHandler) exitHandler();
    else if (routeId) await goto(`${pagePath}${routeId}`);
    return true;
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
      __readerController.changed((customReadingPointTop = window.innerHeight / 2 - 2));
      __readerController.changed((customReadingPointLeft = window.innerWidth / 2 - 2));
    }
    hideReaderChrome();
    __readerController.changed((isSelectingCustomReadingPoint = true));
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
          __readerController.changed((isSelectingCustomReadingPoint = false));
          readerTick().then(() => {
            __readerController.changed(
              (customReadingPointLeft = $verticalMode$ ? event.x : customReadingPointLeft)
            );
            __readerController.changed(
              (customReadingPointTop = $verticalMode$ ? customReadingPointTop : event.y)
            );
            const result = getParagraphToPoint(customReadingPointLeft, customReadingPointTop);
            if (result) {
              pulseElement(result.parent, 'add', 0.5, 500);
            }
            if (isPaginated) {
              __readerController.changed((customReadingPointRange = result?.range));
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
              __readerController.changed((customReadingPoint = newPercentage));
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
            __readerController.changed(
              (customReadingPointTop = insideYBound ? event.y : customReadingPointTop)
            );
            __readerController.changed(
              (customReadingPointLeft = insideXBound ? event.x : customReadingPointLeft)
            );
          } else if ($verticalMode$ && insideXBound) {
            __readerController.changed((customReadingPointLeft = event.x));
          } else if (!$verticalMode$ && insideYBound) {
            __readerController.changed((customReadingPointTop = event.y));
          }
        }
      });
  }
  function pauseTracker(restartAfterCharacterChange = false) {
    if ($statisticsEnabled$ && !$isTrackerPaused$) {
      __readerController.changed((wasTrackerPaused = false));
      writeStore(isTrackerPaused$, true);
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
        __readerController.changed((wasTrackerPaused = false));
        writeStore(isTrackerPaused$, false);
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
        __readerController.changed((dataToReplicate = [...dataToReplicate]));
      }
      if (!blockDataUpdates) {
        executeReplicate$.next();
      }
    }
  }
  __readerController.observeSource(
    () => rawBookData$,
    (value) => {
      $rawBookData$ = value;
    }
  );
  __readerController.observeSource(
    () => account,
    (value) => {
      $account = value;
    }
  );
  __readerController.observeSource(
    () => verticalMode$,
    (value) => {
      $verticalMode$ = value;
    }
  );
  __readerController.observeSource(
    () => verticalCustomReadingPosition$,
    (value) => {
      $verticalCustomReadingPosition$ = value;
    }
  );
  __readerController.observeSource(
    () => horizontalCustomReadingPosition$,
    (value) => {
      $horizontalCustomReadingPosition$ = value;
    }
  );
  __readerController.observeSource(
    () => enableVerticalFontKerning$,
    (value) => {
      $enableVerticalFontKerning$ = value;
    }
  );
  __readerController.observeSource(
    () => enableFontVPAL$,
    (value) => {
      $enableFontVPAL$ = value;
    }
  );
  __readerController.observeSource(
    () => verticalTextOrientation$,
    (value) => {
      $verticalTextOrientation$ = value;
    }
  );
  __readerController.observeSource(
    () => cacheStorageData$,
    (value) => {
      $cacheStorageData$ = value;
    }
  );
  __readerController.observeSource(
    () => replicationSaveBehavior$,
    (value) => {
      $replicationSaveBehavior$ = value;
    }
  );
  __readerController.observeSource(
    () => statisticsMergeMode$,
    (value) => {
      $statisticsMergeMode$ = value;
    }
  );
  __readerController.observeSource(
    () => readingGoalsMergeMode$,
    (value) => {
      $readingGoalsMergeMode$ = value;
    }
  );
  __readerController.observeSource(
    () => autoReplication$,
    (value) => {
      $autoReplication$ = value;
    }
  );
  __readerController.observeSource(
    () => syncTarget$,
    (value) => {
      $syncTarget$ = value;
    }
  );
  __readerController.observeSource(
    () => statisticsEnabled$,
    (value) => {
      $statisticsEnabled$ = value;
    }
  );
  __readerController.observeSource(
    () => startDayHoursForTracker$,
    (value) => {
      $startDayHoursForTracker$ = value;
    }
  );
  __readerController.observeSource(
    () => page,
    (value) => {
      $page = value;
    }
  );
  __readerController.observeSource(
    () => viewMode$,
    (value) => {
      $viewMode$ = value;
    }
  );
  __readerController.observeSource(
    () => hideSpoilerImageMode$,
    (value) => {
      $hideSpoilerImageMode$ = value;
    }
  );
  __readerController.observeSource(
    () => readerImageGalleryPictures$,
    (value) => {
      $readerImageGalleryPictures$ = value;
    }
  );
  __readerController.observeSource(
    () => trackerAutostartTime$,
    (value) => {
      $trackerAutostartTime$ = value;
    }
  );
  __readerController.observeSource(
    () => tocIsOpen$,
    (value) => {
      $tocIsOpen$ = value;
    }
  );
  __readerController.observeSource(
    () => enableTapEdgeToFlip$,
    (value) => {
      $enableTapEdgeToFlip$ = value;
    }
  );
  __readerController.observeSource(
    () => firstDimensionMargin$,
    (value) => {
      $firstDimensionMargin$ = value;
    }
  );
  __readerController.observeSource(
    () => sectionData$,
    (value) => {
      $sectionData$ = value;
    }
  );
  __readerController.observeSource(
    () => skipKeyDownListener$,
    (value) => {
      $skipKeyDownListener$ = value;
    }
  );
  __readerController.observeSource(
    () => confirmClose$,
    (value) => {
      $confirmClose$ = value;
    }
  );
  __readerController.observeSource(
    () => isTrackerPaused$,
    (value) => {
      $isTrackerPaused$ = value;
    }
  );
  __readerController.observeSource(
    () => addCharactersOnCompletion$,
    (value) => {
      $addCharactersOnCompletion$ = value;
    }
  );
  __readerController.observeSource(
    () => overwriteBookCompletion$,
    (value) => {
      $overwriteBookCompletion$ = value;
    }
  );
  __readerController.observeSource(
    () => openTrackerOnCompletion$,
    (value) => {
      $openTrackerOnCompletion$ = value;
    }
  );
  __readerController.observeSource(
    () => showFooterChapterCharacterCounter$,
    (value) => {
      $showFooterChapterCharacterCounter$ = value;
    }
  );
  __readerController.observeSource(
    () => showFooterChapterPercentage$,
    (value) => {
      $showFooterChapterPercentage$ = value;
    }
  );
  __readerController.observeSource(
    () => isOnline$,
    (value) => {
      $isOnline$ = value;
    }
  );
  __readerController.observeSource(
    () => selectionToBookmarkEnabled$,
    (value) => {
      $selectionToBookmarkEnabled$ = value;
    }
  );
  __readerController.observeSource(
    () => storageSource$,
    (value) => {
      $storageSource$ = value;
    }
  );
  __readerController.observeSource(
    () => manualBookmark$,
    (value) => {
      $manualBookmark$ = value;
    }
  );
  __readerController.observeSource(
    () => customReadingPointEnabled$,
    (value) => {
      $customReadingPointEnabled$ = value;
    }
  );
  __readerController.observeSource(
    () => pauseTrackerOnCustomPointChange$,
    (value) => {
      $pauseTrackerOnCustomPointChange$ = value;
    }
  );
  __readerController.observeSource(
    () => collectReaderImageGallerySpoilerToggles$,
    (value) => {
      $collectReaderImageGallerySpoilerToggles$ = value;
    }
  );
  __readerController.observeSource(
    () => handleUpdateImageGalleryPictureSpoilers$,
    (value) => {
      $handleUpdateImageGalleryPictureSpoilers$ = value;
    }
  );
  __readerController.observeSource(
    () => themeOption$,
    (value) => {
      $themeOption$ = value;
    }
  );
  __readerController.observeSource(
    () => multiplier$,
    (value) => {
      $multiplier$ = value;
    }
  );
  __readerController.observeSource(
    () => preFilteredTitlesForStatistics$,
    (value) => {
      $preFilteredTitlesForStatistics$ = value;
    }
  );
  __readerController.observeSource(
    () => bookData$,
    (value) => {
      $bookData$ = value;
    }
  );
  __readerController.observeSource(
    () => containerViewportWidth$,
    (value) => {
      $containerViewportWidth$ = value;
    }
  );
  __readerController.observeSource(
    () => containerViewportHeight$,
    (value) => {
      $containerViewportHeight$ = value;
    }
  );
  __readerController.observeSource(
    () => prioritizeReaderStyles$,
    (value) => {
      $prioritizeReaderStyles$ = value;
    }
  );
  __readerController.observeSource(
    () => enableTextJustification$,
    (value) => {
      $enableTextJustification$ = value;
    }
  );
  __readerController.observeSource(
    () => enableTextWrapPretty$,
    (value) => {
      $enableTextWrapPretty$ = value;
    }
  );
  __readerController.observeSource(
    () => backgroundColor$,
    (value) => {
      $backgroundColor$ = value;
    }
  );
  __readerController.observeSource(
    () => fontFamilyGroupOne$,
    (value) => {
      $fontFamilyGroupOne$ = value;
    }
  );
  __readerController.observeSource(
    () => yuKyokashoAvailable$,
    (value) => {
      $yuKyokashoAvailable$ = value;
    }
  );
  __readerController.observeSource(
    () => fontFamilyGroupTwo$,
    (value) => {
      $fontFamilyGroupTwo$ = value;
    }
  );
  __readerController.observeSource(
    () => fontWeight$,
    (value) => {
      $fontWeight$ = value;
    }
  );
  __readerController.observeSource(
    () => fontSize$,
    (value) => {
      $fontSize$ = value;
    }
  );
  __readerController.observeSource(
    () => lineHeight$,
    (value) => {
      $lineHeight$ = value;
    }
  );
  __readerController.observeSource(
    () => textIndentation$,
    (value) => {
      $textIndentation$ = value;
    }
  );
  __readerController.observeSource(
    () => textMarginMode$,
    (value) => {
      $textMarginMode$ = value;
    }
  );
  __readerController.observeSource(
    () => textMarginValue$,
    (value) => {
      $textMarginValue$ = value;
    }
  );
  __readerController.observeSource(
    () => hideSpoilerImage$,
    (value) => {
      $hideSpoilerImage$ = value;
    }
  );
  __readerController.observeSource(
    () => hideFurigana$,
    (value) => {
      $hideFurigana$ = value;
    }
  );
  __readerController.observeSource(
    () => furiganaStyle$,
    (value) => {
      $furiganaStyle$ = value;
    }
  );
  __readerController.observeSource(
    () => secondDimensionMaxValue$,
    (value) => {
      $secondDimensionMaxValue$ = value;
    }
  );
  __readerController.observeSource(
    () => autoPositionOnResize$,
    (value) => {
      $autoPositionOnResize$ = value;
    }
  );
  __readerController.observeSource(
    () => avoidPageBreak$,
    (value) => {
      $avoidPageBreak$ = value;
    }
  );
  __readerController.observeSource(
    () => pageColumns$,
    (value) => {
      $pageColumns$ = value;
    }
  );
  __readerController.observeSource(
    () => autoBookmark$,
    (value) => {
      $autoBookmark$ = value;
    }
  );
  __readerController.observeSource(
    () => autoBookmarkTime$,
    (value) => {
      $autoBookmarkTime$ = value;
    }
  );
  __readerController.observeSource(
    () => setBackgroundColor$,
    (value) => {
      $setBackgroundColor$ = value;
    }
  );
  __readerController.observeSource(
    () => setWritingMode$,
    (value) => {
      $setWritingMode$ = value;
    }
  );
  __readerController.observeSource(
    () => textSelector$,
    (value) => {
      $textSelector$ = value;
    }
  );
  __readerController.observeSource(
    () => previewAdoption$,
    (value) => {
      $previewAdoption$ = value;
    }
  );
  __readerController.observeSource(
    () => replicator$,
    (value) => {
      $replicator$ = value;
    }
  );
  __readerController.observeSource(
    () => autoStartTracker$,
    (value) => {
      $autoStartTracker$ = value;
    }
  );
  __readerController.observeSource(
    () => leaveIfBookMissing$,
    (value) => {
      $leaveIfBookMissing$ = value;
    }
  );
  __readerController.observeSource(
    () => isMobile$,
    (value) => {
      $isMobile$ = value;
    }
  );
  __readerController.observeSource(
    () => showCharacterCounter$,
    (value) => {
      $showCharacterCounter$ = value;
    }
  );
  __readerController.observeSource(
    () => showPercentage$,
    (value) => {
      $showPercentage$ = value;
    }
  );
  const api = {
    controller: __readerController,
    requestClose,
    setExitHandler,
    noteReaderSelection,
    handleAction,
    handleUnload,
    trackerSingleClickHandler,
    trackerDblClickHandler,
    handleJump,
    completeBook,
    getCurrentChapterProgress,
    copyCurrentProgress,
    freezeTrackerPosition,
    getStorageHandlerByName,
    saveExternalLastRead,
    hasPersonalReadingAuthority,
    syncDownData,
    hideReaderChrome,
    hasVisibleModalSurface,
    chromeProtected,
    onKeydown,
    getBookIdSync,
    bookmarkPage,
    saveBookmark,
    scrollToBookmark,
    previewLocator,
    openLibraryTarget,
    openBookSearch,
    openScrubber,
    openAnnotations,
    addAnnotation,
    removeAnnotation,
    exportAnnotations,
    importAnnotations,
    resolveImportConflict,
    returnToReadingPoint,
    continueAtPreview,
    restorePreviewAfterReflow,
    onFullscreenClick,
    onDomainHintClick,
    changeChapter,
    executeReplication,
    openActionBackdrop,
    leaveReader,
    handleSetCustomReadingPoint,
    pauseTracker,
    restartTrackerAfterCharacterChangeOrTime,
    scheduleReplication,
    get showSpinner() {
      return showSpinner;
    },
    set showSpinner(nextValue: typeof showSpinner) {
      if (Object.is(showSpinner, nextValue)) return;
      showSpinner = nextValue;
      __readerController.invalidate();
    },
    get foliatePagination() {
      return foliatePagination;
    },
    set foliatePagination(nextValue: typeof foliatePagination) {
      if (Object.is(foliatePagination, nextValue)) return;
      foliatePagination = nextValue;
      __readerController.invalidate();
    },
    get showHeader() {
      return showHeader;
    },
    set showHeader(nextValue: typeof showHeader) {
      if (Object.is(showHeader, nextValue)) return;
      showHeader = nextValue;
      __readerController.invalidate();
    },
    get chromeVisible() {
      return chromeVisible;
    },
    set chromeVisible(nextValue: typeof chromeVisible) {
      if (Object.is(chromeVisible, nextValue)) return;
      chromeVisible = nextValue;
      __readerController.invalidate();
    },
    get readerChrome() {
      return readerChrome;
    },
    set readerChrome(nextValue: typeof readerChrome) {
      if (Object.is(readerChrome, nextValue)) return;
      readerChrome = nextValue;
      __readerController.invalidate();
    },
    get readerAlive() {
      return readerAlive;
    },
    set readerAlive(nextValue: typeof readerAlive) {
      if (Object.is(readerAlive, nextValue)) return;
      readerAlive = nextValue;
      __readerController.invalidate();
    },
    get fullscreenActive() {
      return fullscreenActive;
    },
    set fullscreenActive(nextValue: typeof fullscreenActive) {
      if (Object.is(fullscreenActive, nextValue)) return;
      fullscreenActive = nextValue;
      __readerController.invalidate();
    },
    get fullscreenAvailable() {
      return fullscreenAvailable;
    },
    set fullscreenAvailable(nextValue: typeof fullscreenAvailable) {
      if (Object.is(fullscreenAvailable, nextValue)) return;
      fullscreenAvailable = nextValue;
      __readerController.invalidate();
    },
    get fullscreenBusy() {
      return fullscreenBusy;
    },
    set fullscreenBusy(nextValue: typeof fullscreenBusy) {
      if (Object.is(fullscreenBusy, nextValue)) return;
      fullscreenBusy = nextValue;
      __readerController.invalidate();
    },
    get fullscreenError() {
      return fullscreenError;
    },
    set fullscreenError(nextValue: typeof fullscreenError) {
      if (Object.is(fullscreenError, nextValue)) return;
      fullscreenError = nextValue;
      __readerController.invalidate();
    },
    get readerFullscreen() {
      return readerFullscreen;
    },
    set readerFullscreen(nextValue: typeof readerFullscreen) {
      if (Object.is(readerFullscreen, nextValue)) return;
      readerFullscreen = nextValue;
      __readerController.invalidate();
    },
    get chromeBookId() {
      return chromeBookId;
    },
    set chromeBookId(nextValue: typeof chromeBookId) {
      if (Object.is(chromeBookId, nextValue)) return;
      chromeBookId = nextValue;
      __readerController.invalidate();
    },
    get chromeNavigationRevision() {
      return chromeNavigationRevision;
    },
    set chromeNavigationRevision(nextValue: typeof chromeNavigationRevision) {
      if (Object.is(chromeNavigationRevision, nextValue)) return;
      chromeNavigationRevision = nextValue;
      __readerController.invalidate();
    },
    get showAppearance() {
      return showAppearance;
    },
    set showAppearance(nextValue: typeof showAppearance) {
      if (Object.is(showAppearance, nextValue)) return;
      showAppearance = nextValue;
      __readerController.invalidate();
    },
    get showBookSearch() {
      return showBookSearch;
    },
    set showBookSearch(nextValue: typeof showBookSearch) {
      if (Object.is(showBookSearch, nextValue)) return;
      showBookSearch = nextValue;
      __readerController.invalidate();
    },
    get showScrubber() {
      return showScrubber;
    },
    set showScrubber(nextValue: typeof showScrubber) {
      if (Object.is(showScrubber, nextValue)) return;
      showScrubber = nextValue;
      __readerController.invalidate();
    },
    get scrubberPoint() {
      return scrubberPoint;
    },
    set scrubberPoint(nextValue: typeof scrubberPoint) {
      if (Object.is(scrubberPoint, nextValue)) return;
      scrubberPoint = nextValue;
      __readerController.invalidate();
    },
    get showAnnotations() {
      return showAnnotations;
    },
    set showAnnotations(nextValue: typeof showAnnotations) {
      if (Object.is(showAnnotations, nextValue)) return;
      showAnnotations = nextValue;
      __readerController.invalidate();
    },
    get annotations() {
      return annotations;
    },
    set annotations(nextValue: typeof annotations) {
      if (Object.is(annotations, nextValue)) return;
      annotations = nextValue;
      __readerController.invalidate();
    },
    get annotationsOwner() {
      return annotationsOwner;
    },
    set annotationsOwner(nextValue: typeof annotationsOwner) {
      if (Object.is(annotationsOwner, nextValue)) return;
      annotationsOwner = nextValue;
      __readerController.invalidate();
    },
    get annotationImportConflicts() {
      return annotationImportConflicts;
    },
    set annotationImportConflicts(nextValue: typeof annotationImportConflicts) {
      if (Object.is(annotationImportConflicts, nextValue)) return;
      annotationImportConflicts = nextValue;
      __readerController.invalidate();
    },
    get annotationSelection() {
      return annotationSelection;
    },
    set annotationSelection(nextValue: typeof annotationSelection) {
      if (Object.is(annotationSelection, nextValue)) return;
      annotationSelection = nextValue;
      __readerController.invalidate();
    },
    get annotationPoint() {
      return annotationPoint;
    },
    set annotationPoint(nextValue: typeof annotationPoint) {
      if (Object.is(annotationPoint, nextValue)) return;
      annotationPoint = nextValue;
      __readerController.invalidate();
    },
    get snippetCapture() {
      return snippetCapture;
    },
    set snippetCapture(nextValue: typeof snippetCapture) {
      if (Object.is(snippetCapture, nextValue)) return;
      snippetCapture = nextValue;
      __readerController.invalidate();
    },
    get annotationError() {
      return annotationError;
    },
    set annotationError(nextValue: typeof annotationError) {
      if (Object.is(annotationError, nextValue)) return;
      annotationError = nextValue;
      __readerController.invalidate();
    },
    get annotationStatus() {
      return annotationStatus;
    },
    set annotationStatus(nextValue: typeof annotationStatus) {
      if (Object.is(annotationStatus, nextValue)) return;
      annotationStatus = nextValue;
      __readerController.invalidate();
    },
    get annotationBusy() {
      return annotationBusy;
    },
    set annotationBusy(nextValue: typeof annotationBusy) {
      if (Object.is(annotationBusy, nextValue)) return;
      annotationBusy = nextValue;
      __readerController.invalidate();
    },
    get annotationSavedVersion() {
      return annotationSavedVersion;
    },
    set annotationSavedVersion(nextValue: typeof annotationSavedVersion) {
      if (Object.is(annotationSavedVersion, nextValue)) return;
      annotationSavedVersion = nextValue;
      __readerController.invalidate();
    },
    get activeSearchLocator() {
      return activeSearchLocator;
    },
    set activeSearchLocator(nextValue: typeof activeSearchLocator) {
      if (Object.is(activeSearchLocator, nextValue)) return;
      activeSearchLocator = nextValue;
      __readerController.invalidate();
    },
    get readerContentEpoch() {
      return readerContentEpoch;
    },
    set readerContentEpoch(nextValue: typeof readerContentEpoch) {
      if (Object.is(readerContentEpoch, nextValue)) return;
      readerContentEpoch = nextValue;
      __readerController.invalidate();
    },
    get bookReaderComponent() {
      return bookReaderComponent;
    },
    set bookReaderComponent(nextValue: typeof bookReaderComponent) {
      if (Object.is(bookReaderComponent, nextValue)) return;
      bookReaderComponent = nextValue;
      __readerController.invalidate();
    },
    get readerNavigation() {
      return readerNavigation;
    },
    get navigationPreviewing() {
      return navigationPreviewing;
    },
    set navigationPreviewing(nextValue: typeof navigationPreviewing) {
      if (Object.is(navigationPreviewing, nextValue)) return;
      navigationPreviewing = nextValue;
      __readerController.invalidate();
    },
    get searchOrigin() {
      return searchOrigin;
    },
    set searchOrigin(nextValue: typeof searchOrigin) {
      if (Object.is(searchOrigin, nextValue)) return;
      searchOrigin = nextValue;
      __readerController.invalidate();
    },
    get pendingPreviewAdoption() {
      return pendingPreviewAdoption;
    },
    set pendingPreviewAdoption(nextValue: typeof pendingPreviewAdoption) {
      if (Object.is(pendingPreviewAdoption, nextValue)) return;
      pendingPreviewAdoption = nextValue;
      __readerController.invalidate();
    },
    get suppressResumeSave() {
      return suppressResumeSave;
    },
    set suppressResumeSave(nextValue: typeof suppressResumeSave) {
      if (Object.is(suppressResumeSave, nextValue)) return;
      suppressResumeSave = nextValue;
      __readerController.invalidate();
    },
    get revealingReaderLocator() {
      return revealingReaderLocator;
    },
    set revealingReaderLocator(nextValue: typeof revealingReaderLocator) {
      if (Object.is(revealingReaderLocator, nextValue)) return;
      revealingReaderLocator = nextValue;
      __readerController.invalidate();
    },
    get previewTrackerWasPaused() {
      return previewTrackerWasPaused;
    },
    set previewTrackerWasPaused(nextValue: typeof previewTrackerWasPaused) {
      if (Object.is(previewTrackerWasPaused, nextValue)) return;
      previewTrackerWasPaused = nextValue;
      __readerController.invalidate();
    },
    get readerBookKey() {
      return readerBookKey;
    },
    set readerBookKey(nextValue: typeof readerBookKey) {
      if (Object.is(readerBookKey, nextValue)) return;
      readerBookKey = nextValue;
      __readerController.invalidate();
    },
    get readerProtectedOwners() {
      return readerProtectedOwners;
    },
    set readerProtectedOwners(nextValue: typeof readerProtectedOwners) {
      if (Object.is(readerProtectedOwners, nextValue)) return;
      readerProtectedOwners = nextValue;
      __readerController.invalidate();
    },
    get stopReaderOwner() {
      return stopReaderOwner;
    },
    get libraryTarget() {
      return libraryTarget;
    },
    set libraryTarget(nextValue: typeof libraryTarget) {
      if (Object.is(libraryTarget, nextValue)) return;
      libraryTarget = nextValue;
      __readerController.invalidate();
    },
    get libraryNavigationTask() {
      return libraryNavigationTask;
    },
    set libraryNavigationTask(nextValue: typeof libraryNavigationTask) {
      if (Object.is(libraryNavigationTask, nextValue)) return;
      libraryNavigationTask = nextValue;
      __readerController.invalidate();
    },
    get libraryNavigationEpoch() {
      return libraryNavigationEpoch;
    },
    set libraryNavigationEpoch(nextValue: typeof libraryNavigationEpoch) {
      if (Object.is(libraryNavigationEpoch, nextValue)) return;
      libraryNavigationEpoch = nextValue;
      __readerController.invalidate();
    },
    get librarySearchMessage() {
      return librarySearchMessage;
    },
    set librarySearchMessage(nextValue: typeof librarySearchMessage) {
      if (Object.is(librarySearchMessage, nextValue)) return;
      librarySearchMessage = nextValue;
      __readerController.invalidate();
    },
    get lineGuideEnabled() {
      return lineGuideEnabled;
    },
    set lineGuideEnabled(nextValue: typeof lineGuideEnabled) {
      if (Object.is(lineGuideEnabled, nextValue)) return;
      lineGuideEnabled = nextValue;
      __readerController.invalidate();
    },
    get lineGuideLines() {
      return lineGuideLines;
    },
    set lineGuideLines(nextValue: typeof lineGuideLines) {
      if (Object.is(lineGuideLines, nextValue)) return;
      lineGuideLines = nextValue;
      __readerController.invalidate();
    },
    get lineGuideDimming() {
      return lineGuideDimming;
    },
    set lineGuideDimming(nextValue: typeof lineGuideDimming) {
      if (Object.is(lineGuideDimming, nextValue)) return;
      lineGuideDimming = nextValue;
      __readerController.invalidate();
    },
    get guideContentEl() {
      return guideContentEl;
    },
    set guideContentEl(nextValue: typeof guideContentEl) {
      if (Object.is(guideContentEl, nextValue)) return;
      guideContentEl = nextValue;
      __readerController.invalidate();
    },
    get dictionarySetup() {
      return dictionarySetup;
    },
    set dictionarySetup(nextValue: typeof dictionarySetup) {
      if (Object.is(dictionarySetup, nextValue)) return;
      dictionarySetup = nextValue;
      __readerController.invalidate();
    },
    get isBookmarkScreen() {
      return isBookmarkScreen;
    },
    set isBookmarkScreen(nextValue: typeof isBookmarkScreen) {
      if (Object.is(isBookmarkScreen, nextValue)) return;
      isBookmarkScreen = nextValue;
      __readerController.invalidate();
    },
    get showFooter() {
      return showFooter;
    },
    set showFooter(nextValue: typeof showFooter) {
      if (Object.is(showFooter, nextValue)) return;
      showFooter = nextValue;
      __readerController.invalidate();
    },
    get exploredCharCount() {
      return exploredCharCount;
    },
    set exploredCharCount(nextValue: typeof exploredCharCount) {
      if (Object.is(exploredCharCount, nextValue)) return;
      exploredCharCount = nextValue;
      __readerController.invalidate();
    },
    get bookCharCount() {
      return bookCharCount;
    },
    set bookCharCount(nextValue: typeof bookCharCount) {
      if (Object.is(bookCharCount, nextValue)) return;
      bookCharCount = nextValue;
      __readerController.invalidate();
    },
    get autoScroller() {
      return autoScroller;
    },
    set autoScroller(nextValue: typeof autoScroller) {
      if (Object.is(autoScroller, nextValue)) return;
      autoScroller = nextValue;
      __readerController.invalidate();
    },
    get bookmarkManager() {
      return bookmarkManager;
    },
    set bookmarkManager(nextValue: typeof bookmarkManager) {
      if (Object.is(bookmarkManager, nextValue)) return;
      bookmarkManager = nextValue;
      __readerController.invalidate();
    },
    get pageManager() {
      return pageManager;
    },
    set pageManager(nextValue: typeof pageManager) {
      if (Object.is(pageManager, nextValue)) return;
      pageManager = nextValue;
      __readerController.invalidate();
    },
    get bookmarkData() {
      return bookmarkData;
    },
    set bookmarkData(nextValue: typeof bookmarkData) {
      if (Object.is(bookmarkData, nextValue)) return;
      bookmarkData = nextValue;
      __readerController.invalidate();
    },
    get customReadingPointTop() {
      return customReadingPointTop;
    },
    set customReadingPointTop(nextValue: typeof customReadingPointTop) {
      if (Object.is(customReadingPointTop, nextValue)) return;
      customReadingPointTop = nextValue;
      __readerController.invalidate();
    },
    get customReadingPointLeft() {
      return customReadingPointLeft;
    },
    set customReadingPointLeft(nextValue: typeof customReadingPointLeft) {
      if (Object.is(customReadingPointLeft, nextValue)) return;
      customReadingPointLeft = nextValue;
      __readerController.invalidate();
    },
    get customReadingPoint() {
      return customReadingPoint;
    },
    set customReadingPoint(nextValue: typeof customReadingPoint) {
      if (Object.is(customReadingPoint, nextValue)) return;
      customReadingPoint = nextValue;
      __readerController.invalidate();
    },
    get customReadingPointScrollOffset() {
      return customReadingPointScrollOffset;
    },
    set customReadingPointScrollOffset(nextValue: typeof customReadingPointScrollOffset) {
      if (Object.is(customReadingPointScrollOffset, nextValue)) return;
      customReadingPointScrollOffset = nextValue;
      __readerController.invalidate();
    },
    get customReadingPointRange() {
      return customReadingPointRange;
    },
    set customReadingPointRange(nextValue: typeof customReadingPointRange) {
      if (Object.is(customReadingPointRange, nextValue)) return;
      customReadingPointRange = nextValue;
      __readerController.invalidate();
    },
    get lastSelectedRange() {
      return lastSelectedRange;
    },
    set lastSelectedRange(nextValue: typeof lastSelectedRange) {
      if (Object.is(lastSelectedRange, nextValue)) return;
      lastSelectedRange = nextValue;
      __readerController.invalidate();
    },
    get lastSelectedRangeWasEmpty() {
      return lastSelectedRangeWasEmpty;
    },
    set lastSelectedRangeWasEmpty(nextValue: typeof lastSelectedRangeWasEmpty) {
      if (Object.is(lastSelectedRangeWasEmpty, nextValue)) return;
      lastSelectedRangeWasEmpty = nextValue;
      __readerController.invalidate();
    },
    get isSelectingCustomReadingPoint() {
      return isSelectingCustomReadingPoint;
    },
    set isSelectingCustomReadingPoint(nextValue: typeof isSelectingCustomReadingPoint) {
      if (Object.is(isSelectingCustomReadingPoint, nextValue)) return;
      isSelectingCustomReadingPoint = nextValue;
      __readerController.invalidate();
    },
    get showCustomReadingPoint() {
      return showCustomReadingPoint;
    },
    set showCustomReadingPoint(nextValue: typeof showCustomReadingPoint) {
      if (Object.is(showCustomReadingPoint, nextValue)) return;
      showCustomReadingPoint = nextValue;
      __readerController.invalidate();
    },
    get localStorageHandler() {
      return localStorageHandler;
    },
    set localStorageHandler(nextValue: typeof localStorageHandler) {
      if (Object.is(localStorageHandler, nextValue)) return;
      localStorageHandler = nextValue;
      __readerController.invalidate();
    },
    get dataToReplicate() {
      return dataToReplicate;
    },
    set dataToReplicate(nextValue: typeof dataToReplicate) {
      if (Object.is(dataToReplicate, nextValue)) return;
      dataToReplicate = nextValue;
      __readerController.invalidate();
    },
    get dataToReplicateQueue() {
      return dataToReplicateQueue;
    },
    set dataToReplicateQueue(nextValue: typeof dataToReplicateQueue) {
      if (Object.is(dataToReplicateQueue, nextValue)) return;
      dataToReplicateQueue = nextValue;
      __readerController.invalidate();
    },
    get externalStorageHandler() {
      return externalStorageHandler;
    },
    set externalStorageHandler(nextValue: typeof externalStorageHandler) {
      if (Object.is(externalStorageHandler, nextValue)) return;
      externalStorageHandler = nextValue;
      __readerController.invalidate();
    },
    get personalManagedBookId() {
      return personalManagedBookId;
    },
    set personalManagedBookId(nextValue: typeof personalManagedBookId) {
      if (Object.is(personalManagedBookId, nextValue)) return;
      personalManagedBookId = nextValue;
      __readerController.invalidate();
    },
    get personalReplicationTypes() {
      return personalReplicationTypes;
    },
    get externalStorageErrors() {
      return externalStorageErrors;
    },
    set externalStorageErrors(nextValue: typeof externalStorageErrors) {
      if (Object.is(externalStorageErrors, nextValue)) return;
      externalStorageErrors = nextValue;
      __readerController.invalidate();
    },
    get isReplicating() {
      return isReplicating;
    },
    set isReplicating(nextValue: typeof isReplicating) {
      if (Object.is(isReplicating, nextValue)) return;
      isReplicating = nextValue;
      __readerController.invalidate();
    },
    get storedExploredCharacter() {
      return storedExploredCharacter;
    },
    set storedExploredCharacter(nextValue: typeof storedExploredCharacter) {
      if (Object.is(storedExploredCharacter, nextValue)) return;
      storedExploredCharacter = nextValue;
      __readerController.invalidate();
    },
    get hasBookmarkData() {
      return hasBookmarkData;
    },
    set hasBookmarkData(nextValue: typeof hasBookmarkData) {
      if (Object.is(hasBookmarkData, nextValue)) return;
      hasBookmarkData = nextValue;
      __readerController.invalidate();
    },
    get blockDataUpdates() {
      return blockDataUpdates;
    },
    set blockDataUpdates(nextValue: typeof blockDataUpdates) {
      if (Object.is(blockDataUpdates, nextValue)) return;
      blockDataUpdates = nextValue;
      __readerController.invalidate();
    },
    get trackerElm() {
      return trackerElm;
    },
    set trackerElm(nextValue: typeof trackerElm) {
      if (Object.is(trackerElm, nextValue)) return;
      trackerElm = nextValue;
      __readerController.invalidate();
    },
    get showTrackerIcon() {
      return showTrackerIcon;
    },
    set showTrackerIcon(nextValue: typeof showTrackerIcon) {
      if (Object.is(showTrackerIcon, nextValue)) return;
      showTrackerIcon = nextValue;
      __readerController.invalidate();
    },
    get wasTrackerPaused() {
      return wasTrackerPaused;
    },
    set wasTrackerPaused(nextValue: typeof wasTrackerPaused) {
      if (Object.is(wasTrackerPaused, nextValue)) return;
      wasTrackerPaused = nextValue;
      __readerController.invalidate();
    },
    get frozenPosition() {
      return frozenPosition;
    },
    set frozenPosition(nextValue: typeof frozenPosition) {
      if (Object.is(frozenPosition, nextValue)) return;
      frozenPosition = nextValue;
      __readerController.invalidate();
    },
    get skipFirstFreezeChange() {
      return skipFirstFreezeChange;
    },
    set skipFirstFreezeChange(nextValue: typeof skipFirstFreezeChange) {
      if (Object.is(skipFirstFreezeChange, nextValue)) return;
      skipFirstFreezeChange = nextValue;
      __readerController.invalidate();
    },
    get bookCompleted() {
      return bookCompleted;
    },
    set bookCompleted(nextValue: typeof bookCompleted) {
      if (Object.is(bookCompleted, nextValue)) return;
      bookCompleted = nextValue;
      __readerController.invalidate();
    },
    get confettiWidthModifier() {
      return confettiWidthModifier;
    },
    set confettiWidthModifier(nextValue: typeof confettiWidthModifier) {
      if (Object.is(confettiWidthModifier, nextValue)) return;
      confettiWidthModifier = nextValue;
      __readerController.invalidate();
    },
    get confettiMaxRuns() {
      return confettiMaxRuns;
    },
    set confettiMaxRuns(nextValue: typeof confettiMaxRuns) {
      if (Object.is(confettiMaxRuns, nextValue)) return;
      confettiMaxRuns = nextValue;
      __readerController.invalidate();
    },
    get showReaderImageGallery() {
      return showReaderImageGallery;
    },
    set showReaderImageGallery(nextValue: typeof showReaderImageGallery) {
      if (Object.is(showReaderImageGallery, nextValue)) return;
      showReaderImageGallery = nextValue;
      __readerController.invalidate();
    },
    get dismissDialogs() {
      return dismissDialogs;
    },
    set dismissDialogs(nextValue: typeof dismissDialogs) {
      if (Object.is(dismissDialogs, nextValue)) return;
      dismissDialogs = nextValue;
      __readerController.invalidate();
    },
    get syncedResolver() {
      return syncedResolver;
    },
    set syncedResolver(nextValue: typeof syncedResolver) {
      if (Object.is(syncedResolver, nextValue)) return;
      syncedResolver = nextValue;
      __readerController.invalidate();
    },
    get syncedPromise() {
      return syncedPromise;
    },
    get queuedReaderImageGalleryPictures() {
      return queuedReaderImageGalleryPictures;
    },
    get fontFeatureSettings() {
      return fontFeatureSettings;
    },
    get verticalTextOrientation() {
      return verticalTextOrientation;
    },
    get bookId$() {
      return bookId$;
    },
    get readerLeaseLifetime() {
      return readerLeaseLifetime;
    },
    get readerLease() {
      return readerLease;
    },
    set readerLease(nextValue: typeof readerLease) {
      if (Object.is(readerLease, nextValue)) return;
      readerLease = nextValue;
      __readerController.invalidate();
    },
    get rawBookData$() {
      return rawBookData$;
    },
    get leaveIfBookMissing$() {
      return leaveIfBookMissing$;
    },
    get bookData$() {
      return bookData$;
    },
    get resize$() {
      return resize$;
    },
    get containerViewportWidth$() {
      return containerViewportWidth$;
    },
    get containerViewportHeight$() {
      return containerViewportHeight$;
    },
    get themeOption$() {
      return themeOption$;
    },
    get backgroundColor$() {
      return backgroundColor$;
    },
    get collectReaderImageGallerySpoilerToggles$() {
      return collectReaderImageGallerySpoilerToggles$;
    },
    get handleUpdateImageGalleryPictureSpoilers$() {
      return handleUpdateImageGalleryPictureSpoilers$;
    },
    get backgroundStyleName() {
      return backgroundStyleName;
    },
    get setBackgroundColor$() {
      return setBackgroundColor$;
    },
    get writingModeStyleName() {
      return writingModeStyleName;
    },
    get setWritingMode$() {
      return setWritingMode$;
    },
    get sectionData$() {
      return sectionData$;
    },
    get previewAdoption$() {
      return previewAdoption$;
    },
    get textSelector$() {
      return textSelector$;
    },
    get replicator$() {
      return replicator$;
    },
    get autoStartTracker$() {
      return autoStartTracker$;
    },
    get chromeMousePointer() {
      return chromeMousePointer;
    },
    set chromeMousePointer(nextValue: typeof chromeMousePointer) {
      if (Object.is(chromeMousePointer, nextValue)) return;
      chromeMousePointer = nextValue;
      __readerController.invalidate();
    },
    get isPaginated() {
      return isPaginated;
    },
    set isPaginated(nextValue: typeof isPaginated) {
      if (Object.is(isPaginated, nextValue)) return;
      isPaginated = nextValue;
      __readerController.invalidate();
    },
    get firstDimensionMargin() {
      return firstDimensionMargin;
    },
    set firstDimensionMargin(nextValue: typeof firstDimensionMargin) {
      if (Object.is(firstDimensionMargin, nextValue)) return;
      firstDimensionMargin = nextValue;
      __readerController.invalidate();
    },
    get tapButtonHeight() {
      return tapButtonHeight;
    },
    set tapButtonHeight(nextValue: typeof tapButtonHeight) {
      if (Object.is(tapButtonHeight, nextValue)) return;
      tapButtonHeight = nextValue;
      __readerController.invalidate();
    },
    get tapButtonTop() {
      return tapButtonTop;
    },
    set tapButtonTop(nextValue: typeof tapButtonTop) {
      if (Object.is(tapButtonTop, nextValue)) return;
      tapButtonTop = nextValue;
      __readerController.invalidate();
    },
    get footerChapterProgress() {
      return footerChapterProgress;
    },
    set footerChapterProgress(nextValue: typeof footerChapterProgress) {
      if (Object.is(footerChapterProgress, nextValue)) return;
      footerChapterProgress = nextValue;
      __readerController.invalidate();
    },
    get upSyncEnabled() {
      return upSyncEnabled;
    },
    set upSyncEnabled(nextValue: typeof upSyncEnabled) {
      if (Object.is(upSyncEnabled, nextValue)) return;
      upSyncEnabled = nextValue;
      __readerController.invalidate();
    },
    get $rawBookData$() {
      return $rawBookData$;
    },
    get $account() {
      return $account;
    },
    get $verticalMode$() {
      return $verticalMode$;
    },
    get $verticalCustomReadingPosition$() {
      return $verticalCustomReadingPosition$;
    },
    get $horizontalCustomReadingPosition$() {
      return $horizontalCustomReadingPosition$;
    },
    get $enableVerticalFontKerning$() {
      return $enableVerticalFontKerning$;
    },
    get $enableFontVPAL$() {
      return $enableFontVPAL$;
    },
    get $verticalTextOrientation$() {
      return $verticalTextOrientation$;
    },
    get $cacheStorageData$() {
      return $cacheStorageData$;
    },
    get $replicationSaveBehavior$() {
      return $replicationSaveBehavior$;
    },
    get $statisticsMergeMode$() {
      return $statisticsMergeMode$;
    },
    get $readingGoalsMergeMode$() {
      return $readingGoalsMergeMode$;
    },
    get $autoReplication$() {
      return $autoReplication$;
    },
    get $syncTarget$() {
      return $syncTarget$;
    },
    get $statisticsEnabled$() {
      return $statisticsEnabled$;
    },
    get $startDayHoursForTracker$() {
      return $startDayHoursForTracker$;
    },
    get $page() {
      return $page;
    },
    get $viewMode$() {
      return $viewMode$;
    },
    get $hideSpoilerImageMode$() {
      return $hideSpoilerImageMode$;
    },
    get $readerImageGalleryPictures$() {
      return $readerImageGalleryPictures$;
    },
    get $trackerAutostartTime$() {
      return $trackerAutostartTime$;
    },
    get $tocIsOpen$() {
      return $tocIsOpen$;
    },
    get $enableTapEdgeToFlip$() {
      return $enableTapEdgeToFlip$;
    },
    get $firstDimensionMargin$() {
      return $firstDimensionMargin$;
    },
    get $sectionData$() {
      return $sectionData$;
    },
    get $skipKeyDownListener$() {
      return $skipKeyDownListener$;
    },
    get $confirmClose$() {
      return $confirmClose$;
    },
    get $isTrackerPaused$() {
      return $isTrackerPaused$;
    },
    get $addCharactersOnCompletion$() {
      return $addCharactersOnCompletion$;
    },
    get $overwriteBookCompletion$() {
      return $overwriteBookCompletion$;
    },
    get $openTrackerOnCompletion$() {
      return $openTrackerOnCompletion$;
    },
    get $showFooterChapterCharacterCounter$() {
      return $showFooterChapterCharacterCounter$;
    },
    get $showFooterChapterPercentage$() {
      return $showFooterChapterPercentage$;
    },
    get $isOnline$() {
      return $isOnline$;
    },
    get $selectionToBookmarkEnabled$() {
      return $selectionToBookmarkEnabled$;
    },
    get $storageSource$() {
      return $storageSource$;
    },
    get $manualBookmark$() {
      return $manualBookmark$;
    },
    get $customReadingPointEnabled$() {
      return $customReadingPointEnabled$;
    },
    get $pauseTrackerOnCustomPointChange$() {
      return $pauseTrackerOnCustomPointChange$;
    },
    get $collectReaderImageGallerySpoilerToggles$() {
      return $collectReaderImageGallerySpoilerToggles$;
    },
    get $handleUpdateImageGalleryPictureSpoilers$() {
      return $handleUpdateImageGalleryPictureSpoilers$;
    },
    get $themeOption$() {
      return $themeOption$;
    },
    get $multiplier$() {
      return $multiplier$;
    },
    get $preFilteredTitlesForStatistics$() {
      return $preFilteredTitlesForStatistics$;
    },
    set $preFilteredTitlesForStatistics$(nextValue: typeof $preFilteredTitlesForStatistics$) {
      writeStore(preFilteredTitlesForStatistics$, nextValue);
    },
    get $bookData$() {
      return $bookData$;
    },
    get $containerViewportWidth$() {
      return $containerViewportWidth$;
    },
    get $containerViewportHeight$() {
      return $containerViewportHeight$;
    },
    get $prioritizeReaderStyles$() {
      return $prioritizeReaderStyles$;
    },
    get $enableTextJustification$() {
      return $enableTextJustification$;
    },
    get $enableTextWrapPretty$() {
      return $enableTextWrapPretty$;
    },
    get $backgroundColor$() {
      return $backgroundColor$;
    },
    get $fontFamilyGroupOne$() {
      return $fontFamilyGroupOne$;
    },
    get $yuKyokashoAvailable$() {
      return $yuKyokashoAvailable$;
    },
    get $fontFamilyGroupTwo$() {
      return $fontFamilyGroupTwo$;
    },
    get $fontWeight$() {
      return $fontWeight$;
    },
    get $fontSize$() {
      return $fontSize$;
    },
    get $lineHeight$() {
      return $lineHeight$;
    },
    get $textIndentation$() {
      return $textIndentation$;
    },
    get $textMarginMode$() {
      return $textMarginMode$;
    },
    get $textMarginValue$() {
      return $textMarginValue$;
    },
    get $hideSpoilerImage$() {
      return $hideSpoilerImage$;
    },
    get $hideFurigana$() {
      return $hideFurigana$;
    },
    get $furiganaStyle$() {
      return $furiganaStyle$;
    },
    get $secondDimensionMaxValue$() {
      return $secondDimensionMaxValue$;
    },
    get $autoPositionOnResize$() {
      return $autoPositionOnResize$;
    },
    get $avoidPageBreak$() {
      return $avoidPageBreak$;
    },
    get $pageColumns$() {
      return $pageColumns$;
    },
    get $autoBookmark$() {
      return $autoBookmark$;
    },
    get $autoBookmarkTime$() {
      return $autoBookmarkTime$;
    },
    get $setBackgroundColor$() {
      return $setBackgroundColor$;
    },
    get $setWritingMode$() {
      return $setWritingMode$;
    },
    get $textSelector$() {
      return $textSelector$;
    },
    get $previewAdoption$() {
      return $previewAdoption$;
    },
    get $replicator$() {
      return $replicator$;
    },
    get $autoStartTracker$() {
      return $autoStartTracker$;
    },
    get $leaveIfBookMissing$() {
      return $leaveIfBookMissing$;
    },
    get $isMobile$() {
      return $isMobile$;
    },
    get $showCharacterCounter$() {
      return $showCharacterCounter$;
    },
    get $showPercentage$() {
      return $showPercentage$;
    },
    updateProps(next: Record<string, unknown>) {}
  };
  return api;
}
