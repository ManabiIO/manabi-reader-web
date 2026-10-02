/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { ReadingGoalFrequency } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import { observeElementWidth } from '$lib/hooks/observe-element-width';
import {
  heatmapCellSize,
  heatmapMonthLabels,
  heatmapNavigationDate
} from '../lib/components/statistics/statistics-heatmap/heatmap-navigation';
import {
  type HeatmapMonthLabel,
  type HeatmapStreak,
  type StatisticsHeatmapData,
  monthLabelList,
  heatmapGridGapValue,
  heatmapDayElementSize,
  HeatmapStreakType,
  HeatmapDataAggregration,
  type HeatmapGlobalDayData,
  type ReadingGoalsHeatmapData,
  type HeatmapColorRange,
  HeatmapType,
  type ReadingGoalHeatmapGlobalDayData,
  daysOfWeekShort,
  heatmapMinValueColor,
  heatmapMaxValueColor,
  type StatisticsHeatmapDayData
} from '$lib/components/statistics/statistics-heatmap/statistics-heatmap';
import type {
  BooksDbReadingGoal,
  BooksDbStatistic
} from '$lib/data/database/books-db/versions/books-db';
import { getDateRangeLabel } from '$lib/data/reading-goal';
import {
  lastStartDayOfWeek$,
  lastStatisticsEndDate$,
  lastStatisticsStartDate$
} from '$lib/data/store';
import {
  advanceDateDays,
  getDate,
  getDateString,
  getDaysBetween,
  getPreviousDayKey,
  secondsToMinutes
} from '$lib/functions/statistic-util';
import { caluclatePercentage, limitToRange, pluralize } from '$lib/functions/utils';
import {
  ReaderController,
  readerTick,
  writeStore,
  type StoreValue
} from '../reader-react/controller';

export interface StatisticsHeatmapProps {
  heatmapType?: HeatmapType;
  heatmapAggregration: HeatmapDataAggregration;
  statisticsData: BooksDbStatistic[];
  readingGoals: BooksDbReadingGoal[];
  statisticsTitleFilters: Map<string, boolean>;
  today: Date;
  todayKey: string;
}

export function createStatisticsHeatmap(
  props: StatisticsHeatmapProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let activeDay: any;
  let heatmapLabel: any;
  let dayLabels: string[];
  let $lastStartDayOfWeek$: StoreValue<typeof lastStartDayOfWeek$> =
    __readerController.read(lastStartDayOfWeek$);
  let $lastStatisticsStartDate$: StoreValue<typeof lastStatisticsStartDate$> =
    __readerController.read(lastStatisticsStartDate$);
  let $lastStatisticsEndDate$: StoreValue<typeof lastStatisticsEndDate$> =
    __readerController.read(lastStatisticsEndDate$);
  let heatmapType: HeatmapType =
    props.heatmapType !== undefined ? props.heatmapType : HeatmapType.STATISTICS;
  let heatmapAggregration: HeatmapDataAggregration = props.heatmapAggregration;
  let statisticsData: BooksDbStatistic[] = props.statisticsData;
  let readingGoals: BooksDbReadingGoal[] = props.readingGoals;
  let statisticsTitleFilters: any = props.statisticsTitleFilters;
  let today: any = props.today;
  let todayKey: string = props.todayKey;
  const colorRanges: HeatmapColorRange[] = [];
  let heatmapElement: HTMLElement | null = null;
  let heatmapDetailDataPopover: any;
  let monthLabels: HeatmapMonthLabel[] = [...monthLabelList];
  let dayElementSize = heatmapDayElementSize;
  let heatmapYear = today.getFullYear();
  let globalHeatmapData: StatisticsHeatmapData | ReadingGoalsHeatmapData;
  const globalHeatmapDayData = new Map<
    string,
    HeatmapGlobalDayData | ReadingGoalHeatmapGlobalDayData
  >();
  const heatmapDataByYear = new Map<number, StatisticsHeatmapData | ReadingGoalsHeatmapData>();
  let currentHeatmapData: StatisticsHeatmapData | ReadingGoalsHeatmapData;
  let currentHeatmapDays: StatisticsHeatmapDayData[] = [];
  let popoverDetails: string[] = [];
  let detailsOpen = false;
  let activeDate = todayKey;
  let popupGeneration = 0;
  let alive = true;
  __readerController.effect(
    () => [currentHeatmapDays, activeDate],
    () => {
      __readerController.changed(
        (activeDay =
          currentHeatmapDays.find((day) => day.isCurrentYear && day.dateString === activeDate) ??
          currentHeatmapDays.find((day) => day.isCurrentYear))
      );
    }
  );
  let selectedStreak = HeatmapStreakType.NONE;
  let selectedStreakDates = new Set<string>();
  __readerController.effect(
    () => [heatmapType, heatmapYear],
    () => {
      __readerController.changed(
        (heatmapLabel = `Reading ${heatmapType === HeatmapType.STATISTICS ? '' : 'Goals '}Data for ${heatmapYear}`)
      );
    }
  );
  __readerController.effect(
    () => [$lastStartDayOfWeek$],
    () => {
      __readerController.changed(
        (dayLabels = [
          ...daysOfWeekShort.slice($lastStartDayOfWeek$),
          ...($lastStartDayOfWeek$ ? daysOfWeekShort.slice(0, $lastStartDayOfWeek$) : [])
        ])
      );
    }
  );
  __readerController.effect(
    () => [$lastStartDayOfWeek$, heatmapAggregration, heatmapYear],
    () => {
      if ($lastStartDayOfWeek$ >= 0 && heatmapAggregration && heatmapYear) {
        closeHeatmapDetails(false);
        updateHeatmapData();
      }
    }
  );
  __readerController.effect(
    () => [statisticsTitleFilters, statisticsData, readingGoals, todayKey, heatmapType],
    () => {
      if (statisticsTitleFilters && statisticsData && readingGoals && todayKey && heatmapType) {
        __readerController.changed((selectedStreak = HeatmapStreakType.NONE));
        __readerController.changed((selectedStreakDates = new Set<string>()));
        updateHeatmapDataAfterFilterChange();
      }
    }
  );
  __readerController.effect(
    () => [heatmapAggregration],
    () => {
      if (heatmapAggregration) {
        __readerController.changed((selectedStreak = HeatmapStreakType.NONE));
        __readerController.changed((selectedStreakDates = new Set<string>()));
      }
    }
  );
  __readerController.onMount(() => {
    if (!heatmapElement) return undefined;
    return observeElementWidth(heatmapElement, (width) => {
      __readerController.changed(
        (dayElementSize = heatmapCellSize(width, heatmapDayElementSize, heatmapGridGapValue, 57))
      );
    });
  });
  __readerController.onDestroy(() => {
    __readerController.changed((alive = false));
    __readerController.changed((popupGeneration += 1));
  });
  function checkIsStatisticsHeatmapData(
    heatmapData: StatisticsHeatmapData | ReadingGoalsHeatmapData
  ): heatmapData is StatisticsHeatmapData {
    return 'daysRead' in heatmapData;
  }
  function changeHeatmapYear(modifier: number) {
    if (!modifier) {
      return;
    }
    if (heatmapAggregration === HeatmapDataAggregration.YEAR) {
      __readerController.changed((selectedStreak = HeatmapStreakType.NONE));
      __readerController.changed((selectedStreakDates = new Set<string>()));
    }
    closeHeatmapDetails(false);
    __readerController.changed((heatmapYear += modifier));
    readerTick().then(() => {
      if (alive && heatmapElement?.isConnected)
        heatmapElement.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
  }
  function closeHeatmapDetails(restoreFocus = true) {
    __readerController.changed((popupGeneration += 1));
    heatmapDetailDataPopover?.close(restoreFocus);
  }
  function openHeatmapDay(target: HTMLElement, heatmapDay: StatisticsHeatmapDayData) {
    if (!heatmapDay.isCurrentYear) return;
    const generation = __readerController.changed(++popupGeneration);
    __readerController.changed((activeDate = heatmapDay.dateString));
    __readerController.changed((popoverDetails = [...heatmapDay.dayDetails]));
    void readerTick().then(() => {
      if (alive && generation === popupGeneration && target.isConnected)
        heatmapDetailDataPopover.openAt(target);
    });
  }
  function handleHeatmapDayKeydown(event: KeyboardEvent, day: StatisticsHeatmapDayData) {
    if (!heatmapElement || event.altKey || event.metaKey || event.shiftKey) return;
    // Native buttons own Enter/Space activation. Ignore held activation keys.
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      return;
    }
    const nextDate = heatmapNavigationDate(
      currentHeatmapDays,
      day.dateString,
      event.key,
      getComputedStyle(heatmapElement).direction === 'rtl',
      event.ctrlKey
    );
    if (!nextDate) return;
    event.preventDefault();
    event.stopPropagation();
    __readerController.changed((activeDate = nextDate));
    const next = heatmapElement.querySelector<HTMLButtonElement>(`button[data-date="${nextDate}"]`);
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  async function highlightStreaks(streaks: HeatmapStreak[], streakToSelect: HeatmapStreakType) {
    if (!streaks.length) {
      return;
    }
    let heatmapStreak;
    let heatmapYearModifier = 0;
    if (heatmapAggregration === HeatmapDataAggregration.ALL_TIME) {
      const firstDayOfYearDateString = getDateString(new Date(heatmapYear, 0, 1, 0, 0, 0, 0));
      const lastDayOfYearDateString = getDateString(new Date(heatmapYear, 11, 31, 0, 0, 0, 0));
      heatmapStreak =
        streaks.find(
          (streak) =>
            (streak.startDate >= firstDayOfYearDateString &&
              streak.startDate <= lastDayOfYearDateString) ||
            (firstDayOfYearDateString >= streak.startDate &&
              firstDayOfYearDateString <= streak.endDate)
        ) || streaks[0];
    }
    if (heatmapStreak) {
      const streakYear = getDate(heatmapStreak.startDate).getFullYear();
      heatmapYearModifier = streakYear - heatmapYear;
    }
    if (heatmapYearModifier) {
      changeHeatmapYear(heatmapYearModifier);
      await readerTick();
      await new Promise((resolve) => {
        setTimeout(resolve);
      });
    }
    if (heatmapYearModifier && selectedStreak === streakToSelect) {
      return;
    }
    __readerController.changed(
      (selectedStreak = selectedStreak === streakToSelect ? HeatmapStreakType.NONE : streakToSelect)
    );
    __readerController.changed((selectedStreakDates = new Set<string>()));
    if (selectedStreak !== HeatmapStreakType.NONE) {
      for (let index = 0, { length } = streaks; index < length; index += 1) {
        const streak = streaks[index];
        const streakDate = getDate(streak.startDate);
        let streakDateString = streak.startDate;
        while (streakDateString <= streak.endDate) {
          selectedStreakDates.add(streakDateString);
          ({ dateString: streakDateString } = advanceDateDays(streakDate));
        }
      }
      scrollToDay(heatmapStreak?.startDate || streaks[0].startDate);
    }
  }
  function scrollToDay(referenceDateString: string) {
    if (!heatmapElement || !referenceDateString) {
      return;
    }
    const dayElement = heatmapElement.querySelector(
      `[data-date="${referenceDateString}"]`
    ) as HTMLElement | null;
    if (dayElement) {
      const day = dayElement.getBoundingClientRect();
      const grid = heatmapElement.getBoundingClientRect();
      const middle =
        heatmapElement.scrollLeft + day.left - grid.left + day.width / 2 - grid.width / 2;
      heatmapElement.scrollTo(middle, 0);
    }
  }
  function updateHeatmapDataAfterFilterChange() {
    closeHeatmapDetails(false);
    globalHeatmapDayData.clear();
    heatmapDataByYear.clear();
    __readerController.changed((colorRanges.length = 0));
    if (heatmapType === HeatmapType.READING_GOALS) {
      colorRanges.push(
        { limit: 100, color: `#${heatmapMaxValueColor}` },
        ...getColorRanges(1, 100, 100)
      );
    }
    updateHeatmapData();
  }
  function updateHeatmapData() {
    if (heatmapType === HeatmapType.STATISTICS) {
      updateHeatmapDataForStatistics();
    } else {
      updateHeatmapDataForReadingGoals();
    }
  }
  function updateHeatmapDataForStatistics() {
    const daysRead = new Set<string>();
    let maxReadingTime = 0;
    let minReadingTime = 0;
    let firstReadingDay;
    let lastReadingDay;
    if (!globalHeatmapDayData.size) {
      const streaks: HeatmapStreak[] = [];
      let currentReadingStreakDate = new Date();
      let currentReadingStreakDateString = '';
      let currentReadingStreak: HeatmapStreak = { startDate: '', endDate: '', duration: 0 };
      for (let index = 0, { length } = statisticsData; index < length; index += 1) {
        const entry = statisticsData[index];
        if (statisticsTitleFilters.get(entry.title)) {
          const { dateKey } = entry;
          const entryData = globalHeatmapDayData.get(dateKey) || getDefaultHeatmapGlobalDayData();
          entryData.readingTime += entry.readingTime;
          entryData.charactersRead += entry.charactersRead;
          if (entry.readingTime) {
            const entryDate = getDate(dateKey);
            if (!firstReadingDay) {
              firstReadingDay = entryDate;
            }
            lastReadingDay = entryDate;
            if (currentReadingStreakDateString === dateKey) {
              currentReadingStreak.duration += 1;
              ({ dateString: currentReadingStreakDateString } =
                advanceDateDays(currentReadingStreakDate));
            } else if (currentReadingStreak.startDate && !daysRead.has(dateKey)) {
              currentReadingStreak.endDate = getPreviousDayKey(0, currentReadingStreakDate, true);
              currentReadingStreak.duration += 1;
              streaks.push(currentReadingStreak);
              currentReadingStreak = { startDate: '', endDate: '', duration: 0 };
            }
            if (!currentReadingStreak.startDate) {
              currentReadingStreak.startDate = dateKey;
              ({
                referenceDate: currentReadingStreakDate,
                dateString: currentReadingStreakDateString
              } = advanceDateDays(getDate(dateKey)));
            }
            entryData.titles.add(entry.title);
            maxReadingTime = Math.max(maxReadingTime, entryData.readingTime);
            minReadingTime = minReadingTime
              ? Math.min(minReadingTime, entryData.readingTime)
              : entryData.readingTime;
            daysRead.add(dateKey);
          }
          globalHeatmapDayData.set(dateKey, entryData);
        }
      }
      if (currentReadingStreak.startDate) {
        const { dateString: streakEnd } = advanceDateDays(
          getDate(currentReadingStreak.startDate),
          currentReadingStreak.duration
        );
        currentReadingStreak.duration += 1;
        currentReadingStreak.endDate = streakEnd;
        streaks.push(currentReadingStreak);
      }
      streaks.sort(sortStreaks);
      __readerController.changed(
        (globalHeatmapData = {
          streaks,
          daysRead: getDaysReadLabel(getDaysBetween(firstReadingDay, lastReadingDay), daysRead),
          colorRanges: getColorRanges(minReadingTime, maxReadingTime),
          longestStreaks: getLongestStreaks(streaks),
          currentStreak: getCurrentStreak(streaks, todayKey)
        })
      );
    }
    if (heatmapAggregration === HeatmapDataAggregration.ALL_TIME) {
      __readerController.changed((currentHeatmapData = globalHeatmapData));
    } else if (heatmapDataByYear.has(heatmapYear)) {
      __readerController.changed((currentHeatmapData = heatmapDataByYear.get(heatmapYear)!));
    } else {
      const firstDayOfYearDateString = getDateString(new Date(heatmapYear, 0, 1, 0, 0, 0, 0));
      const lastDayOfYearDateString = getDateString(new Date(heatmapYear, 11, 31, 0, 0, 0, 0));
      const dayKeys = [...globalHeatmapDayData.keys()];
      const streaksInYear: HeatmapStreak[] = JSON.parse(
        JSON.stringify(
          globalHeatmapData.streaks.filter(
            (streak) =>
              (streak.startDate >= firstDayOfYearDateString &&
                streak.startDate <= lastDayOfYearDateString) ||
              (firstDayOfYearDateString >= streak.startDate &&
                firstDayOfYearDateString <= streak.endDate)
          )
        )
      ).map((streak: HeatmapStreak) => {
        const streakObject = streak;
        const adjustStartDate = streakObject.startDate < firstDayOfYearDateString;
        const adjustEndDate = streakObject.endDate > lastDayOfYearDateString;
        streakObject.startDate = adjustStartDate
          ? firstDayOfYearDateString
          : streakObject.startDate;
        streakObject.endDate = adjustEndDate ? lastDayOfYearDateString : streakObject.endDate;
        if (adjustStartDate || adjustEndDate) {
          streakObject.duration = getDaysBetween(
            getDate(streakObject.startDate),
            getDate(streakObject.endDate)
          );
        }
        return { ...streakObject };
      });
      streaksInYear.sort(sortStreaks);
      firstReadingDay = undefined;
      lastReadingDay = undefined;
      minReadingTime = 0;
      maxReadingTime = 0;
      daysRead.clear();
      for (let index = 0, { length } = dayKeys; index < length; index += 1) {
        const dayKey = dayKeys[index];
        if (dayKey > lastDayOfYearDateString) {
          break;
        }
        if (dayKey >= firstDayOfYearDateString) {
          const dayData = globalHeatmapDayData.get(dayKey)!;
          if (dayData.readingTime) {
            const entryDate = getDate(dayKey);
            if (!firstReadingDay) {
              firstReadingDay = entryDate;
            }
            daysRead.add(dayKey);
            lastReadingDay = entryDate;
            maxReadingTime = Math.max(maxReadingTime, dayData.readingTime);
            minReadingTime = minReadingTime
              ? Math.min(minReadingTime, dayData.readingTime)
              : dayData.readingTime;
          }
        }
      }
      const heatmapDataForYear: StatisticsHeatmapData = {
        streaks: streaksInYear,
        daysRead: getDaysReadLabel(getDaysBetween(firstReadingDay, lastReadingDay), daysRead),
        colorRanges: getColorRanges(minReadingTime, maxReadingTime),
        longestStreaks: getLongestStreaks(streaksInYear),
        currentStreak: getCurrentStreak(streaksInYear, todayKey)
      };
      heatmapDataByYear.set(heatmapYear, heatmapDataForYear);
      __readerController.changed((currentHeatmapData = heatmapDataForYear));
    }
    updateHeatmapDayData(undefined);
  }
  function updateHeatmapDataForReadingGoals() {
    const globalDataObject = globalHeatmapDayData as any;
    let completedReadingGoalsCount = 0;
    let closedReadingGoalsCount = 0;
    if (!globalDataObject.size) {
      const groupsedStatisticsData = new Map<string, HeatmapGlobalDayData>();
      const streaks: HeatmapStreak[] = [];
      let lastDayString = todayKey;
      let currentReadingGoalsStreak: HeatmapStreak = {
        startDate: '',
        endDate: '',
        duration: 0
      };
      for (let index = 0, { length } = statisticsData; index < length; index += 1) {
        const entry = statisticsData[index];
        if (statisticsTitleFilters.get(entry.title)) {
          const entryData =
            groupsedStatisticsData.get(entry.dateKey) || getDefaultHeatmapGlobalDayData();
          entryData.readingTime += entry.readingTime;
          entryData.charactersRead += entry.charactersRead;
          if (entryData.readingTime) {
            entryData.titles.add(entry.title);
          }
          groupsedStatisticsData.set(entry.dateKey, entryData);
          if (entry.dateKey > lastDayString) {
            lastDayString = entry.dateKey;
          }
        }
      }
      for (let index = 0, { length } = readingGoals; index < length; index += 1) {
        const readingGoal = readingGoals[index];
        const readingGoalDate = getDate(readingGoal.goalStartDate);
        let readingGoalDateString = readingGoal.goalStartDate;
        while (
          (readingGoal.goalEndDate && readingGoalDateString <= readingGoal.goalEndDate) ||
          (!readingGoal.goalEndDate && readingGoalDateString <= lastDayString)
        ) {
          const currentReadingGoalWindow: ReadingGoalHeatmapGlobalDayData = {
            readingGoalStartDate: readingGoalDateString,
            readingGoalEndDate: readingGoal.goalEndDate,
            timeGoal: readingGoal.timeGoal,
            readingTime: 0,
            characterGoal: readingGoal.characterGoal,
            charactersRead: 0,
            closedEarly: false,
            readingTimePercentage: 0,
            normalizedReadingTimePercentage: 0,
            charactersReadPercentage: 0,
            normalizedCharactersReadPercentage: 0,
            readingGoalCompletedPercentage: 0,
            normalizedReadingGoalCompletedPercentage: 0,
            titles: new Set<string>()
          };
          let currentReadingGoalDay = currentReadingGoalWindow.readingGoalStartDate;
          const currentReadingGoalDayDate = getDate(currentReadingGoalDay);
          switch (readingGoal.goalFrequency) {
            case ReadingGoalFrequency.WEEKLY:
              readingGoalDate.setDate(readingGoalDate.getDate() + 6);
              break;
            case ReadingGoalFrequency.MONTHLY:
              readingGoalDate.setDate(readingGoalDate.getDate() + 29);
              break;
            default:
              break;
          }
          currentReadingGoalWindow.readingGoalEndDate = getDateString(readingGoalDate);
          if (
            readingGoal.goalEndDate &&
            currentReadingGoalWindow.readingGoalEndDate > readingGoal.goalEndDate
          ) {
            currentReadingGoalWindow.readingGoalEndDate = readingGoal.goalEndDate;
          }
          currentReadingGoalWindow.closedEarly =
            currentReadingGoalWindow.readingGoalEndDate < readingGoal.goalOriginalEndDate;
          while (currentReadingGoalDay <= currentReadingGoalWindow.readingGoalEndDate) {
            const data = groupsedStatisticsData.get(currentReadingGoalDay);
            if (data) {
              currentReadingGoalWindow.readingTime += data.readingTime;
              currentReadingGoalWindow.charactersRead += data.charactersRead;
              data.titles.forEach((title) => currentReadingGoalWindow.titles.add(title));
            }
            ({ dateString: currentReadingGoalDay } = advanceDateDays(currentReadingGoalDayDate));
          }
          const allBasePercentage =
            currentReadingGoalWindow.timeGoal && currentReadingGoalWindow.characterGoal ? 2 : 1;
          const realReadingTimePercentage = currentReadingGoalWindow.timeGoal
            ? currentReadingGoalWindow.readingTime / currentReadingGoalWindow.timeGoal
            : 0;
          const realCharactersReadPercentage = currentReadingGoalWindow.characterGoal
            ? currentReadingGoalWindow.charactersRead / currentReadingGoalWindow.characterGoal
            : 0;
          const percentageSum = realReadingTimePercentage + realCharactersReadPercentage;
          const realPercentage = caluclatePercentage(percentageSum, allBasePercentage);
          currentReadingGoalWindow.readingTimePercentage = Math.floor(
            realReadingTimePercentage * 100
          );
          currentReadingGoalWindow.normalizedReadingTimePercentage = limitToRange(
            0,
            100,
            currentReadingGoalWindow.readingTimePercentage
          );
          currentReadingGoalWindow.charactersReadPercentage = Math.floor(
            realCharactersReadPercentage * 100
          );
          currentReadingGoalWindow.normalizedCharactersReadPercentage = limitToRange(
            0,
            100,
            currentReadingGoalWindow.charactersReadPercentage
          );
          currentReadingGoalWindow.readingGoalCompletedPercentage = realPercentage;
          currentReadingGoalWindow.normalizedReadingGoalCompletedPercentage = limitToRange(
            0,
            100,
            caluclatePercentage(
              limitToRange(0, 1, realReadingTimePercentage) +
                limitToRange(0, 1, realCharactersReadPercentage),
              allBasePercentage
            )
          );
          const completedReadingGoal =
            currentReadingGoalWindow.normalizedReadingGoalCompletedPercentage === 100;
          closedReadingGoalsCount += 1;
          if (completedReadingGoal) {
            completedReadingGoalsCount += 1;
            currentReadingGoalsStreak.startDate =
              currentReadingGoalsStreak.startDate || currentReadingGoalWindow.readingGoalStartDate;
            currentReadingGoalsStreak.endDate = currentReadingGoalWindow.readingGoalEndDate;
            currentReadingGoalsStreak.duration += 1;
          } else {
            if (currentReadingGoalsStreak.duration) {
              streaks.push(currentReadingGoalsStreak);
            }
            currentReadingGoalsStreak = { startDate: '', endDate: '', duration: 0 };
          }
          globalDataObject.set(
            currentReadingGoalWindow.readingGoalStartDate,
            currentReadingGoalWindow
          );
          ({ dateString: readingGoalDateString } = advanceDateDays(readingGoalDate));
        }
      }
      if (currentReadingGoalsStreak.startDate) {
        const lastStreak = streaks[streaks.length - 1];
        if (!lastStreak || lastStreak.startDate !== currentReadingGoalsStreak.startDate) {
          streaks.push(currentReadingGoalsStreak);
        }
      }
      streaks.sort(sortStreaks);
      __readerController.changed(
        (globalHeatmapData = {
          completedReadingGoals: getCompletedReadingGoalsLabel(
            completedReadingGoalsCount,
            closedReadingGoalsCount
          ),
          streaks,
          longestStreaks: getLongestStreaks(streaks),
          currentStreak: getCurrentStreak(streaks, todayKey)
        })
      );
    }
    const firstDayOfYearDateString = getDateString(new Date(heatmapYear, 0, 1, 0, 0, 0, 0));
    const lastDayOfYearDateString = getDateString(new Date(heatmapYear, 11, 31, 0, 0, 0, 0));
    const entries = [...globalDataObject.entries()];
    const relevantReadingGoals: ReadingGoalHeatmapGlobalDayData[] = [];
    for (let index = 0, { length } = entries; index < length; index += 1) {
      const [dateKey, readingGoal] = entries[index];
      if (dateKey > lastDayOfYearDateString) {
        break;
      }
      if (
        (readingGoal.readingGoalStartDate >= firstDayOfYearDateString &&
          readingGoal.readingGoalStartDate <= lastDayOfYearDateString) ||
        (firstDayOfYearDateString >= readingGoal.readingGoalStartDate &&
          firstDayOfYearDateString <= readingGoal.readingGoalEndDate)
      ) {
        relevantReadingGoals.push(readingGoal);
      }
    }
    if (heatmapAggregration === HeatmapDataAggregration.ALL_TIME) {
      __readerController.changed((currentHeatmapData = globalHeatmapData));
    } else if (heatmapDataByYear.has(heatmapYear)) {
      __readerController.changed((currentHeatmapData = heatmapDataByYear.get(heatmapYear)!));
    } else {
      const streaksInYear: HeatmapStreak[] = JSON.parse(
        JSON.stringify(
          globalHeatmapData.streaks.filter(
            (streak) =>
              (streak.startDate >= firstDayOfYearDateString &&
                streak.startDate <= lastDayOfYearDateString) ||
              (firstDayOfYearDateString >= streak.startDate &&
                firstDayOfYearDateString <= streak.endDate)
          )
        )
      );
      streaksInYear.sort(sortStreaks);
      completedReadingGoalsCount = 0;
      closedReadingGoalsCount = 0;
      for (let index = 0, { length } = relevantReadingGoals; index < length; index += 1) {
        const readingGoal = relevantReadingGoals[index];
        closedReadingGoalsCount += 1;
        if (readingGoal.normalizedReadingGoalCompletedPercentage === 100) {
          completedReadingGoalsCount += 1;
        }
      }
      const newMapData: ReadingGoalsHeatmapData = {
        streaks: streaksInYear,
        completedReadingGoals: getCompletedReadingGoalsLabel(
          completedReadingGoalsCount,
          closedReadingGoalsCount
        ),
        longestStreaks: getLongestStreaks(streaksInYear),
        currentStreak: getCurrentStreak(streaksInYear, todayKey)
      };
      heatmapDataByYear.set(heatmapYear, newMapData);
      __readerController.changed((currentHeatmapData = newMapData));
    }
    updateHeatmapDayData(relevantReadingGoals[0]);
  }
  function getDefaultHeatmapGlobalDayData(): HeatmapGlobalDayData {
    return { readingTime: 0, charactersRead: 0, titles: new Set<string>() };
  }
  function sortStreaks(streak1: HeatmapStreak, streak2: HeatmapStreak) {
    if (streak1.duration > streak2.duration) {
      return -1;
    }
    if (streak1.duration !== streak2.duration) {
      return 1;
    }
    return streak1.startDate > streak2.startDate ? 1 : -1;
  }
  function getDaysReadLabel(allDaysReadCount: number, daysRead: any) {
    let daysReadLabel = '';
    if (allDaysReadCount) {
      daysReadLabel = `${daysRead.size} / ${pluralize(allDaysReadCount, 'day')} (${allDaysReadCount ? caluclatePercentage(daysRead.size, allDaysReadCount) : 0}%)`;
    } else {
      daysReadLabel = '0 / 0 days (0%)';
    }
    return daysReadLabel;
  }
  function getLongestStreaks(streaks: HeatmapStreak[]) {
    const longestStreakDuration = streaks[0]?.duration;
    return longestStreakDuration
      ? streaks.filter((streak) => streak.duration === longestStreakDuration)
      : [];
  }
  function getCurrentStreak(streaks: HeatmapStreak[], dateKey: string) {
    let currentStreak: HeatmapStreak = { startDate: '', endDate: '', duration: 0 };
    for (let index = 0, { length } = streaks; index < length; index += 1) {
      const streak = streaks[index];
      if (dateKey >= streak.startDate && dateKey <= streak.endDate) {
        currentStreak = streak;
        break;
      }
    }
    return currentStreak;
  }
  function getColorRanges(minimumValue: number, maximumValue: number, forcedMax?: number) {
    const colorRangeslist: HeatmapColorRange[] = [{ limit: 0, color: '' }];
    if (maximumValue) {
      const steps = Math.ceil(maximumValue / 4);
      const colorMax = forcedMax || maximumValue - steps + minimumValue;
      const willExecute = minimumValue < maximumValue;
      if (willExecute) {
        for (let limit = minimumValue; limit < maximumValue; limit += steps) {
          if (limit) {
            colorRangeslist.push({
              limit,
              color: colorByRating(
                heatmapMinValueColor,
                heatmapMaxValueColor,
                minimumValue,
                colorMax,
                limit
              )
            });
          }
        }
      } else {
        colorRangeslist.push({
          limit: minimumValue,
          color: `#${heatmapMaxValueColor}`
        });
      }
    }
    colorRangeslist.reverse();
    return colorRangeslist;
  }
  function colorByRating(
    colorStart: string,
    colorEnd: String,
    minValue: number,
    maxValue: number,
    value: number
  ) {
    const colorRatio = limitToRange(0, 1, value / (maxValue - minValue));
    const r = Math.ceil(
      parseInt(colorStart.substring(0, 2), 16) * (1 - colorRatio) +
        parseInt(colorEnd.substring(0, 2), 16) * colorRatio
    );
    const g = Math.ceil(
      parseInt(colorStart.substring(2, 4), 16) * (1 - colorRatio) +
        parseInt(colorEnd.substring(2, 4), 16) * colorRatio
    );
    const b = Math.ceil(
      parseInt(colorStart.substring(4, 6), 16) * (1 - colorRatio) +
        parseInt(colorEnd.substring(4, 6), 16) * colorRatio
    );
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  function toHex(valueToConvert: number | string) {
    const value = valueToConvert.toString(16);
    return value.length === 1 ? `0${value}` : value;
  }
  function getCompletedReadingGoalsLabel(
    completedReadingGoalsCount: number,
    closedReadingGoalsCount: number
  ) {
    return `${completedReadingGoalsCount} / ${pluralize(closedReadingGoalsCount, 'goal')} (${caluclatePercentage(completedReadingGoalsCount, closedReadingGoalsCount)}%)`;
  }
  function updateHeatmapDayData(initialReadingGoal: ReadingGoalHeatmapGlobalDayData | undefined) {
    const mapDays: StatisticsHeatmapDayData[] = [];
    let year = heatmapYear;
    const dateObject = new Date(year, 0, 1, 0, 0, 0, 0);
    const dayIndex = dateObject.getDay();
    let dateString = '';
    let daysToFill = 0;
    let dayNumber = 1;
    let heatmapRow = 2;
    let heatmapColumn = 3;
    if ($lastStartDayOfWeek$ !== dayIndex) {
      if (!$lastStartDayOfWeek$) {
        daysToFill = dayIndex;
      } else if (!dayIndex) {
        daysToFill = 7 - $lastStartDayOfWeek$;
      } else {
        daysToFill =
          $lastStartDayOfWeek$ > dayIndex
            ? 7 - Math.abs(dayIndex - $lastStartDayOfWeek$)
            : dayIndex - $lastStartDayOfWeek$;
      }
    }
    while (daysToFill > 0) {
      mapDays.push({
        dateString: `${-daysToFill}`,
        isCurrentYear: false,
        heatmapRow,
        heatmapColumn,
        color: '',
        dayDetails: [],
        readingTime: 0
      });
      heatmapRow += 1;
      daysToFill -= 1;
    }
    let currentReadingGoalWindow: ReadingGoalHeatmapGlobalDayData | undefined;
    let initialReadingGoalUsed = false;
    while (year === heatmapYear) {
      dateString = getDateString(dateObject);
      if (heatmapType === HeatmapType.STATISTICS) {
        mapDays.push(getStatisticsHeatmapDayData(dateString, heatmapRow, heatmapColumn));
      } else {
        const result = getReadingGoalsHeatmapDayData(
          dateString,
          heatmapRow,
          heatmapColumn,
          currentReadingGoalWindow,
          initialReadingGoalUsed,
          initialReadingGoal
        );
        initialReadingGoalUsed = result.initialReadingGoalUsed;
        currentReadingGoalWindow = result.currentReadingGoalWindow;
        mapDays.push(result.statisticsHeatmapDay);
      }
      dateObject.setDate(dateObject.getDate() + 1);
      year = dateObject.getFullYear();
      dayNumber += 1;
      if (currentReadingGoalWindow && dateString === currentReadingGoalWindow.readingGoalEndDate) {
        currentReadingGoalWindow = undefined;
      }
      if (heatmapRow === 8) {
        heatmapColumn += 1;
        heatmapRow = 2;
      } else {
        heatmapRow += 1;
      }
    }
    while (heatmapRow < 9) {
      mapDays.push({
        dateString: `${dayNumber}`,
        isCurrentYear: false,
        heatmapRow,
        heatmapColumn,
        color: '',
        dayDetails: [],
        readingTime: 0
      });
      dayNumber += 1;
      heatmapRow += 1;
    }
    __readerController.changed((monthLabels = heatmapMonthLabels(mapDays, monthLabelList)));
    __readerController.changed((currentHeatmapDays = mapDays));
    readerTick().then(() => {
      if (alive && heatmapElement?.isConnected && heatmapYear === today.getFullYear()) {
        scrollToDay(todayKey);
      }
    });
  }
  function getStatisticsHeatmapDayData(
    dateString: string,
    heatmapRow: number,
    heatmapColumn: number
  ) {
    const dayData = globalHeatmapDayData.get(dateString);
    const statisticsHeatmapDay: StatisticsHeatmapDayData = dayData
      ? {
          dateString,
          isCurrentYear: true,
          heatmapRow,
          heatmapColumn,
          color: '',
          dayDetails: [
            dateString,
            `${secondsToMinutes(dayData.readingTime)} min`,
            `${dayData.charactersRead} characters`,
            pluralize(dayData.titles.size, 'title')
          ],
          readingTime: dayData.readingTime
        }
      : {
          dateString,
          isCurrentYear: true,
          heatmapRow,
          heatmapColumn,
          color: '',
          dayDetails: [dateString, `0 min`, `0 characters`, `0 titles`],
          readingTime: 0
        };
    const colorRangesToUse = checkIsStatisticsHeatmapData(currentHeatmapData)
      ? currentHeatmapData.colorRanges
      : colorRanges;
    if (statisticsHeatmapDay.isCurrentYear) {
      statisticsHeatmapDay.color =
        colorRangesToUse.find((r) => r.limit <= statisticsHeatmapDay.readingTime)?.color || '';
    }
    return statisticsHeatmapDay;
  }
  function getReadingGoalsHeatmapDayData(
    dateString: string,
    heatmapRow: number,
    heatmapColumn: number,
    existingReadingGoalWindow: ReadingGoalHeatmapGlobalDayData | undefined,
    readingGoalUsed: boolean,
    initialReadingGoal: ReadingGoalHeatmapGlobalDayData | undefined
  ) {
    const globalDataObject = globalHeatmapDayData as any;
    const statisticsHeatmapDay: StatisticsHeatmapDayData = {
      dateString,
      isCurrentYear: true,
      heatmapRow,
      heatmapColumn,
      color: '',
      dayDetails: [],
      readingTime: 0
    };
    let initialReadingGoalUsed = readingGoalUsed;
    let currentReadingGoalWindow = existingReadingGoalWindow;
    if (
      !initialReadingGoalUsed &&
      initialReadingGoal &&
      dateString >= initialReadingGoal.readingGoalStartDate
    ) {
      initialReadingGoalUsed = true;
      currentReadingGoalWindow = initialReadingGoal;
    } else {
      currentReadingGoalWindow = globalDataObject.get(dateString) || currentReadingGoalWindow;
    }
    if (currentReadingGoalWindow) {
      statisticsHeatmapDay.color =
        colorRanges.find(
          (r) => r.limit <= currentReadingGoalWindow!.normalizedReadingGoalCompletedPercentage
        )?.color || '';
      statisticsHeatmapDay.dayDetails.push(
        dateString,
        ...(currentReadingGoalWindow.readingGoalStartDate ===
        currentReadingGoalWindow.readingGoalEndDate
          ? []
          : [
              getDateRangeLabel(
                currentReadingGoalWindow.readingGoalStartDate,
                currentReadingGoalWindow.readingGoalEndDate
              )
            ]),
        pluralize(currentReadingGoalWindow.titles.size, 'title'),
        ...(currentReadingGoalWindow.timeGoal
          ? [
              `${secondsToMinutes(currentReadingGoalWindow.readingTime)} / ${secondsToMinutes(currentReadingGoalWindow.timeGoal)} min (${currentReadingGoalWindow.normalizedReadingTimePercentage}%)`
            ]
          : []),
        ...(currentReadingGoalWindow.characterGoal
          ? [
              `${currentReadingGoalWindow.charactersRead} / ${currentReadingGoalWindow.characterGoal} characters (${currentReadingGoalWindow.normalizedCharactersReadPercentage}%)`
            ]
          : []),
        ...(currentReadingGoalWindow.timeGoal && currentReadingGoalWindow.characterGoal
          ? [
              `Total Completion: ${currentReadingGoalWindow.normalizedReadingGoalCompletedPercentage}%`
            ]
          : [])
      );
    } else {
      statisticsHeatmapDay.dayDetails.push(
        dateString,
        `No ${dateString > todayKey ? 'Data' : 'Reading Goal'} for this Day`
      );
    }
    return { currentReadingGoalWindow, initialReadingGoalUsed, statisticsHeatmapDay };
  }
  __readerController.observeSource(
    () => lastStartDayOfWeek$,
    (value) => {
      $lastStartDayOfWeek$ = value;
    }
  );
  __readerController.observeSource(
    () => lastStatisticsStartDate$,
    (value) => {
      $lastStatisticsStartDate$ = value;
    }
  );
  __readerController.observeSource(
    () => lastStatisticsEndDate$,
    (value) => {
      $lastStatisticsEndDate$ = value;
    }
  );
  const api = {
    controller: __readerController,
    checkIsStatisticsHeatmapData,
    changeHeatmapYear,
    closeHeatmapDetails,
    openHeatmapDay,
    handleHeatmapDayKeydown,
    highlightStreaks,
    scrollToDay,
    updateHeatmapDataAfterFilterChange,
    updateHeatmapData,
    updateHeatmapDataForStatistics,
    updateHeatmapDataForReadingGoals,
    getDefaultHeatmapGlobalDayData,
    sortStreaks,
    getDaysReadLabel,
    getLongestStreaks,
    getCurrentStreak,
    getColorRanges,
    colorByRating,
    toHex,
    getCompletedReadingGoalsLabel,
    updateHeatmapDayData,
    getStatisticsHeatmapDayData,
    getReadingGoalsHeatmapDayData,
    get heatmapType() {
      return heatmapType;
    },
    set heatmapType(nextValue: typeof heatmapType) {
      if (Object.is(heatmapType, nextValue)) return;
      heatmapType = nextValue;
      __readerController.invalidate();
    },
    get heatmapAggregration() {
      return heatmapAggregration;
    },
    set heatmapAggregration(nextValue: typeof heatmapAggregration) {
      if (Object.is(heatmapAggregration, nextValue)) return;
      heatmapAggregration = nextValue;
      __readerController.invalidate();
    },
    get statisticsData() {
      return statisticsData;
    },
    set statisticsData(nextValue: typeof statisticsData) {
      if (Object.is(statisticsData, nextValue)) return;
      statisticsData = nextValue;
      __readerController.invalidate();
    },
    get readingGoals() {
      return readingGoals;
    },
    set readingGoals(nextValue: typeof readingGoals) {
      if (Object.is(readingGoals, nextValue)) return;
      readingGoals = nextValue;
      __readerController.invalidate();
    },
    get statisticsTitleFilters() {
      return statisticsTitleFilters;
    },
    set statisticsTitleFilters(nextValue: typeof statisticsTitleFilters) {
      if (Object.is(statisticsTitleFilters, nextValue)) return;
      statisticsTitleFilters = nextValue;
      __readerController.invalidate();
    },
    get today() {
      return today;
    },
    set today(nextValue: typeof today) {
      if (Object.is(today, nextValue)) return;
      today = nextValue;
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
    get colorRanges() {
      return colorRanges;
    },
    get heatmapElement() {
      return heatmapElement;
    },
    set heatmapElement(nextValue: typeof heatmapElement) {
      if (Object.is(heatmapElement, nextValue)) return;
      heatmapElement = nextValue;
      __readerController.invalidate();
    },
    get heatmapDetailDataPopover() {
      return heatmapDetailDataPopover;
    },
    set heatmapDetailDataPopover(nextValue: typeof heatmapDetailDataPopover) {
      if (Object.is(heatmapDetailDataPopover, nextValue)) return;
      heatmapDetailDataPopover = nextValue;
      __readerController.invalidate();
    },
    get monthLabels() {
      return monthLabels;
    },
    set monthLabels(nextValue: typeof monthLabels) {
      if (Object.is(monthLabels, nextValue)) return;
      monthLabels = nextValue;
      __readerController.invalidate();
    },
    get dayElementSize() {
      return dayElementSize;
    },
    set dayElementSize(nextValue: typeof dayElementSize) {
      if (Object.is(dayElementSize, nextValue)) return;
      dayElementSize = nextValue;
      __readerController.invalidate();
    },
    get heatmapYear() {
      return heatmapYear;
    },
    set heatmapYear(nextValue: typeof heatmapYear) {
      if (Object.is(heatmapYear, nextValue)) return;
      heatmapYear = nextValue;
      __readerController.invalidate();
    },
    get globalHeatmapData() {
      return globalHeatmapData;
    },
    set globalHeatmapData(nextValue: typeof globalHeatmapData) {
      if (Object.is(globalHeatmapData, nextValue)) return;
      globalHeatmapData = nextValue;
      __readerController.invalidate();
    },
    get globalHeatmapDayData() {
      return globalHeatmapDayData;
    },
    get heatmapDataByYear() {
      return heatmapDataByYear;
    },
    get currentHeatmapData() {
      return currentHeatmapData;
    },
    set currentHeatmapData(nextValue: typeof currentHeatmapData) {
      if (Object.is(currentHeatmapData, nextValue)) return;
      currentHeatmapData = nextValue;
      __readerController.invalidate();
    },
    get currentHeatmapDays() {
      return currentHeatmapDays;
    },
    set currentHeatmapDays(nextValue: typeof currentHeatmapDays) {
      if (Object.is(currentHeatmapDays, nextValue)) return;
      currentHeatmapDays = nextValue;
      __readerController.invalidate();
    },
    get popoverDetails() {
      return popoverDetails;
    },
    set popoverDetails(nextValue: typeof popoverDetails) {
      if (Object.is(popoverDetails, nextValue)) return;
      popoverDetails = nextValue;
      __readerController.invalidate();
    },
    get detailsOpen() {
      return detailsOpen;
    },
    set detailsOpen(nextValue: typeof detailsOpen) {
      if (Object.is(detailsOpen, nextValue)) return;
      detailsOpen = nextValue;
      __readerController.invalidate();
    },
    get activeDate() {
      return activeDate;
    },
    set activeDate(nextValue: typeof activeDate) {
      if (Object.is(activeDate, nextValue)) return;
      activeDate = nextValue;
      __readerController.invalidate();
    },
    get popupGeneration() {
      return popupGeneration;
    },
    set popupGeneration(nextValue: typeof popupGeneration) {
      if (Object.is(popupGeneration, nextValue)) return;
      popupGeneration = nextValue;
      __readerController.invalidate();
    },
    get alive() {
      return alive;
    },
    set alive(nextValue: typeof alive) {
      if (Object.is(alive, nextValue)) return;
      alive = nextValue;
      __readerController.invalidate();
    },
    get selectedStreak() {
      return selectedStreak;
    },
    set selectedStreak(nextValue: typeof selectedStreak) {
      if (Object.is(selectedStreak, nextValue)) return;
      selectedStreak = nextValue;
      __readerController.invalidate();
    },
    get selectedStreakDates() {
      return selectedStreakDates;
    },
    set selectedStreakDates(nextValue: typeof selectedStreakDates) {
      if (Object.is(selectedStreakDates, nextValue)) return;
      selectedStreakDates = nextValue;
      __readerController.invalidate();
    },
    get activeDay() {
      return activeDay;
    },
    set activeDay(nextValue: typeof activeDay) {
      if (Object.is(activeDay, nextValue)) return;
      activeDay = nextValue;
      __readerController.invalidate();
    },
    get heatmapLabel() {
      return heatmapLabel;
    },
    set heatmapLabel(nextValue: typeof heatmapLabel) {
      if (Object.is(heatmapLabel, nextValue)) return;
      heatmapLabel = nextValue;
      __readerController.invalidate();
    },
    get dayLabels() {
      return dayLabels;
    },
    set dayLabels(nextValue: typeof dayLabels) {
      if (Object.is(dayLabels, nextValue)) return;
      dayLabels = nextValue;
      __readerController.invalidate();
    },
    get $lastStartDayOfWeek$() {
      return $lastStartDayOfWeek$;
    },
    set $lastStartDayOfWeek$(nextValue: typeof $lastStartDayOfWeek$) {
      writeStore(lastStartDayOfWeek$, nextValue);
    },
    get $lastStatisticsStartDate$() {
      return $lastStatisticsStartDate$;
    },
    set $lastStatisticsStartDate$(nextValue: typeof $lastStatisticsStartDate$) {
      writeStore(lastStatisticsStartDate$, nextValue);
    },
    get $lastStatisticsEndDate$() {
      return $lastStatisticsEndDate$;
    },
    set $lastStatisticsEndDate$(nextValue: typeof $lastStatisticsEndDate$) {
      writeStore(lastStatisticsEndDate$, nextValue);
    },
    updateProps(next: Record<string, unknown>) {
      if ('heatmapType' in next) api.heatmapType = next.heatmapType as typeof heatmapType;
      if ('heatmapAggregration' in next)
        api.heatmapAggregration = next.heatmapAggregration as typeof heatmapAggregration;
      if ('statisticsData' in next)
        api.statisticsData = next.statisticsData as typeof statisticsData;
      if ('readingGoals' in next) api.readingGoals = next.readingGoals as typeof readingGoals;
      if ('statisticsTitleFilters' in next)
        api.statisticsTitleFilters = next.statisticsTitleFilters as typeof statisticsTitleFilters;
      if ('today' in next) api.today = next.today as typeof today;
      if ('todayKey' in next) api.todayKey = next.todayKey as typeof todayKey;
    }
  };
  return api;
}
