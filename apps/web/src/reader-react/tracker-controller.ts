/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  getDefaultStatistic,
  isTrackerPaused$,
  type TrackingHistory,
  isTrackerMenuOpen$,
  TrackerSkipThresholdAction,
  TrackerAutoPause
} from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import type { SectionWithProgress } from '$lib/components/book-reader/book-toc/book-toc';
import type { AutoScroller } from '$lib/components/book-reader/types';
import type {
  BooksDbReadingGoal,
  BooksDbStatistic
} from '$lib/data/database/books-db/versions/books-db';
import { PAGE_CHANGE } from '$lib/data/events';
import { logger } from '$lib/data/logger';
import { MergeMode } from '$lib/data/merge-mode';
import { getReadingGoalWindow, type ReadingGoal } from '$lib/data/reading-goal';
import {
  adjustStatisticsAfterIdleTime$,
  database,
  readingGoal$,
  startDayHoursForTracker$,
  trackerAutoPause$,
  trackerBackwardSkipThreshold$,
  trackerForwardSkipThreshold$,
  trackerIdleTime$,
  trackerPopupDetection$,
  trackerSkipThresholdAction$
} from '$lib/data/store';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
import {
  getDate,
  getDateKey,
  getDateTimeString,
  getPreviousDayKey,
  getSecondsToDate,
  toTimeString
} from '$lib/functions/statistic-util';
import { filterNotNullAndNotUndefined } from '$lib/functions/utils';
import {
  fromEvent,
  interval,
  merge,
  NEVER,
  Observable,
  startWith,
  switchMap,
  tap,
  throttleTime
} from 'rxjs';
import { ReaderController, readerTick, type StoreValue } from './controller';
export interface TrackerProps {
  bookTitle: string;
  bookId: number;
  wasTrackerPaused: boolean;
  exploredCharCount: number;
  bookCharCount: number;
  sectionData: SectionWithProgress[];
  frozenPosition: number;
  autoScroller: AutoScroller | undefined;
  blockDataUpdates: boolean;
}

export function createTracker(
  props: TrackerProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let hasReadingGoal: boolean;
  let $startDayHoursForTracker$: StoreValue<typeof startDayHoursForTracker$> =
    __readerController.read(startDayHoursForTracker$);
  let $isTrackerMenuOpen$: StoreValue<typeof isTrackerMenuOpen$> =
    __readerController.read(isTrackerMenuOpen$);
  let $trackerIdleTime$: StoreValue<typeof trackerIdleTime$> =
    __readerController.read(trackerIdleTime$);
  let $readingGoal$: StoreValue<typeof readingGoal$> = __readerController.read(readingGoal$);
  let $isTrackerPaused$: StoreValue<typeof isTrackerPaused$> =
    __readerController.read(isTrackerPaused$);
  let $trackerAutoPause$: StoreValue<typeof trackerAutoPause$> =
    __readerController.read(trackerAutoPause$);
  let $trackerPopupDetection$: StoreValue<typeof trackerPopupDetection$> =
    __readerController.read(trackerPopupDetection$);
  let $adjustStatisticsAfterIdleTime$: StoreValue<typeof adjustStatisticsAfterIdleTime$> =
    __readerController.read(adjustStatisticsAfterIdleTime$);
  let $trackerForwardSkipThreshold$: StoreValue<typeof trackerForwardSkipThreshold$> =
    __readerController.read(trackerForwardSkipThreshold$);
  let $trackerBackwardSkipThreshold$: StoreValue<typeof trackerBackwardSkipThreshold$> =
    __readerController.read(trackerBackwardSkipThreshold$);
  let $trackerSkipThresholdAction$: StoreValue<typeof trackerSkipThresholdAction$> =
    __readerController.read(trackerSkipThresholdAction$);
  let $readingTracker$: StoreValue<typeof readingTracker$> = undefined as never;
  let $updateTrackerIdleTime$: StoreValue<typeof updateTrackerIdleTime$> = undefined as never;
  let $autoScrollerTimer$: StoreValue<typeof autoScrollerTimer$> = undefined as never;
  let bookTitle: string = props.bookTitle;
  let bookId: number = props.bookId;
  let wasTrackerPaused: boolean = props.wasTrackerPaused;
  let exploredCharCount: number = props.exploredCharCount;
  let bookCharCount: number = props.bookCharCount;
  let sectionData: SectionWithProgress[] = props.sectionData;
  let frozenPosition: number = props.frozenPosition;
  let autoScroller: AutoScroller | undefined = props.autoScroller;
  let blockDataUpdates: boolean = props.blockDataUpdates;
  function processStatistics(
    characterDiff: number,
    timeDiff = 1,
    referenceTick = Date.now(),
    flushData = true
  ) {
    const todayDate = new Date();
    const absoluteTimeDiff = Math.abs(timeDiff);
    const isNegativeTimeDiff = timeDiff < 0;
    const referenceDate = new Date(referenceTick);
    const referenceDateKey = getDateKey($startDayHoursForTracker$, referenceDate);
    const lastStatisticModified = referenceDate.getTime();
    const secondsOnDay = getSecondsToDate($startDayHoursForTracker$, referenceDate) || 1;
    const overlappedDay = absoluteTimeDiff > secondsOnDay;
    const timeDiffForToday = overlappedDay ? secondsOnDay : absoluteTimeDiff;
    const dateTimeKey = getDateTimeString(lastStatisticModified);
    const trackerHistory: TrackingHistory[] = [
      {
        id: lastStatisticModified * Math.random(),
        dateKey: referenceDateKey,
        dateTimeKey,
        timeDiff: isNegativeTimeDiff ? -timeDiffForToday : timeDiffForToday,
        characterDiff,
        saved: false
      }
    ];
    __readerController.changed((todayKey = getDateKey($startDayHoursForTracker$, todayDate)));
    if (overlappedDay || referenceDateKey !== todayKey) {
      let otherDayTimeDiff = 0;
      if (overlappedDay) {
        otherDayTimeDiff = isNegativeTimeDiff
          ? -(absoluteTimeDiff - secondsOnDay)
          : absoluteTimeDiff - secondsOnDay;
      } else {
        otherDayTimeDiff = isNegativeTimeDiff ? -timeDiffForToday : timeDiffForToday;
      }
      const otherDayKey = overlappedDay
        ? getPreviousDayKey($startDayHoursForTracker$, referenceDate)
        : referenceDateKey;
      const otherDayStatistics =
        statistics.get(otherDayKey) || getDefaultStatistic(bookTitle, otherDayKey);
      updateStatistic(otherDayStatistics, otherDayTimeDiff, characterDiff, lastStatisticModified);
      statistics.set(otherDayKey, otherDayStatistics);
      statisticsToStore.add(otherDayKey);
      if (overlappedDay) {
        trackerHistory.unshift({
          id: lastStatisticModified * Math.random(),
          dateKey: otherDayStatistics.dateKey,
          dateTimeKey,
          timeDiff: otherDayTimeDiff,
          characterDiff,
          saved: false
        });
      }
    }
    __readerController.changed(
      (todaysStatistics =
        todaysStatistics.dateKey === todayKey
          ? todaysStatistics
          : statistics.get(todayKey) || getDefaultStatistic(bookTitle, todayKey))
    );
    if (todayKey === referenceDateKey) {
      updateStatistic(
        todaysStatistics,
        isNegativeTimeDiff ? -timeDiffForToday : timeDiffForToday,
        characterDiff,
        lastStatisticModified
      );
    } else {
      updateStatistic(todaysStatistics, 0, 0, lastStatisticModified);
    }
    statistics.set(todayKey, todaysStatistics);
    statisticsToStore.add(todayKey);
    updateStatistic(sessionStatistics, timeDiff, characterDiff, lastStatisticModified);
    updateStatistic(allTimeStatistics, timeDiff, characterDiff, lastStatisticModified);
    for (let index = 0, { length } = trackerHistory; index < length; index += 1) {
      if (historyIndex > 59) {
        __readerController.changed((historyIndex = 0));
      }
      if (trackingHistory.length < 60) {
        trackingHistory.unshift(trackerHistory[index]);
      } else {
        __readerController.changed((trackingHistory[historyIndex] = trackerHistory[index]));
        trackingHistory.sort((t1, t2) => (t2.dateTimeKey > t1.dateTimeKey ? 1 : -1));
        __readerController.changed((historyIndex += 1));
      }
    }
    updateTimeToFinishBook();
    return flushData ? flushUpdates() : Promise.resolve([false, 0]);
  }
  async function flushUpdates(force = false) {
    if (!statisticsToStore.size || (blockDataUpdates && !force)) {
      return [false, 0];
    }
    __readerController.changed((actionInProgress = true));
    __readerController.changed((hadError = false));
    const toUpdate: string[] = JSON.parse(JSON.stringify([...statisticsToStore]));
    const itemsToStore = toUpdate
      .map((statisticToStore) => statistics.get(statisticToStore))
      .filter(filterNotNullAndNotUndefined);
    statisticsToStore.clear();
    try {
      await database.storeStatistics(
        bookTitle,
        itemsToStore,
        ReplicationSaveBehavior.Overwrite,
        MergeMode.LOCAL,
        Date.now(),
        bookId
      );
      __readerController.changed(
        (trackingHistory = trackingHistory.map((item) => {
          const oldItem = item;
          oldItem.saved = toUpdate.some((dateKey) => dateKey === item.dateKey);
          return oldItem;
        }))
      );
      dispatch('statisticsSaved');
    } catch (error: any) {
      __readerController.changed((hadError = true));
      __readerController.changed(
        (statisticsToStore = new Set([...statisticsToStore, ...toUpdate]))
      );
      logger.error(`Error updating statistics: ${error.message}`);
    } finally {
      __readerController.changed((actionInProgress = false));
      __readerController.changed((lastTrackerFlushTime = Date.now()));
      if ($isTrackerMenuOpen$) {
        updateReadingGoalWindow();
      }
    }
    return [hadError, toUpdate.length];
  }
  function updateCompletedBook(
    completedBookStatistics: BooksDbStatistic,
    oldCompletedBookStatistics?: BooksDbStatistic
  ) {
    __readerController.changed((bookCompletionStatistics = completedBookStatistics.completedData));
    let statistic = statistics.get(completedBookStatistics.dateKey);
    if (statistic) {
      statistic = {
        ...statistic,
        ...{ completedBook: 1, completedData: bookCompletionStatistics }
      };
      statistics.set(completedBookStatistics.dateKey, statistic);
    } else {
      statistics.set(completedBookStatistics.dateKey, completedBookStatistics);
    }
    if (oldCompletedBookStatistics) {
      statistics.set(oldCompletedBookStatistics.dateKey, oldCompletedBookStatistics);
    }
  }
  let yomiPopover: HTMLElement | null;
  let jpdbPopover: HTMLElement | null;
  let actionInProgress = false;
  let hadError = false;
  let pausedByAutoPause = false;
  let visibilityState: DocumentVisibilityState;
  let currentReadingGoalStart = '';
  let currentReadingGoalEnd = '';
  let remainingTimeInReadingGoalWindow = '';
  let currentReadingGoal: ReadingGoal | undefined;
  let currentTimeGoal = 0;
  let currentCharacterGoal = 0;
  let statistics = new Map<string, BooksDbStatistic>();
  let todayKey = getDateKey($startDayHoursForTracker$);
  let sessionStatistics = getDefaultStatistic(bookTitle, todayKey);
  let todaysStatistics = getDefaultStatistic(bookTitle, todayKey);
  let allTimeStatistics = getDefaultStatistic(bookTitle, todayKey);
  let bookCompletionStatistics:
    | Omit<BooksDbStatistic, 'title' | 'lastStatisticModified'>
    | undefined;
  let bookStartDate = todayKey;
  let timeToFinishBook = 'N/A';
  let lastExploredCharCount = exploredCharCount;
  let previousLastExploredCharCount = 0;
  let trackingHistory: TrackingHistory[] = [];
  let historyIndex = 0;
  let autoScrollerStatistics: BooksDbStatistic | undefined;
  let autoScrollerTimer$: Observable<''> | undefined;
  let lastExploredCharCountScroller = exploredCharCount;
  let statisticsToStore = new Set<string>();
  let lastTrackerTick = 0;
  let lastTrackerFlushTime = 0;
  let trackerIdleTime = 0;
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  const yomiObserver = new MutationObserver(handleYomiMutation);
  const dictionaryObserver = new MutationObserver(handleMutation);
  const readingTracker$ = isTrackerPaused$.pipe(
    switchMap((isPaused) => {
      if (isPaused) {
        __readerController.changed((trackerIdleTime = 0));
        flushUpdates();
        return NEVER;
      }
      const now = Date.now();
      __readerController.changed((lastTrackerFlushTime = now));
      __readerController.changed((lastTrackerTick = now));
      return interval(1000);
    }),
    tap(processTicks),
    reduceToEmptyString()
  );
  const updateTrackerIdleTime$ = isTrackerPaused$.pipe(
    switchMap((isPaused) =>
      isPaused || $trackerIdleTime$ <= 0
        ? NEVER
        : merge(
            fromEvent(document, PAGE_CHANGE),
            fromEvent<PointerEvent>(window, 'pointermove'),
            fromEvent<Event>(document, 'selectionchange')
          ).pipe(
            startWith(true),
            throttleTime(1000),
            tap(() =>
              __readerController.changed((trackerIdleTime = Date.now() + $trackerIdleTime$ * 1000))
            )
          )
    ),
    reduceToEmptyString()
  );
  __readerController.effect(
    () => [$readingGoal$, todayKey],
    () => {
      __readerController.changed(
        (hasReadingGoal = !!(
          $readingGoal$.goalStartDate && todayKey >= $readingGoal$.goalStartDate
        ))
      );
    }
  );
  __readerController.effect(
    () => [visibilityState],
    () => {
      handleVisibilityChange(visibilityState);
    }
  );
  __readerController.effect(
    () => [$isTrackerMenuOpen$],
    () => {
      updateReadingGoalWindowForPausedState($isTrackerMenuOpen$);
    }
  );
  __readerController.effect(
    () => [$isTrackerPaused$],
    () => {
      if (!$isTrackerPaused$) {
        updateLastExploredCharCount();
      }
    }
  );
  __readerController.effect(
    () => [autoScroller, $startDayHoursForTracker$, bookTitle, exploredCharCount],
    () => {
      if (autoScroller && !autoScrollerTimer$) {
        __readerController.changed(
          (autoScrollerTimer$ = autoScroller.wasAutoScrollerEnabled$.pipe(
            tap((isEnabled) => {
              if (isEnabled) {
                __readerController.changed((todayKey = getDateKey($startDayHoursForTracker$)));
                __readerController.changed(
                  (autoScrollerStatistics = getDefaultStatistic(bookTitle, todayKey))
                );
                __readerController.changed((lastExploredCharCountScroller = exploredCharCount));
              } else {
                __readerController.changed((autoScrollerStatistics = undefined));
              }
            }),
            switchMap((isEnabled) => (isEnabled ? interval(1000) : NEVER)),
            tap(() => {
              if (!autoScrollerStatistics) {
                return;
              }
              const diff = exploredCharCount - lastExploredCharCountScroller;
              __readerController.changed((lastExploredCharCountScroller = exploredCharCount));
              __readerController.changed(
                (autoScrollerStatistics = {
                  ...updateStatistic(autoScrollerStatistics, 1, diff, Date.now())
                })
              );
            }),
            reduceToEmptyString()
          ))
        );
      }
    }
  );
  __readerController.effect(
    () => [$trackerAutoPause$, yomiObserver],
    () => {
      if ($trackerAutoPause$ !== TrackerAutoPause.OFF && !yomiPopover) {
        __readerController.changed(
          (yomiPopover = document.querySelector(
            '.yomichan-popup,.yomichan-float,.yomitan-popup,.yomitan-float'
          ))
        );
        if (!yomiPopover) {
          yomiObserver.observe(document.body, { childList: true, subtree: false });
        }
      } else {
        yomiObserver.disconnect();
      }
    }
  );
  __readerController.effect(
    () => [
      $trackerAutoPause$,
      $trackerPopupDetection$,
      yomiPopover,
      dictionaryObserver,
      jpdbPopover
    ],
    () => {
      if ($trackerAutoPause$ !== TrackerAutoPause.OFF && !$trackerPopupDetection$) {
        if (yomiPopover) {
          dictionaryObserver.observe(yomiPopover, { attributes: true });
        }
        if (jpdbPopover) {
          dictionaryObserver.observe(jpdbPopover, { attributes: true });
        }
      } else {
        dictionaryObserver.disconnect();
      }
    }
  );
  __readerController.onMount(init);
  __readerController.onDestroy(() => {
    yomiObserver.disconnect();
    dictionaryObserver.disconnect();
  });
  function handleYomiMutation() {
    __readerController.changed(
      (yomiPopover = document.querySelector(
        '.yomichan-popup,.yomichan-float,.yomitan-popup,.yomitan-float'
      ))
    );
    if (yomiPopover) {
      yomiObserver.disconnect();
    }
  }
  function handleMutation() {
    if (!jpdbPopover && !yomiPopover) {
      return;
    }
    const isDisplayed = isDictionaryDisplayed();
    if (isDisplayed && !$isTrackerPaused$) {
      __readerController.changed((pausedByAutoPause = true));
      isTrackerPaused$.next(true);
    } else if (!isDisplayed && $isTrackerPaused$ && !wasTrackerPaused && pausedByAutoPause) {
      __readerController.changed((pausedByAutoPause = false));
      isTrackerPaused$.next(false);
    }
  }
  function isDictionaryDisplayed() {
    return (
      (yomiPopover && yomiPopover.style.visibility !== 'hidden') ||
      (jpdbPopover && jpdbPopover.style.opacity !== '0')
    );
  }
  function handleBlur() {
    if (
      $isTrackerPaused$ ||
      $trackerAutoPause$ !== TrackerAutoPause.STRICT ||
      ($trackerPopupDetection$ && isDictionaryDisplayed())
    ) {
      return;
    }
    __readerController.changed((pausedByAutoPause = true));
    isTrackerPaused$.next(true);
  }
  function handleFocus() {
    if (
      !$isTrackerPaused$ ||
      !pausedByAutoPause ||
      wasTrackerPaused ||
      $trackerAutoPause$ !== TrackerAutoPause.STRICT ||
      (!$trackerPopupDetection$ && isDictionaryDisplayed())
    ) {
      return;
    }
    __readerController.changed((pausedByAutoPause = false));
    isTrackerPaused$.next(false);
  }
  function updateLastExploredCharCount() {
    const referenceCharCount = frozenPosition !== -1 ? frozenPosition : exploredCharCount;
    if (lastExploredCharCount !== referenceCharCount) {
      __readerController.changed((previousLastExploredCharCount = lastExploredCharCount));
      __readerController.changed((lastExploredCharCount = referenceCharCount));
    }
  }
  function revertTrackerHistory({ detail: historyItem }: CustomEvent<TrackingHistory>) {
    const entry = statistics.get(historyItem.dateKey);
    if (!entry) {
      __readerController.changed(
        (trackingHistory = trackingHistory.filter((item) => item.id !== historyItem.id))
      );
      return;
    }
    __readerController.changed((actionInProgress = true));
    const lastStatisticModified = Date.now();
    updateStatistic(
      entry,
      -historyItem.timeDiff,
      -historyItem.characterDiff,
      lastStatisticModified
    );
    updateStatistic(
      sessionStatistics,
      -historyItem.timeDiff,
      -historyItem.characterDiff,
      lastStatisticModified
    );
    updateStatistic(
      allTimeStatistics,
      -historyItem.timeDiff,
      -historyItem.characterDiff,
      lastStatisticModified
    );
    statistics.set(entry.dateKey, entry);
    statisticsToStore.add(entry.dateKey);
    __readerController.changed(
      (trackingHistory = trackingHistory.map((item) =>
        item.id === historyItem.id
          ? {
              id: historyItem.id,
              dateKey: historyItem.dateKey,
              dateTimeKey: getDateTimeString(lastStatisticModified),
              timeDiff: -historyItem.timeDiff,
              characterDiff: -historyItem.characterDiff,
              saved: false
            }
          : item
      ))
    );
    trackingHistory.sort((t1, t2) => (t2.dateTimeKey > t1.dateTimeKey ? 1 : -1));
    __readerController.changed((sessionStatistics = { ...sessionStatistics }));
    updateTimeToFinishBook();
    flushUpdates();
  }
  function handleVisibilityChange(state: DocumentVisibilityState) {
    if ($trackerAutoPause$ !== TrackerAutoPause.MODERATE) {
      return;
    }
    if (
      state === 'hidden' &&
      !$isTrackerPaused$ &&
      (!$trackerPopupDetection$ || !isDictionaryDisplayed())
    ) {
      __readerController.changed((pausedByAutoPause = true));
      isTrackerPaused$.next(true);
    } else if (
      state === 'visible' &&
      $isTrackerPaused$ &&
      pausedByAutoPause &&
      !wasTrackerPaused &&
      ($trackerPopupDetection$ || !isDictionaryDisplayed())
    ) {
      __readerController.changed((pausedByAutoPause = false));
      isTrackerPaused$.next(false);
    }
  }
  function updateReadingGoalWindowForPausedState(isTrackerMenuOpen: boolean) {
    if (isTrackerMenuOpen && wasTrackerPaused) {
      updateReadingGoalWindow();
    }
  }
  async function init() {
    try {
      __readerController.changed((todayKey = getDateKey($startDayHoursForTracker$)));
      __readerController.changed((jpdbPopover = document.getElementById('jpdb-popup')));
      const statisticsForTitle = await database.getStatisticsForBookId(bookId);
      const setFirstBookReadResult = await database.setFirstBookRead(
        bookTitle,
        $startDayHoursForTracker$,
        statisticsForTitle[0],
        bookId
      );
      __readerController.changed((bookStartDate = setFirstBookReadResult[0] as string));
      if (setFirstBookReadResult[1]) {
        dispatch('statisticsSaved');
      }
      for (let index = 0, { length } = statisticsForTitle; index < length; index += 1) {
        const statisticEntry = statisticsForTitle[index];
        statistics.set(statisticEntry.dateKey, statisticEntry);
        addToStatistic(allTimeStatistics, statisticEntry);
        if (todayKey === statisticEntry.dateKey) {
          addToStatistic(todaysStatistics, statisticEntry);
        }
        if (statisticEntry.completedBook && statisticEntry.completedData) {
          __readerController.changed((bookCompletionStatistics = statisticEntry.completedData));
        }
      }
      dispatch('trackerAvailable');
    } catch ({ message }: any) {
      logger.error(`Error initializing timer: ${message}`);
    }
  }
  async function updateReadingGoalWindow() {
    __readerController.changed((todayKey = getDateKey($startDayHoursForTracker$)));
    __readerController.changed(
      (todaysStatistics = statistics.get(todayKey) || getDefaultStatistic(bookTitle, todayKey))
    );
    try {
      await readerTick();
      let currentClosedReadingGoal: BooksDbReadingGoal | undefined;
      if (!hasReadingGoal) {
        currentClosedReadingGoal = await database.getCurrentClosedReadingGoal(todayKey);
        if (!currentClosedReadingGoal) {
          return;
        }
      }
      __readerController.changed((currentReadingGoal = currentClosedReadingGoal || $readingGoal$));
      [currentReadingGoalStart, currentReadingGoalEnd, remainingTimeInReadingGoalWindow] =
        getReadingGoalWindow(todayKey, $startDayHoursForTracker$, currentReadingGoal);
      if (
        currentClosedReadingGoal?.goalEndDate &&
        currentClosedReadingGoal.goalEndDate < currentReadingGoalEnd
      ) {
        __readerController.changed((currentReadingGoalEnd = currentClosedReadingGoal.goalEndDate));
        const adjustedEndDate = getDate(currentReadingGoalEnd, $startDayHoursForTracker$);
        __readerController.changed(
          (remainingTimeInReadingGoalWindow = toTimeString(
            (adjustedEndDate.getTime() + 8.64e7 - Date.now()) / 1000
          ))
        );
      }
      const statisticsForTimeWindow = await database.getStatisticsForTimeWindow(
        currentReadingGoalStart,
        currentReadingGoalEnd
      );
      __readerController.changed((currentTimeGoal = 0));
      __readerController.changed((currentCharacterGoal = 0));
      for (let index = 0, { length } = statisticsForTimeWindow; index < length; index += 1) {
        const statistic = statisticsForTimeWindow[index];
        __readerController.changed((currentTimeGoal += statistic.readingTime));
        __readerController.changed((currentCharacterGoal += statistic.charactersRead));
      }
    } catch ({ message }: any) {
      logger.error(`Error updating Goal Data: ${message}`);
    }
  }
  function processTicks() {
    const now = Date.now();
    const nowTick = trackerIdleTime ? Math.min(trackerIdleTime, now) : now;
    const trackerIdleTimeReached = trackerIdleTime && nowTick >= trackerIdleTime;
    const elapsed = Math.round((nowTick - lastTrackerTick) / 1000);
    __readerController.changed((lastTrackerTick = nowTick));
    if (trackerIdleTimeReached) {
      __readerController.changed((wasTrackerPaused = true));
      isTrackerPaused$.next(true);
      if (frozenPosition === -1) {
        if ($adjustStatisticsAfterIdleTime$) {
          processStatistics(0, elapsed - $trackerIdleTime$, lastTrackerTick, true);
        } else if (elapsed) {
          processStatistics(0, elapsed, lastTrackerTick, true);
        }
      }
      return;
    }
    if (frozenPosition === -1) {
      const characterDiff = exploredCharCount - lastExploredCharCount;
      let finalCharacterDiff =
        characterDiff < 0 && Math.abs(characterDiff) > sessionStatistics.charactersRead
          ? -sessionStatistics.charactersRead
          : characterDiff;
      if (
        (finalCharacterDiff > 0 &&
          $trackerForwardSkipThreshold$ &&
          finalCharacterDiff >= $trackerForwardSkipThreshold$) ||
        (finalCharacterDiff < 0 &&
          $trackerBackwardSkipThreshold$ &&
          finalCharacterDiff <= -Math.abs($trackerBackwardSkipThreshold$))
      ) {
        if ($trackerSkipThresholdAction$ === TrackerSkipThresholdAction.PAUSE) {
          __readerController.changed((wasTrackerPaused = true));
          isTrackerPaused$.next(true);
          return;
        }
        finalCharacterDiff = 0;
      }
      __readerController.changed((previousLastExploredCharCount = lastExploredCharCount));
      __readerController.changed((lastExploredCharCount = exploredCharCount));
      processStatistics(
        finalCharacterDiff,
        elapsed,
        lastTrackerTick,
        now - lastTrackerFlushTime > 10000
      );
    }
  }
  function addToStatistic(statisticObject: BooksDbStatistic, entry: BooksDbStatistic) {
    const statistic = statisticObject;
    statistic.title = entry.title;
    statistic.readingTime += entry.readingTime;
    statistic.charactersRead += entry.charactersRead;
    statistic.lastReadingSpeed = statistic.readingTime
      ? Math.ceil((3600 * statistic.charactersRead) / statistic.readingTime)
      : 0;
    statistic.minReadingSpeed = statistic.minReadingSpeed
      ? Math.min(statistic.minReadingSpeed, statistic.lastReadingSpeed)
      : statistic.lastReadingSpeed;
    statistic.altMinReadingSpeed = statistic.altMinReadingSpeed
      ? Math.min(statistic.altMinReadingSpeed, statistic.lastReadingSpeed)
      : statistic.lastReadingSpeed;
    statistic.maxReadingSpeed = Math.max(statistic.maxReadingSpeed, statistic.lastReadingSpeed);
    statistic.lastStatisticModified = Math.max(
      statistic.lastStatisticModified,
      entry.lastStatisticModified
    );
  }
  function updateStatistic(
    statisticObject: BooksDbStatistic,
    timeDiff: number,
    characterDiff: number,
    lastStatisticModified: number
  ) {
    const statistic = statisticObject;
    statistic.readingTime = Math.max(0, statistic.readingTime + timeDiff);
    statistic.charactersRead = Math.max(0, statistic.charactersRead + characterDiff);
    statistic.lastReadingSpeed = statistic.readingTime
      ? Math.ceil((3600 * statistic.charactersRead) / statistic.readingTime)
      : 0;
    statistic.minReadingSpeed = statistic.minReadingSpeed
      ? Math.min(statistic.minReadingSpeed, statistic.lastReadingSpeed)
      : statistic.lastReadingSpeed;
    statistic.maxReadingSpeed = Math.max(statistic.maxReadingSpeed, statistic.lastReadingSpeed);
    statistic.lastStatisticModified = lastStatisticModified;
    if (characterDiff) {
      statistic.altMinReadingSpeed = statistic.altMinReadingSpeed
        ? Math.min(statistic.altMinReadingSpeed, statistic.lastReadingSpeed)
        : statistic.lastReadingSpeed;
    }
    return statistic;
  }
  function updateTimeToFinishBook() {
    __readerController.changed(
      (timeToFinishBook = sessionStatistics.lastReadingSpeed
        ? toTimeString(
            Math.max(
              0,
              Math.floor(
                (bookCharCount - exploredCharCount) / (sessionStatistics.lastReadingSpeed / 3600)
              )
            )
          )
        : 'N/A')
    );
  }
  __readerController.observeSource(
    () => startDayHoursForTracker$,
    (value) => {
      $startDayHoursForTracker$ = value;
    }
  );
  __readerController.observeSource(
    () => isTrackerMenuOpen$,
    (value) => {
      $isTrackerMenuOpen$ = value;
    }
  );
  __readerController.observeSource(
    () => trackerIdleTime$,
    (value) => {
      $trackerIdleTime$ = value;
    }
  );
  __readerController.observeSource(
    () => readingGoal$,
    (value) => {
      $readingGoal$ = value;
    }
  );
  __readerController.observeSource(
    () => isTrackerPaused$,
    (value) => {
      $isTrackerPaused$ = value;
    }
  );
  __readerController.observeSource(
    () => trackerAutoPause$,
    (value) => {
      $trackerAutoPause$ = value;
    }
  );
  __readerController.observeSource(
    () => trackerPopupDetection$,
    (value) => {
      $trackerPopupDetection$ = value;
    }
  );
  __readerController.observeSource(
    () => adjustStatisticsAfterIdleTime$,
    (value) => {
      $adjustStatisticsAfterIdleTime$ = value;
    }
  );
  __readerController.observeSource(
    () => trackerForwardSkipThreshold$,
    (value) => {
      $trackerForwardSkipThreshold$ = value;
    }
  );
  __readerController.observeSource(
    () => trackerBackwardSkipThreshold$,
    (value) => {
      $trackerBackwardSkipThreshold$ = value;
    }
  );
  __readerController.observeSource(
    () => trackerSkipThresholdAction$,
    (value) => {
      $trackerSkipThresholdAction$ = value;
    }
  );
  __readerController.observeSource(
    () => readingTracker$,
    (value) => {
      $readingTracker$ = value;
    }
  );
  __readerController.observeSource(
    () => updateTrackerIdleTime$,
    (value) => {
      $updateTrackerIdleTime$ = value;
    }
  );
  __readerController.observeSource(
    () => autoScrollerTimer$,
    (value) => {
      $autoScrollerTimer$ = value;
    }
  );
  const api = {
    controller: __readerController,
    processStatistics,
    flushUpdates,
    updateCompletedBook,
    handleYomiMutation,
    handleMutation,
    isDictionaryDisplayed,
    handleBlur,
    handleFocus,
    updateLastExploredCharCount,
    revertTrackerHistory,
    handleVisibilityChange,
    updateReadingGoalWindowForPausedState,
    init,
    updateReadingGoalWindow,
    processTicks,
    addToStatistic,
    updateStatistic,
    updateTimeToFinishBook,
    get bookTitle() {
      return bookTitle;
    },
    set bookTitle(nextValue: typeof bookTitle) {
      if (Object.is(bookTitle, nextValue)) return;
      bookTitle = nextValue;
      __readerController.invalidate();
    },
    get bookId() {
      return bookId;
    },
    set bookId(nextValue: typeof bookId) {
      if (Object.is(bookId, nextValue)) return;
      bookId = nextValue;
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
    get sectionData() {
      return sectionData;
    },
    set sectionData(nextValue: typeof sectionData) {
      if (Object.is(sectionData, nextValue)) return;
      sectionData = nextValue;
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
    get autoScroller() {
      return autoScroller;
    },
    set autoScroller(nextValue: typeof autoScroller) {
      if (Object.is(autoScroller, nextValue)) return;
      autoScroller = nextValue;
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
    get yomiPopover() {
      return yomiPopover;
    },
    set yomiPopover(nextValue: typeof yomiPopover) {
      if (Object.is(yomiPopover, nextValue)) return;
      yomiPopover = nextValue;
      __readerController.invalidate();
    },
    get jpdbPopover() {
      return jpdbPopover;
    },
    set jpdbPopover(nextValue: typeof jpdbPopover) {
      if (Object.is(jpdbPopover, nextValue)) return;
      jpdbPopover = nextValue;
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
    get pausedByAutoPause() {
      return pausedByAutoPause;
    },
    set pausedByAutoPause(nextValue: typeof pausedByAutoPause) {
      if (Object.is(pausedByAutoPause, nextValue)) return;
      pausedByAutoPause = nextValue;
      __readerController.invalidate();
    },
    get visibilityState() {
      return visibilityState;
    },
    set visibilityState(nextValue: typeof visibilityState) {
      if (Object.is(visibilityState, nextValue)) return;
      visibilityState = nextValue;
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
    get statistics() {
      return statistics;
    },
    set statistics(nextValue: typeof statistics) {
      if (Object.is(statistics, nextValue)) return;
      statistics = nextValue;
      __readerController.invalidate();
    },
    get todayKey() {
      return todayKey;
    },
    set todayKey(nextValue: typeof todayKey) {
      if (Object.is(todayKey, nextValue)) return;
      todayKey = nextValue;
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
    get bookStartDate() {
      return bookStartDate;
    },
    set bookStartDate(nextValue: typeof bookStartDate) {
      if (Object.is(bookStartDate, nextValue)) return;
      bookStartDate = nextValue;
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
    get trackingHistory() {
      return trackingHistory;
    },
    set trackingHistory(nextValue: typeof trackingHistory) {
      if (Object.is(trackingHistory, nextValue)) return;
      trackingHistory = nextValue;
      __readerController.invalidate();
    },
    get historyIndex() {
      return historyIndex;
    },
    set historyIndex(nextValue: typeof historyIndex) {
      if (Object.is(historyIndex, nextValue)) return;
      historyIndex = nextValue;
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
    get autoScrollerTimer$() {
      return autoScrollerTimer$;
    },
    set autoScrollerTimer$(nextValue: typeof autoScrollerTimer$) {
      if (Object.is(autoScrollerTimer$, nextValue)) return;
      autoScrollerTimer$ = nextValue;
      __readerController.invalidate();
    },
    get lastExploredCharCountScroller() {
      return lastExploredCharCountScroller;
    },
    set lastExploredCharCountScroller(nextValue: typeof lastExploredCharCountScroller) {
      if (Object.is(lastExploredCharCountScroller, nextValue)) return;
      lastExploredCharCountScroller = nextValue;
      __readerController.invalidate();
    },
    get statisticsToStore() {
      return statisticsToStore;
    },
    set statisticsToStore(nextValue: typeof statisticsToStore) {
      if (Object.is(statisticsToStore, nextValue)) return;
      statisticsToStore = nextValue;
      __readerController.invalidate();
    },
    get lastTrackerTick() {
      return lastTrackerTick;
    },
    set lastTrackerTick(nextValue: typeof lastTrackerTick) {
      if (Object.is(lastTrackerTick, nextValue)) return;
      lastTrackerTick = nextValue;
      __readerController.invalidate();
    },
    get lastTrackerFlushTime() {
      return lastTrackerFlushTime;
    },
    set lastTrackerFlushTime(nextValue: typeof lastTrackerFlushTime) {
      if (Object.is(lastTrackerFlushTime, nextValue)) return;
      lastTrackerFlushTime = nextValue;
      __readerController.invalidate();
    },
    get trackerIdleTime() {
      return trackerIdleTime;
    },
    set trackerIdleTime(nextValue: typeof trackerIdleTime) {
      if (Object.is(trackerIdleTime, nextValue)) return;
      trackerIdleTime = nextValue;
      __readerController.invalidate();
    },
    get dispatch() {
      return dispatch;
    },
    get yomiObserver() {
      return yomiObserver;
    },
    get dictionaryObserver() {
      return dictionaryObserver;
    },
    get readingTracker$() {
      return readingTracker$;
    },
    get updateTrackerIdleTime$() {
      return updateTrackerIdleTime$;
    },
    get hasReadingGoal() {
      return hasReadingGoal;
    },
    set hasReadingGoal(nextValue: typeof hasReadingGoal) {
      if (Object.is(hasReadingGoal, nextValue)) return;
      hasReadingGoal = nextValue;
      __readerController.invalidate();
    },
    get $startDayHoursForTracker$() {
      return $startDayHoursForTracker$;
    },
    get $isTrackerMenuOpen$() {
      return $isTrackerMenuOpen$;
    },
    get $trackerIdleTime$() {
      return $trackerIdleTime$;
    },
    get $readingGoal$() {
      return $readingGoal$;
    },
    get $isTrackerPaused$() {
      return $isTrackerPaused$;
    },
    get $trackerAutoPause$() {
      return $trackerAutoPause$;
    },
    get $trackerPopupDetection$() {
      return $trackerPopupDetection$;
    },
    get $adjustStatisticsAfterIdleTime$() {
      return $adjustStatisticsAfterIdleTime$;
    },
    get $trackerForwardSkipThreshold$() {
      return $trackerForwardSkipThreshold$;
    },
    get $trackerBackwardSkipThreshold$() {
      return $trackerBackwardSkipThreshold$;
    },
    get $trackerSkipThresholdAction$() {
      return $trackerSkipThresholdAction$;
    },
    get $readingTracker$() {
      return $readingTracker$;
    },
    get $updateTrackerIdleTime$() {
      return $updateTrackerIdleTime$;
    },
    get $autoScrollerTimer$() {
      return $autoScrollerTimer$;
    },
    updateProps(next: Record<string, unknown>) {
      if ('bookTitle' in next) api.bookTitle = next.bookTitle as typeof bookTitle;
      if ('bookId' in next) api.bookId = next.bookId as typeof bookId;
      if ('wasTrackerPaused' in next)
        api.wasTrackerPaused = next.wasTrackerPaused as typeof wasTrackerPaused;
      if ('exploredCharCount' in next)
        api.exploredCharCount = next.exploredCharCount as typeof exploredCharCount;
      if ('bookCharCount' in next) api.bookCharCount = next.bookCharCount as typeof bookCharCount;
      if ('sectionData' in next) api.sectionData = next.sectionData as typeof sectionData;
      if ('frozenPosition' in next)
        api.frozenPosition = next.frozenPosition as typeof frozenPosition;
      if ('autoScroller' in next) api.autoScroller = next.autoScroller as typeof autoScroller;
      if ('blockDataUpdates' in next)
        api.blockDataUpdates = next.blockDataUpdates as typeof blockDataUpdates;
    }
  };
  return api;
}
