/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  statisticsTitleFilterEnabled$,
  statisticsTitleFilterIsOpen$,
  type StatisticsDataSource
} from '../lib/components/statistics/statistics-types';
import { lastStatisticsTab$ } from '$lib/data/store';
import { ReaderController, writeStore, type StoreValue } from '../reader-react/controller';

export interface StatisticsHeaderProps {
  currentBookId: number | undefined;
  showStatisticsSettings: boolean;
}

export function createStatisticsHeader(
  props: StatisticsHeaderProps,
  _emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();

  let $lastStatisticsTab$: StoreValue<typeof lastStatisticsTab$> =
    __readerController.read(lastStatisticsTab$);
  let $statisticsTitleFilterEnabled$: StoreValue<typeof statisticsTitleFilterEnabled$> =
    __readerController.read(statisticsTitleFilterEnabled$);
  let $statisticsTitleFilterIsOpen$: StoreValue<typeof statisticsTitleFilterIsOpen$> =
    __readerController.read(statisticsTitleFilterIsOpen$);
  let currentBookId: number | undefined = props.currentBookId;
  let showStatisticsSettings: boolean = props.showStatisticsSettings;
  const copyItems: StatisticsDataSource[] = [
    { key: 'readingTime', label: 'Reading Time' },
    { key: 'charactersRead', label: 'Characters Read' }
  ];
  __readerController.observeSource(
    () => lastStatisticsTab$,
    (value) => {
      $lastStatisticsTab$ = value;
    }
  );
  __readerController.observeSource(
    () => statisticsTitleFilterEnabled$,
    (value) => {
      $statisticsTitleFilterEnabled$ = value;
    }
  );
  __readerController.observeSource(
    () => statisticsTitleFilterIsOpen$,
    (value) => {
      $statisticsTitleFilterIsOpen$ = value;
    }
  );
  const api = {
    controller: __readerController,
    get currentBookId() {
      return currentBookId;
    },
    set currentBookId(nextValue: typeof currentBookId) {
      if (Object.is(currentBookId, nextValue)) return;
      currentBookId = nextValue;
      __readerController.invalidate();
    },
    get showStatisticsSettings() {
      return showStatisticsSettings;
    },
    set showStatisticsSettings(nextValue: typeof showStatisticsSettings) {
      if (Object.is(showStatisticsSettings, nextValue)) return;
      showStatisticsSettings = nextValue;
      __readerController.invalidate();
    },
    get copyItems() {
      return copyItems;
    },
    get $lastStatisticsTab$() {
      return $lastStatisticsTab$;
    },
    set $lastStatisticsTab$(nextValue: typeof $lastStatisticsTab$) {
      writeStore(lastStatisticsTab$, nextValue);
    },
    get $statisticsTitleFilterEnabled$() {
      return $statisticsTitleFilterEnabled$;
    },
    set $statisticsTitleFilterEnabled$(nextValue: typeof $statisticsTitleFilterEnabled$) {
      writeStore(statisticsTitleFilterEnabled$, nextValue);
    },
    get $statisticsTitleFilterIsOpen$() {
      return $statisticsTitleFilterIsOpen$;
    },
    set $statisticsTitleFilterIsOpen$(nextValue: typeof $statisticsTitleFilterIsOpen$) {
      writeStore(statisticsTitleFilterIsOpen$, nextValue);
    },
    updateProps(next: Record<string, unknown>) {
      if ('currentBookId' in next) api.currentBookId = next.currentBookId as typeof currentBookId;
      if ('showStatisticsSettings' in next)
        api.showStatisticsSettings = next.showStatisticsSettings as typeof showStatisticsSettings;
    }
  };
  return api;
}
