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
import type { StatisticsSummaryKey } from '$lib/components/statistics/statistics-summary/statistics-summary';
import type {
  BookStatistic,
  StatisticsDataSource
} from '$lib/components/statistics/statistics-types';

import {
  lastStatisticsSummarySortDirection$,
  lastStatisticsSummarySortProperty$
} from '$lib/data/store';
import { ReaderController, writeStore, type StoreValue } from '../reader-react/controller';

export interface StatisticsSummaryHeaderProps {
  statisticsSummaryKey: StatisticsSummaryKey;
  options: StatisticsDataSource[];
  selectionKey: keyof BookStatistic;
  gridRow: number | undefined;
  hasRowInEdit: boolean;
  isHidden?: boolean;
  title?: string;
}

export function createStatisticsSummaryHeader(
  props: StatisticsSummaryHeaderProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let optionKeys: any;
  let selectedOption: any;
  let $lastStatisticsSummarySortProperty$: StoreValue<typeof lastStatisticsSummarySortProperty$> =
    __readerController.read(lastStatisticsSummarySortProperty$);
  let $lastStatisticsSummarySortDirection$: StoreValue<typeof lastStatisticsSummarySortDirection$> =
    __readerController.read(lastStatisticsSummarySortDirection$);
  let statisticsSummaryKey: StatisticsSummaryKey = props.statisticsSummaryKey;
  let options: StatisticsDataSource[] = props.options;
  let selectionKey: keyof BookStatistic = props.selectionKey;
  let gridRow: number | undefined = props.gridRow;
  let hasRowInEdit: boolean = props.hasRowInEdit;
  let isHidden = props.isHidden !== undefined ? props.isHidden : false;
  let title = props.title !== undefined ? props.title : '';
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  const tableHeaderClasses =
    'flex items-center py-2.5 px-0 text-sm w-full bg-transparent border-0 md:border-b-2 border-border appearance-none focus:outline-none focus:ring-0 focus:border-border peer lg:text-base';
  let summaryHeaderPopover: any;
  __readerController.effect(
    () => [options],
    () => {
      __readerController.changed(
        (optionKeys = new Set<keyof BookStatistic>((options || []).map((option) => option.key)))
      );
    }
  );
  __readerController.effect(
    () => [options, selectionKey],
    () => {
      __readerController.changed(
        (selectedOption = options.find((option) => option.key === selectionKey)!)
      );
    }
  );
  __readerController.observeSource(
    () => lastStatisticsSummarySortProperty$,
    (value) => {
      $lastStatisticsSummarySortProperty$ = value;
    }
  );
  __readerController.observeSource(
    () => lastStatisticsSummarySortDirection$,
    (value) => {
      $lastStatisticsSummarySortDirection$ = value;
    }
  );
  const api = {
    controller: __readerController,
    get statisticsSummaryKey() {
      return statisticsSummaryKey;
    },
    set statisticsSummaryKey(nextValue: typeof statisticsSummaryKey) {
      if (Object.is(statisticsSummaryKey, nextValue)) return;
      statisticsSummaryKey = nextValue;
      __readerController.invalidate();
    },
    get options() {
      return options;
    },
    set options(nextValue: typeof options) {
      if (Object.is(options, nextValue)) return;
      options = nextValue;
      __readerController.invalidate();
    },
    get selectionKey() {
      return selectionKey;
    },
    set selectionKey(nextValue: typeof selectionKey) {
      if (Object.is(selectionKey, nextValue)) return;
      selectionKey = nextValue;
      __readerController.invalidate();
    },
    get gridRow() {
      return gridRow;
    },
    set gridRow(nextValue: typeof gridRow) {
      if (Object.is(gridRow, nextValue)) return;
      gridRow = nextValue;
      __readerController.invalidate();
    },
    get hasRowInEdit() {
      return hasRowInEdit;
    },
    set hasRowInEdit(nextValue: typeof hasRowInEdit) {
      if (Object.is(hasRowInEdit, nextValue)) return;
      hasRowInEdit = nextValue;
      __readerController.invalidate();
    },
    get isHidden() {
      return isHidden;
    },
    set isHidden(nextValue: typeof isHidden) {
      if (Object.is(isHidden, nextValue)) return;
      isHidden = nextValue;
      __readerController.invalidate();
    },
    get title() {
      return title;
    },
    set title(nextValue: typeof title) {
      if (Object.is(title, nextValue)) return;
      title = nextValue;
      __readerController.invalidate();
    },
    get dispatch() {
      return dispatch;
    },
    get tableHeaderClasses() {
      return tableHeaderClasses;
    },
    get summaryHeaderPopover() {
      return summaryHeaderPopover;
    },
    set summaryHeaderPopover(nextValue: typeof summaryHeaderPopover) {
      if (Object.is(summaryHeaderPopover, nextValue)) return;
      summaryHeaderPopover = nextValue;
      __readerController.invalidate();
    },
    get optionKeys() {
      return optionKeys;
    },
    set optionKeys(nextValue: typeof optionKeys) {
      if (Object.is(optionKeys, nextValue)) return;
      optionKeys = nextValue;
      __readerController.invalidate();
    },
    get selectedOption() {
      return selectedOption;
    },
    set selectedOption(nextValue: typeof selectedOption) {
      if (Object.is(selectedOption, nextValue)) return;
      selectedOption = nextValue;
      __readerController.invalidate();
    },
    get $lastStatisticsSummarySortProperty$() {
      return $lastStatisticsSummarySortProperty$;
    },
    set $lastStatisticsSummarySortProperty$(nextValue: typeof $lastStatisticsSummarySortProperty$) {
      writeStore(lastStatisticsSummarySortProperty$, nextValue);
    },
    get $lastStatisticsSummarySortDirection$() {
      return $lastStatisticsSummarySortDirection$;
    },
    set $lastStatisticsSummarySortDirection$(
      nextValue: typeof $lastStatisticsSummarySortDirection$
    ) {
      writeStore(lastStatisticsSummarySortDirection$, nextValue);
    },
    updateProps(next: Record<string, unknown>) {
      if ('statisticsSummaryKey' in next)
        api.statisticsSummaryKey = next.statisticsSummaryKey as typeof statisticsSummaryKey;
      if ('options' in next) api.options = next.options as typeof options;
      if ('selectionKey' in next) api.selectionKey = next.selectionKey as typeof selectionKey;
      if ('gridRow' in next) api.gridRow = next.gridRow as typeof gridRow;
      if ('hasRowInEdit' in next) api.hasRowInEdit = next.hasRowInEdit as typeof hasRowInEdit;
      if ('isHidden' in next) api.isHidden = next.isHidden as typeof isHidden;
      if ('title' in next) api.title = next.title as typeof title;
    }
  };
  return api;
}
