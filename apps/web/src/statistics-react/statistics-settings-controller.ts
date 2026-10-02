/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  exportStatisticsData$,
  statisticsActionInProgress$,
  deleteStatisticsData$
} from '$lib/components/statistics/statistics-types';
import { daysOfWeek } from '$lib/components/statistics/statistics-heatmap/statistics-heatmap';
import {
  confirmStatisticsDeletion$,
  lastCharactersDataSource$,
  lastPrimaryReadingDataAggregationMode$,
  lastReadingSpeedDataSource$,
  lastReadingTimeDataSource$,
  lastStartDayOfWeek$,
  lastStatisticsEndDate$,
  lastStatisticsRangeTemplate$,
  lastStatisticsStartDate$
} from '$lib/data/store';
import { ReaderController, writeStore, type StoreValue } from '../reader-react/controller';

export type StatisticsSettingsProps = Record<string, unknown>;

export function createStatisticsSettings(
  props: StatisticsSettingsProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let selectedStatisticsStartDate: any;
  let selectedStatisticsEndDate: any;
  let $lastStatisticsStartDate$: StoreValue<typeof lastStatisticsStartDate$> =
    __readerController.read(lastStatisticsStartDate$);
  let $lastStatisticsEndDate$: StoreValue<typeof lastStatisticsEndDate$> =
    __readerController.read(lastStatisticsEndDate$);
  let $statisticsActionInProgress$: StoreValue<typeof statisticsActionInProgress$> =
    __readerController.read(statisticsActionInProgress$);
  let $lastStatisticsRangeTemplate$: StoreValue<typeof lastStatisticsRangeTemplate$> =
    __readerController.read(lastStatisticsRangeTemplate$);
  let $lastStartDayOfWeek$: StoreValue<typeof lastStartDayOfWeek$> =
    __readerController.read(lastStartDayOfWeek$);
  let $lastReadingTimeDataSource$: StoreValue<typeof lastReadingTimeDataSource$> =
    __readerController.read(lastReadingTimeDataSource$);
  let $lastCharactersDataSource$: StoreValue<typeof lastCharactersDataSource$> =
    __readerController.read(lastCharactersDataSource$);
  let $lastReadingSpeedDataSource$: StoreValue<typeof lastReadingSpeedDataSource$> =
    __readerController.read(lastReadingSpeedDataSource$);
  let $lastPrimaryReadingDataAggregationMode$: StoreValue<
    typeof lastPrimaryReadingDataAggregationMode$
  > = __readerController.read(lastPrimaryReadingDataAggregationMode$);
  let $confirmStatisticsDeletion$: StoreValue<typeof confirmStatisticsDeletion$> =
    __readerController.read(confirmStatisticsDeletion$);
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  const weekDays = [...daysOfWeek.slice(1, 7), daysOfWeek[0]].map((day, index) => {
    if (day === 'Sunday') {
      return { day, index: 0 };
    }
    return { day, index: index + 1 };
  });
  __readerController.effect(
    () => [$lastStatisticsStartDate$],
    () => {
      __readerController.changed((selectedStatisticsStartDate = $lastStatisticsStartDate$));
    }
  );
  __readerController.effect(
    () => [$lastStatisticsEndDate$],
    () => {
      __readerController.changed((selectedStatisticsEndDate = $lastStatisticsEndDate$));
    }
  );
  async function exportStatisticsData(exportAllStatisticsData = true) {
    writeStore(statisticsActionInProgress$, true);
    exportStatisticsData$.next(exportAllStatisticsData);
  }
  async function deleteStatisticsData(deleteAllStatisticsData = true) {
    writeStore(statisticsActionInProgress$, true);
    deleteStatisticsData$.next(deleteAllStatisticsData);
  }
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
    () => statisticsActionInProgress$,
    (value) => {
      $statisticsActionInProgress$ = value;
    }
  );
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
    () => lastReadingTimeDataSource$,
    (value) => {
      $lastReadingTimeDataSource$ = value;
    }
  );
  __readerController.observeSource(
    () => lastCharactersDataSource$,
    (value) => {
      $lastCharactersDataSource$ = value;
    }
  );
  __readerController.observeSource(
    () => lastReadingSpeedDataSource$,
    (value) => {
      $lastReadingSpeedDataSource$ = value;
    }
  );
  __readerController.observeSource(
    () => lastPrimaryReadingDataAggregationMode$,
    (value) => {
      $lastPrimaryReadingDataAggregationMode$ = value;
    }
  );
  __readerController.observeSource(
    () => confirmStatisticsDeletion$,
    (value) => {
      $confirmStatisticsDeletion$ = value;
    }
  );
  const api = {
    controller: __readerController,
    exportStatisticsData,
    deleteStatisticsData,
    get dispatch() {
      return dispatch;
    },
    get weekDays() {
      return weekDays;
    },
    get selectedStatisticsStartDate() {
      return selectedStatisticsStartDate;
    },
    set selectedStatisticsStartDate(nextValue: typeof selectedStatisticsStartDate) {
      if (Object.is(selectedStatisticsStartDate, nextValue)) return;
      selectedStatisticsStartDate = nextValue;
      __readerController.invalidate();
    },
    get selectedStatisticsEndDate() {
      return selectedStatisticsEndDate;
    },
    set selectedStatisticsEndDate(nextValue: typeof selectedStatisticsEndDate) {
      if (Object.is(selectedStatisticsEndDate, nextValue)) return;
      selectedStatisticsEndDate = nextValue;
      __readerController.invalidate();
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
    get $statisticsActionInProgress$() {
      return $statisticsActionInProgress$;
    },
    set $statisticsActionInProgress$(nextValue: typeof $statisticsActionInProgress$) {
      writeStore(statisticsActionInProgress$, nextValue);
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
    get $lastReadingTimeDataSource$() {
      return $lastReadingTimeDataSource$;
    },
    set $lastReadingTimeDataSource$(nextValue: typeof $lastReadingTimeDataSource$) {
      writeStore(lastReadingTimeDataSource$, nextValue);
    },
    get $lastCharactersDataSource$() {
      return $lastCharactersDataSource$;
    },
    set $lastCharactersDataSource$(nextValue: typeof $lastCharactersDataSource$) {
      writeStore(lastCharactersDataSource$, nextValue);
    },
    get $lastReadingSpeedDataSource$() {
      return $lastReadingSpeedDataSource$;
    },
    set $lastReadingSpeedDataSource$(nextValue: typeof $lastReadingSpeedDataSource$) {
      writeStore(lastReadingSpeedDataSource$, nextValue);
    },
    get $lastPrimaryReadingDataAggregationMode$() {
      return $lastPrimaryReadingDataAggregationMode$;
    },
    set $lastPrimaryReadingDataAggregationMode$(
      nextValue: typeof $lastPrimaryReadingDataAggregationMode$
    ) {
      writeStore(lastPrimaryReadingDataAggregationMode$, nextValue);
    },
    get $confirmStatisticsDeletion$() {
      return $confirmStatisticsDeletion$;
    },
    set $confirmStatisticsDeletion$(nextValue: typeof $confirmStatisticsDeletion$) {
      writeStore(confirmStatisticsDeletion$, nextValue);
    },
    updateProps(_next: Record<string, unknown>) {}
  };
  return api;
}
