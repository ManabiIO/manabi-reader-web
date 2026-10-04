/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { TrackingHistory } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import {
  getChapterData,
  type SectionWithProgress
} from '$lib/components/book-reader/book-toc/book-toc';
import { chapterCharacters } from '$lib/components/book-reader/book-toc/chapter-model';
import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import type { ReadingGoal } from '$lib/data/reading-goal';
import { lastBlurredTrackerItems$, skipKeyDownListener$ } from '$lib/data/store';
import { toTimeString } from '$lib/functions/statistic-util';
import { ReaderController, readerTick, writeStore, type StoreValue } from './controller';
const faClockRotateLeft = 'faClockRotateLeft';
const faFloppyDisk = 'faFloppyDisk';
const faPlay = 'faPlay';
const faRepeat = 'faRepeat';
export interface TrackerMenuProps {
  fontColor: string;
  backgroundColor: string;
  actionInProgress: boolean;
  hadError: boolean;
  currentReadingGoal: ReadingGoal | undefined;
  currentTimeGoal: number;
  currentCharacterGoal: number;
  currentReadingGoalStart: string;
  currentReadingGoalEnd: string;
  remainingTimeInReadingGoalWindow: string;
  wasTrackerPaused: boolean;
  canSaveStatistics: boolean;
  timeToFinishBook: string;
  sectionData: SectionWithProgress[];
  exploredCharCount: number;
  lastExploredCharCount: number;
  previousLastExploredCharCount: number;
  frozenPosition: number;
  trackingHistory: TrackingHistory[];
  sessionStatistics: BooksDbStatistic;
  todaysStatistics: BooksDbStatistic;
  allTimeStatistics: BooksDbStatistic;
  bookCompletionStatistics: Omit<BooksDbStatistic, 'title' | 'lastStatisticModified'> | undefined;
  autoScrollerStatistics: BooksDbStatistic | undefined;
  bookStartDate: string;
}

export function createTrackerMenu(
  props: TrackerMenuProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let allStatistics: Array<
    Omit<BooksDbStatistic, 'title' | 'lastStatisticModified'> & { id: string }
  >;
  let historyPageCount: number;
  let currentTrackingHistoryIndex: number;
  let trackingHistoryItems: TrackingHistory[];
  let hasNextPage: boolean;
  let $skipKeyDownListener$: StoreValue<typeof skipKeyDownListener$> =
    __readerController.read(skipKeyDownListener$);
  let $lastBlurredTrackerItems$: StoreValue<typeof lastBlurredTrackerItems$> =
    __readerController.read(lastBlurredTrackerItems$);
  let fontColor: string = props.fontColor;
  let backgroundColor: string = props.backgroundColor;
  let actionInProgress: boolean = props.actionInProgress;
  let hadError: boolean = props.hadError;
  let currentReadingGoal: ReadingGoal | undefined = props.currentReadingGoal;
  let currentTimeGoal: number = props.currentTimeGoal;
  let currentCharacterGoal: number = props.currentCharacterGoal;
  let currentReadingGoalStart: string = props.currentReadingGoalStart;
  let currentReadingGoalEnd: string = props.currentReadingGoalEnd;
  let remainingTimeInReadingGoalWindow: string = props.remainingTimeInReadingGoalWindow;
  let wasTrackerPaused: boolean = props.wasTrackerPaused;
  let canSaveStatistics: boolean = props.canSaveStatistics;
  let timeToFinishBook: string = props.timeToFinishBook;
  let sectionData: SectionWithProgress[] = props.sectionData;
  let exploredCharCount: number = props.exploredCharCount;
  let lastExploredCharCount: number = props.lastExploredCharCount;
  let previousLastExploredCharCount: number = props.previousLastExploredCharCount;
  let frozenPosition: number = props.frozenPosition;
  let trackingHistory: TrackingHistory[] = props.trackingHistory;
  let sessionStatistics: BooksDbStatistic = props.sessionStatistics;
  let todaysStatistics: BooksDbStatistic = props.todaysStatistics;
  let allTimeStatistics: BooksDbStatistic = props.allTimeStatistics;
  let bookCompletionStatistics:
    | Omit<BooksDbStatistic, 'title' | 'lastStatisticModified'>
    | undefined = props.bookCompletionStatistics;
  let autoScrollerStatistics: BooksDbStatistic | undefined = props.autoScrollerStatistics;
  let bookStartDate: string = props.bookStartDate;
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  const actions = [
    { icon: faPlay, event: 'resumeAfterClose', title: 'Resume tracking after closing' },
    { icon: faRepeat, event: 'updateCurrentLocation', title: 'Update position' },
    {
      icon: faClockRotateLeft,
      event: 'freezeCurrentLocation',
      title: 'Keep reading position fixed'
    },
    { icon: faFloppyDisk, event: 'saveStatistics', title: 'Save statistics' }
  ] as const;
  const trackingItemsPerPage = 15;
  let trackingHistoryIndex = 0;
  let previousHistoryPage: HTMLButtonElement | null = null;
  let nextHistoryPage: HTMLButtonElement | null = null;
  let timeToFinishChapter = 'N/A';
  __readerController.effect(
    () => [
      autoScrollerStatistics,
      sessionStatistics,
      todaysStatistics,
      allTimeStatistics,
      bookCompletionStatistics
    ],
    () => {
      __readerController.changed(
        (allStatistics = autoScrollerStatistics
          ? [
              { id: 'Current Session', ...sessionStatistics },
              { id: 'Today', ...todaysStatistics },
              { id: 'All Time', ...allTimeStatistics },
              ...(bookCompletionStatistics
                ? [{ id: 'Book Completion', ...bookCompletionStatistics }]
                : []),
              { id: 'Autoscroller', ...autoScrollerStatistics }
            ]
          : [
              { id: 'Current Session', ...sessionStatistics },
              { id: 'Today', ...todaysStatistics },
              { id: 'All Time', ...allTimeStatistics },
              ...(bookCompletionStatistics
                ? [{ id: 'Book Completion', ...bookCompletionStatistics }]
                : [])
            ])
      );
    }
  );
  __readerController.effect(
    () => [trackingHistory, trackingItemsPerPage],
    () => {
      __readerController.changed(
        (historyPageCount = Math.max(1, Math.ceil(trackingHistory.length / trackingItemsPerPage)))
      );
    }
  );
  __readerController.effect(
    () => [historyPageCount],
    () => {
      if (trackingHistoryIndex >= historyPageCount)
        __readerController.changed((trackingHistoryIndex = historyPageCount - 1));
    }
  );
  __readerController.effect(
    () => [trackingHistoryIndex, trackingItemsPerPage],
    () => {
      __readerController.changed(
        (currentTrackingHistoryIndex = Math.max(0, trackingHistoryIndex * trackingItemsPerPage))
      );
    }
  );
  __readerController.effect(
    () => [trackingHistory, currentTrackingHistoryIndex, trackingItemsPerPage],
    () => {
      __readerController.changed(
        (trackingHistoryItems = trackingHistory.slice(
          currentTrackingHistoryIndex,
          currentTrackingHistoryIndex + trackingItemsPerPage
        ))
      );
    }
  );
  __readerController.effect(
    () => [trackingHistory, currentTrackingHistoryIndex, trackingItemsPerPage],
    () => {
      __readerController.changed(
        (hasNextPage = trackingHistory.length > currentTrackingHistoryIndex + trackingItemsPerPage)
      );
    }
  );
  __readerController.onMount(() => {
    writeStore(skipKeyDownListener$, true);
    if (sectionData) {
      const [mainChapters, chapterIndex] = getChapterData(sectionData);
      const currentChapter = mainChapters[chapterIndex];
      const characters = chapterCharacters(currentChapter, exploredCharCount);
      const speed = sessionStatistics.lastReadingSpeed;
      if (characters && Number.isFinite(speed) && speed > 0) {
        const seconds = Math.floor((characters.total - characters.read) / (speed / 3600));
        if (Number.isFinite(seconds))
          __readerController.changed((timeToFinishChapter = toTimeString(seconds)));
      }
    }
    return () => {
      writeStore(skipKeyDownListener$, false);
    };
  });
  function executeAction(event: string) {
    switch (event) {
      case 'resumeAfterClose':
        __readerController.changed((wasTrackerPaused = !wasTrackerPaused));
        break;
      case 'updateCurrentLocation':
      case 'freezeCurrentLocation':
      case 'saveStatistics':
        dispatch(event);
        break;
      default:
        break;
    }
  }
  async function pageHistory(delta: -1 | 1) {
    __readerController.changed(
      (trackingHistoryIndex = Math.min(
        historyPageCount - 1,
        Math.max(0, trackingHistoryIndex + delta)
      ))
    );
    await readerTick();
    // Keep keyboard ownership on an enabled pager when the activated control
    // becomes disabled at a boundary. On intermediate pages the same button
    // remains focused so repeated paging is still one-key operation.
    if (delta > 0 && nextHistoryPage?.disabled) {
      previousHistoryPage?.focus();
    } else if (delta < 0 && previousHistoryPage?.disabled) {
      nextHistoryPage?.focus();
    }
  }
  function handleBlurredKey(dataKey: string) {
    if (window.getSelection()?.toString().trim()) {
      return;
    }
    if ($lastBlurredTrackerItems$.has(dataKey)) {
      $lastBlurredTrackerItems$.delete(dataKey);
    } else {
      $lastBlurredTrackerItems$.add(dataKey);
    }
    writeStore(lastBlurredTrackerItems$, new Set([...$lastBlurredTrackerItems$]));
  }
  function privacyMetricLabel(dataKey: string, label: string, value: string | number) {
    return $lastBlurredTrackerItems$.has(dataKey)
      ? `${label}: value hidden. Activate to show.`
      : `${label}: ${value}. Activate to hide.`;
  }
  __readerController.observeSource(
    () => skipKeyDownListener$,
    (value) => {
      $skipKeyDownListener$ = value;
    }
  );
  __readerController.observeSource(
    () => lastBlurredTrackerItems$,
    (value) => {
      $lastBlurredTrackerItems$ = value;
    }
  );
  const api = {
    controller: __readerController,
    executeAction,
    pageHistory,
    handleBlurredKey,
    privacyMetricLabel,
    get fontColor() {
      return fontColor;
    },
    set fontColor(nextValue: typeof fontColor) {
      if (Object.is(fontColor, nextValue)) return;
      fontColor = nextValue;
      __readerController.invalidate();
    },
    get backgroundColor() {
      return backgroundColor;
    },
    set backgroundColor(nextValue: typeof backgroundColor) {
      if (Object.is(backgroundColor, nextValue)) return;
      backgroundColor = nextValue;
      __readerController.invalidate();
    },
    get actionInProgress() {
      return actionInProgress;
    },
    set actionInProgress(nextValue: typeof actionInProgress) {
      if (Object.is(actionInProgress, nextValue)) return;
      actionInProgress = nextValue;
      __readerController.invalidate();
    },
    get hadError() {
      return hadError;
    },
    set hadError(nextValue: typeof hadError) {
      if (Object.is(hadError, nextValue)) return;
      hadError = nextValue;
      __readerController.invalidate();
    },
    get currentReadingGoal() {
      return currentReadingGoal;
    },
    set currentReadingGoal(nextValue: typeof currentReadingGoal) {
      if (Object.is(currentReadingGoal, nextValue)) return;
      currentReadingGoal = nextValue;
      __readerController.invalidate();
    },
    get currentTimeGoal() {
      return currentTimeGoal;
    },
    set currentTimeGoal(nextValue: typeof currentTimeGoal) {
      if (Object.is(currentTimeGoal, nextValue)) return;
      currentTimeGoal = nextValue;
      __readerController.invalidate();
    },
    get currentCharacterGoal() {
      return currentCharacterGoal;
    },
    set currentCharacterGoal(nextValue: typeof currentCharacterGoal) {
      if (Object.is(currentCharacterGoal, nextValue)) return;
      currentCharacterGoal = nextValue;
      __readerController.invalidate();
    },
    get currentReadingGoalStart() {
      return currentReadingGoalStart;
    },
    set currentReadingGoalStart(nextValue: typeof currentReadingGoalStart) {
      if (Object.is(currentReadingGoalStart, nextValue)) return;
      currentReadingGoalStart = nextValue;
      __readerController.invalidate();
    },
    get currentReadingGoalEnd() {
      return currentReadingGoalEnd;
    },
    set currentReadingGoalEnd(nextValue: typeof currentReadingGoalEnd) {
      if (Object.is(currentReadingGoalEnd, nextValue)) return;
      currentReadingGoalEnd = nextValue;
      __readerController.invalidate();
    },
    get remainingTimeInReadingGoalWindow() {
      return remainingTimeInReadingGoalWindow;
    },
    set remainingTimeInReadingGoalWindow(nextValue: typeof remainingTimeInReadingGoalWindow) {
      if (Object.is(remainingTimeInReadingGoalWindow, nextValue)) return;
      remainingTimeInReadingGoalWindow = nextValue;
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
    get canSaveStatistics() {
      return canSaveStatistics;
    },
    set canSaveStatistics(nextValue: typeof canSaveStatistics) {
      if (Object.is(canSaveStatistics, nextValue)) return;
      canSaveStatistics = nextValue;
      __readerController.invalidate();
    },
    get timeToFinishBook() {
      return timeToFinishBook;
    },
    set timeToFinishBook(nextValue: typeof timeToFinishBook) {
      if (Object.is(timeToFinishBook, nextValue)) return;
      timeToFinishBook = nextValue;
      __readerController.invalidate();
    },
    get sectionData() {
      return sectionData;
    },
    set sectionData(nextValue: typeof sectionData) {
      if (Object.is(sectionData, nextValue)) return;
      sectionData = nextValue;
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
    get lastExploredCharCount() {
      return lastExploredCharCount;
    },
    set lastExploredCharCount(nextValue: typeof lastExploredCharCount) {
      if (Object.is(lastExploredCharCount, nextValue)) return;
      lastExploredCharCount = nextValue;
      __readerController.invalidate();
    },
    get previousLastExploredCharCount() {
      return previousLastExploredCharCount;
    },
    set previousLastExploredCharCount(nextValue: typeof previousLastExploredCharCount) {
      if (Object.is(previousLastExploredCharCount, nextValue)) return;
      previousLastExploredCharCount = nextValue;
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
    get trackingHistory() {
      return trackingHistory;
    },
    set trackingHistory(nextValue: typeof trackingHistory) {
      if (Object.is(trackingHistory, nextValue)) return;
      trackingHistory = nextValue;
      __readerController.invalidate();
    },
    get sessionStatistics() {
      return sessionStatistics;
    },
    set sessionStatistics(nextValue: typeof sessionStatistics) {
      if (Object.is(sessionStatistics, nextValue)) return;
      sessionStatistics = nextValue;
      __readerController.invalidate();
    },
    get todaysStatistics() {
      return todaysStatistics;
    },
    set todaysStatistics(nextValue: typeof todaysStatistics) {
      if (Object.is(todaysStatistics, nextValue)) return;
      todaysStatistics = nextValue;
      __readerController.invalidate();
    },
    get allTimeStatistics() {
      return allTimeStatistics;
    },
    set allTimeStatistics(nextValue: typeof allTimeStatistics) {
      if (Object.is(allTimeStatistics, nextValue)) return;
      allTimeStatistics = nextValue;
      __readerController.invalidate();
    },
    get bookCompletionStatistics() {
      return bookCompletionStatistics;
    },
    set bookCompletionStatistics(nextValue: typeof bookCompletionStatistics) {
      if (Object.is(bookCompletionStatistics, nextValue)) return;
      bookCompletionStatistics = nextValue;
      __readerController.invalidate();
    },
    get autoScrollerStatistics() {
      return autoScrollerStatistics;
    },
    set autoScrollerStatistics(nextValue: typeof autoScrollerStatistics) {
      if (Object.is(autoScrollerStatistics, nextValue)) return;
      autoScrollerStatistics = nextValue;
      __readerController.invalidate();
    },
    get bookStartDate() {
      return bookStartDate;
    },
    set bookStartDate(nextValue: typeof bookStartDate) {
      if (Object.is(bookStartDate, nextValue)) return;
      bookStartDate = nextValue;
      __readerController.invalidate();
    },
    get dispatch() {
      return dispatch;
    },
    get actions() {
      return actions;
    },
    get trackingItemsPerPage() {
      return trackingItemsPerPage;
    },
    get trackingHistoryIndex() {
      return trackingHistoryIndex;
    },
    set trackingHistoryIndex(nextValue: typeof trackingHistoryIndex) {
      if (Object.is(trackingHistoryIndex, nextValue)) return;
      trackingHistoryIndex = nextValue;
      __readerController.invalidate();
    },
    get previousHistoryPage() {
      return previousHistoryPage;
    },
    set previousHistoryPage(nextValue: typeof previousHistoryPage) {
      if (Object.is(previousHistoryPage, nextValue)) return;
      previousHistoryPage = nextValue;
      __readerController.invalidate();
    },
    get nextHistoryPage() {
      return nextHistoryPage;
    },
    set nextHistoryPage(nextValue: typeof nextHistoryPage) {
      if (Object.is(nextHistoryPage, nextValue)) return;
      nextHistoryPage = nextValue;
      __readerController.invalidate();
    },
    get timeToFinishChapter() {
      return timeToFinishChapter;
    },
    set timeToFinishChapter(nextValue: typeof timeToFinishChapter) {
      if (Object.is(timeToFinishChapter, nextValue)) return;
      timeToFinishChapter = nextValue;
      __readerController.invalidate();
    },
    get allStatistics() {
      return allStatistics;
    },
    set allStatistics(nextValue: typeof allStatistics) {
      if (Object.is(allStatistics, nextValue)) return;
      allStatistics = nextValue;
      __readerController.invalidate();
    },
    get historyPageCount() {
      return historyPageCount;
    },
    set historyPageCount(nextValue: typeof historyPageCount) {
      if (Object.is(historyPageCount, nextValue)) return;
      historyPageCount = nextValue;
      __readerController.invalidate();
    },
    get currentTrackingHistoryIndex() {
      return currentTrackingHistoryIndex;
    },
    set currentTrackingHistoryIndex(nextValue: typeof currentTrackingHistoryIndex) {
      if (Object.is(currentTrackingHistoryIndex, nextValue)) return;
      currentTrackingHistoryIndex = nextValue;
      __readerController.invalidate();
    },
    get trackingHistoryItems() {
      return trackingHistoryItems;
    },
    set trackingHistoryItems(nextValue: typeof trackingHistoryItems) {
      if (Object.is(trackingHistoryItems, nextValue)) return;
      trackingHistoryItems = nextValue;
      __readerController.invalidate();
    },
    get hasNextPage() {
      return hasNextPage;
    },
    set hasNextPage(nextValue: typeof hasNextPage) {
      if (Object.is(hasNextPage, nextValue)) return;
      hasNextPage = nextValue;
      __readerController.invalidate();
    },
    get $skipKeyDownListener$() {
      return $skipKeyDownListener$;
    },
    get $lastBlurredTrackerItems$() {
      return $lastBlurredTrackerItems$;
    },
    updateProps(next: Record<string, unknown>) {
      if ('fontColor' in next) api.fontColor = next.fontColor as typeof fontColor;
      if ('backgroundColor' in next)
        api.backgroundColor = next.backgroundColor as typeof backgroundColor;
      if ('actionInProgress' in next)
        api.actionInProgress = next.actionInProgress as typeof actionInProgress;
      if ('hadError' in next) api.hadError = next.hadError as typeof hadError;
      if ('currentReadingGoal' in next)
        api.currentReadingGoal = next.currentReadingGoal as typeof currentReadingGoal;
      if ('currentTimeGoal' in next)
        api.currentTimeGoal = next.currentTimeGoal as typeof currentTimeGoal;
      if ('currentCharacterGoal' in next)
        api.currentCharacterGoal = next.currentCharacterGoal as typeof currentCharacterGoal;
      if ('currentReadingGoalStart' in next)
        api.currentReadingGoalStart =
          next.currentReadingGoalStart as typeof currentReadingGoalStart;
      if ('currentReadingGoalEnd' in next)
        api.currentReadingGoalEnd = next.currentReadingGoalEnd as typeof currentReadingGoalEnd;
      if ('remainingTimeInReadingGoalWindow' in next)
        api.remainingTimeInReadingGoalWindow =
          next.remainingTimeInReadingGoalWindow as typeof remainingTimeInReadingGoalWindow;
      if ('wasTrackerPaused' in next)
        api.wasTrackerPaused = next.wasTrackerPaused as typeof wasTrackerPaused;
      if ('canSaveStatistics' in next)
        api.canSaveStatistics = next.canSaveStatistics as typeof canSaveStatistics;
      if ('timeToFinishBook' in next)
        api.timeToFinishBook = next.timeToFinishBook as typeof timeToFinishBook;
      if ('sectionData' in next) api.sectionData = next.sectionData as typeof sectionData;
      if ('exploredCharCount' in next)
        api.exploredCharCount = next.exploredCharCount as typeof exploredCharCount;
      if ('lastExploredCharCount' in next)
        api.lastExploredCharCount = next.lastExploredCharCount as typeof lastExploredCharCount;
      if ('previousLastExploredCharCount' in next)
        api.previousLastExploredCharCount =
          next.previousLastExploredCharCount as typeof previousLastExploredCharCount;
      if ('frozenPosition' in next)
        api.frozenPosition = next.frozenPosition as typeof frozenPosition;
      if ('trackingHistory' in next)
        api.trackingHistory = next.trackingHistory as typeof trackingHistory;
      if ('sessionStatistics' in next)
        api.sessionStatistics = next.sessionStatistics as typeof sessionStatistics;
      if ('todaysStatistics' in next)
        api.todaysStatistics = next.todaysStatistics as typeof todaysStatistics;
      if ('allTimeStatistics' in next)
        api.allTimeStatistics = next.allTimeStatistics as typeof allTimeStatistics;
      if ('bookCompletionStatistics' in next)
        api.bookCompletionStatistics =
          next.bookCompletionStatistics as typeof bookCompletionStatistics;
      if ('autoScrollerStatistics' in next)
        api.autoScrollerStatistics = next.autoScrollerStatistics as typeof autoScrollerStatistics;
      if ('bookStartDate' in next) api.bookStartDate = next.bookStartDate as typeof bookStartDate;
    }
  };
  return api;
}
