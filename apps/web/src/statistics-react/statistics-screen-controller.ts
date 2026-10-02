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
import {
  StatisticsRangeTemplate,
  type StatisticsDateChange,
  preFilteredBookKeysForStatistics$,
  preFilteredTitlesForStatistics$,
  statisticsActionInProgress$
} from '$lib/components/statistics/statistics-types';

import {
  database,
  lastStartDayOfWeek$,
  lastStatisticsEndDate$,
  lastStatisticsRangeTemplate$,
  lastStatisticsStartDate$,
  startDayHoursForTracker$
} from '$lib/data/store';
import {
  advanceDateDays,
  getDateKey,
  getDateString,
  getStartHoursDate
} from '$lib/functions/statistic-util';
import { map, share } from 'rxjs';
import {
  ReaderController,
  readerTick,
  writeStore,
  type StoreValue
} from '../reader-react/controller';

export interface StatisticsScreenProps {}

export function createStatisticsScreen(
  props: StatisticsScreenProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();

  let $lastStatisticsRangeTemplate$: StoreValue<typeof lastStatisticsRangeTemplate$> =
    __readerController.read(lastStatisticsRangeTemplate$);
  let $lastStartDayOfWeek$: StoreValue<typeof lastStartDayOfWeek$> =
    __readerController.read(lastStartDayOfWeek$);
  let $preFilteredTitlesForStatistics$: StoreValue<typeof preFilteredTitlesForStatistics$> =
    __readerController.read(preFilteredTitlesForStatistics$);
  let $preFilteredBookKeysForStatistics$: StoreValue<typeof preFilteredBookKeysForStatistics$> =
    __readerController.read(preFilteredBookKeysForStatistics$);
  let $startDayHoursForTracker$: StoreValue<typeof startDayHoursForTracker$> =
    __readerController.read(startDayHoursForTracker$);
  let $lastStatisticsStartDate$: StoreValue<typeof lastStatisticsStartDate$> =
    __readerController.read(lastStatisticsStartDate$);
  let $lastStatisticsEndDate$: StoreValue<typeof lastStatisticsEndDate$> =
    __readerController.read(lastStatisticsEndDate$);
  let $currentBookId$: StoreValue<typeof currentBookId$> = undefined as never;
  let $statisticsActionInProgress$: StoreValue<typeof statisticsActionInProgress$> =
    __readerController.read(statisticsActionInProgress$);
  const currentBookId$ = database.lastItem$.pipe(
    map((item) => item?.dataId),
    share()
  );
  let showStatisticsSettings = false;
  __readerController.effect(
    () => [$lastStatisticsRangeTemplate$, $lastStartDayOfWeek$],
    () => {
      if ($lastStatisticsRangeTemplate$ || $lastStartDayOfWeek$ > -1) {
        readerTick().then(() => {
          if (!__readerController.disposed) setSelectedStatisticsDays();
        });
      }
    }
  );
  let mounted = false;
  __readerController.onMount(() => {
    mounted = true;
  });
  __readerController.onDestroy(() => {
    if (!mounted) return;
    writeStore(preFilteredTitlesForStatistics$, new Set());
    writeStore(preFilteredBookKeysForStatistics$, new Set());
  });
  function handleSelectedStatisticsDateChange({
    detail: { dateString, isStartDate }
  }: CustomEvent<StatisticsDateChange>) {
    const referenceDate = getStartHoursDate($startDayHoursForTracker$);
    const todayKey = getDateKey($startDayHoursForTracker$, referenceDate);
    writeStore(lastStatisticsRangeTemplate$, StatisticsRangeTemplate.CUSTOM);
    if (isStartDate) {
      writeStore(lastStatisticsStartDate$, dateString || todayKey);
    } else {
      writeStore(lastStatisticsEndDate$, dateString || todayKey);
    }
    if ($lastStatisticsStartDate$ > $lastStatisticsEndDate$) {
      const originalStartDate = $lastStatisticsStartDate$;
      const originalEndDate = $lastStatisticsEndDate$;
      writeStore(lastStatisticsStartDate$, originalEndDate);
      writeStore(lastStatisticsEndDate$, originalStartDate);
    }
    setSelectedStatisticsDays(referenceDate);
  }
  function setSelectedStatisticsDays(referenceDate = getStartHoursDate($startDayHoursForTracker$)) {
    switch ($lastStatisticsRangeTemplate$) {
      case StatisticsRangeTemplate.TODAY: {
        const dateKey = getDateString(referenceDate);
        writeStore(lastStatisticsStartDate$, dateKey);
        writeStore(lastStatisticsEndDate$, dateKey);
        break;
      }
      case StatisticsRangeTemplate.WEEK: {
        const dayIndex = referenceDate.getDay();
        let dayDiff = 0;
        if ($lastStartDayOfWeek$ !== dayIndex) {
          if (!$lastStartDayOfWeek$) {
            dayDiff = -dayIndex;
          } else if (!dayIndex) {
            dayDiff = $lastStartDayOfWeek$ - 7;
          } else {
            dayDiff =
              $lastStartDayOfWeek$ > dayIndex
                ? $lastStartDayOfWeek$ - dayIndex - 7
                : $lastStartDayOfWeek$ - dayIndex;
          }
        }
        writeStore(lastStatisticsStartDate$, advanceDateDays(referenceDate, dayDiff).dateString);
        writeStore(lastStatisticsEndDate$, advanceDateDays(referenceDate, 6).dateString);
        break;
      }
      case StatisticsRangeTemplate.MONTH: {
        referenceDate.setDate(1);
        writeStore(lastStatisticsStartDate$, getDateString(referenceDate));
        referenceDate.setMonth(referenceDate.getMonth() + 1);
        writeStore(lastStatisticsEndDate$, advanceDateDays(referenceDate, -1).dateString);
        break;
      }
      case StatisticsRangeTemplate.YEAR: {
        referenceDate.setMonth(0);
        referenceDate.setDate(1);
        writeStore(lastStatisticsStartDate$, getDateString(referenceDate));
        referenceDate.setFullYear(referenceDate.getFullYear() + 1);
        writeStore(lastStatisticsEndDate$, advanceDateDays(referenceDate, -1).dateString);
        break;
      }
      default:
        break;
    }
  }
  __readerController.observeSource(
    () => lastStatisticsRangeTemplate$,
    (value) => {
      $lastStatisticsRangeTemplate$ = value;
    }
  );
  __readerController.observeSource(
    () => lastStartDayOfWeek$,
    (value) => {
      $lastStartDayOfWeek$ = value;
    }
  );
  __readerController.observeSource(
    () => preFilteredTitlesForStatistics$,
    (value) => {
      $preFilteredTitlesForStatistics$ = value;
    }
  );
  __readerController.observeSource(
    () => preFilteredBookKeysForStatistics$,
    (value) => {
      $preFilteredBookKeysForStatistics$ = value;
    }
  );
  __readerController.observeSource(
    () => startDayHoursForTracker$,
    (value) => {
      $startDayHoursForTracker$ = value;
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
  __readerController.observeSource(
    () => currentBookId$,
    (value) => {
      $currentBookId$ = value;
    }
  );
  __readerController.observeSource(
    () => statisticsActionInProgress$,
    (value) => {
      $statisticsActionInProgress$ = value;
    }
  );
  const api = {
    controller: __readerController,
    handleSelectedStatisticsDateChange,
    setSelectedStatisticsDays,
    get currentBookId$() {
      return currentBookId$;
    },
    get showStatisticsSettings() {
      return showStatisticsSettings;
    },
    set showStatisticsSettings(nextValue: typeof showStatisticsSettings) {
      if (Object.is(showStatisticsSettings, nextValue)) return;
      showStatisticsSettings = nextValue;
      __readerController.invalidate();
    },
    get $lastStatisticsRangeTemplate$() {
      return $lastStatisticsRangeTemplate$;
    },
    set $lastStatisticsRangeTemplate$(nextValue: typeof $lastStatisticsRangeTemplate$) {
      writeStore(lastStatisticsRangeTemplate$, nextValue);
    },
    get $lastStartDayOfWeek$() {
      return $lastStartDayOfWeek$;
    },
    set $lastStartDayOfWeek$(nextValue: typeof $lastStartDayOfWeek$) {
      writeStore(lastStartDayOfWeek$, nextValue);
    },
    get $preFilteredTitlesForStatistics$() {
      return $preFilteredTitlesForStatistics$;
    },
    set $preFilteredTitlesForStatistics$(nextValue: typeof $preFilteredTitlesForStatistics$) {
      writeStore(preFilteredTitlesForStatistics$, nextValue);
    },
    get $preFilteredBookKeysForStatistics$() {
      return $preFilteredBookKeysForStatistics$;
    },
    set $preFilteredBookKeysForStatistics$(nextValue: typeof $preFilteredBookKeysForStatistics$) {
      writeStore(preFilteredBookKeysForStatistics$, nextValue);
    },
    get $startDayHoursForTracker$() {
      return $startDayHoursForTracker$;
    },
    set $startDayHoursForTracker$(nextValue: typeof $startDayHoursForTracker$) {
      writeStore(startDayHoursForTracker$, nextValue);
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
    get $currentBookId$() {
      return $currentBookId$;
    },
    get $statisticsActionInProgress$() {
      return $statisticsActionInProgress$;
    },
    set $statisticsActionInProgress$(nextValue: typeof $statisticsActionInProgress$) {
      writeStore(statisticsActionInProgress$, nextValue);
    },
    updateProps(next: Record<string, unknown>) {}
  };
  return api;
}
