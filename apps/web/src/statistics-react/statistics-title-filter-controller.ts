/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  preFilteredBookKeysForStatistics$,
  preFilteredTitlesForStatistics$,
  type StatisticsTitleFilterItem
} from '../lib/components/statistics/statistics-types';
import {
  lastStatisticsFilterDateRangeOnly$,
  lastStatisticsFilterShowSelectedTitlesOnly$,
  skipKeyDownListener$
} from '$lib/data/store';
import {
  filterStatisticsTitles,
  setMatchingStatisticsTitleSelection,
  statisticsTitlePage
} from '../lib/components/statistics/title-filter-model';
import {
  ReaderController,
  readerTick,
  writeStore,
  type StoreValue
} from '../reader-react/controller';

export interface StatisticsTitleFilterProps {
  statisticsTitleFilters: Map<string, boolean>;
  titlesInStatisticsDateRange: Set<string>;
}

export function createStatisticsTitleFilter(
  props: StatisticsTitleFilterProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let filteredTitles: StatisticsTitleFilterItem[];
  let current: ReturnType<typeof statisticsTitlePage<StatisticsTitleFilterItem>>;
  let $lastStatisticsFilterDateRangeOnly$: StoreValue<typeof lastStatisticsFilterDateRangeOnly$> =
    __readerController.read(lastStatisticsFilterDateRangeOnly$);
  let $lastStatisticsFilterShowSelectedTitlesOnly$: StoreValue<
    typeof lastStatisticsFilterShowSelectedTitlesOnly$
  > = __readerController.read(lastStatisticsFilterShowSelectedTitlesOnly$);
  let $skipKeyDownListener$: StoreValue<typeof skipKeyDownListener$> =
    __readerController.read(skipKeyDownListener$);
  let $preFilteredTitlesForStatistics$: StoreValue<typeof preFilteredTitlesForStatistics$> =
    __readerController.read(preFilteredTitlesForStatistics$);
  let $preFilteredBookKeysForStatistics$: StoreValue<typeof preFilteredBookKeysForStatistics$> =
    __readerController.read(preFilteredBookKeysForStatistics$);
  let statisticsTitleFilters: Map<string, boolean> = props.statisticsTitleFilters;
  let titlesInStatisticsDateRange: Set<string> = props.titlesInStatisticsDateRange;
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  let titleFilter = '';
  let page = 1;
  let titleList: HTMLDivElement | null = null;
  let titlesToFilter: StatisticsTitleFilterItem[] = [];
  __readerController.effect(
    () => [statisticsTitleFilters],
    () => {
      __readerController.changed(
        (titlesToFilter = [...statisticsTitleFilters].map(([title, isSelected]) => ({
          title,
          isSelected
        })))
      );
    }
  );
  __readerController.effect(
    () => [
      titlesToFilter,
      titleFilter,
      titlesInStatisticsDateRange,
      $lastStatisticsFilterDateRangeOnly$,
      $lastStatisticsFilterShowSelectedTitlesOnly$
    ],
    () => {
      __readerController.changed(
        (filteredTitles = filterStatisticsTitles(
          titlesToFilter,
          titleFilter,
          titlesInStatisticsDateRange,
          $lastStatisticsFilterDateRangeOnly$,
          $lastStatisticsFilterShowSelectedTitlesOnly$
        ))
      );
    }
  );
  __readerController.effect(
    () => [filteredTitles, page],
    () => {
      __readerController.changed((current = statisticsTitlePage(filteredTitles, page)));
    }
  );
  __readerController.onMount(() => {
    writeStore(skipKeyDownListener$, true);
    return () => {
      writeStore(skipKeyDownListener$, false);
    };
  });
  async function changePage(nextPage: number) {
    const query = titleFilter;
    __readerController.changed((page = nextPage));
    await readerTick();
    if (page !== nextPage || titleFilter !== query) return;
    const first = titleList?.querySelector<HTMLInputElement>('input[type=checkbox]');
    if (!first?.isConnected) return;
    // A page can be taller than the sheet. Do not leave the user at its
    // last row after Next; move keyboard focus into the new page too.
    first.focus({ preventScroll: true });
    first.scrollIntoView({ block: 'nearest' });
  }
  function selectTitle(title: string, isSelected: boolean) {
    __readerController.changed(
      (titlesToFilter = titlesToFilter.map((item) =>
        item.title === title ? { ...item, isSelected } : item
      ))
    );
    __readerController.changed((page = current.page));
  }
  function selectMatching(isSelected: boolean) {
    __readerController.changed(
      (titlesToFilter = setMatchingStatisticsTitleSelection(
        titlesToFilter,
        filteredTitles,
        isSelected
      ))
    );
    __readerController.changed((page = 1));
  }
  __readerController.observeSource(
    () => lastStatisticsFilterDateRangeOnly$,
    (value) => {
      $lastStatisticsFilterDateRangeOnly$ = value;
    }
  );
  __readerController.observeSource(
    () => lastStatisticsFilterShowSelectedTitlesOnly$,
    (value) => {
      $lastStatisticsFilterShowSelectedTitlesOnly$ = value;
    }
  );
  __readerController.observeSource(
    () => skipKeyDownListener$,
    (value) => {
      $skipKeyDownListener$ = value;
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
  const api = {
    controller: __readerController,
    changePage,
    selectTitle,
    selectMatching,
    get statisticsTitleFilters() {
      return statisticsTitleFilters;
    },
    set statisticsTitleFilters(nextValue: typeof statisticsTitleFilters) {
      if (Object.is(statisticsTitleFilters, nextValue)) return;
      statisticsTitleFilters = nextValue;
      __readerController.invalidate();
    },
    get titlesInStatisticsDateRange() {
      return titlesInStatisticsDateRange;
    },
    set titlesInStatisticsDateRange(nextValue: typeof titlesInStatisticsDateRange) {
      if (Object.is(titlesInStatisticsDateRange, nextValue)) return;
      titlesInStatisticsDateRange = nextValue;
      __readerController.invalidate();
    },
    get dispatch() {
      return dispatch;
    },
    get titleFilter() {
      return titleFilter;
    },
    set titleFilter(nextValue: typeof titleFilter) {
      if (Object.is(titleFilter, nextValue)) return;
      titleFilter = nextValue;
      __readerController.invalidate();
    },
    get page() {
      return page;
    },
    set page(nextValue: typeof page) {
      if (Object.is(page, nextValue)) return;
      page = nextValue;
      __readerController.invalidate();
    },
    get titleList() {
      return titleList;
    },
    set titleList(nextValue: typeof titleList) {
      if (Object.is(titleList, nextValue)) return;
      titleList = nextValue;
      __readerController.invalidate();
    },
    get titlesToFilter() {
      return titlesToFilter;
    },
    set titlesToFilter(nextValue: typeof titlesToFilter) {
      if (Object.is(titlesToFilter, nextValue)) return;
      titlesToFilter = nextValue;
      __readerController.invalidate();
    },
    get filteredTitles() {
      return filteredTitles;
    },
    set filteredTitles(nextValue: typeof filteredTitles) {
      if (Object.is(filteredTitles, nextValue)) return;
      filteredTitles = nextValue;
      __readerController.invalidate();
    },
    get current() {
      return current;
    },
    set current(nextValue: typeof current) {
      if (Object.is(current, nextValue)) return;
      current = nextValue;
      __readerController.invalidate();
    },
    get $lastStatisticsFilterDateRangeOnly$() {
      return $lastStatisticsFilterDateRangeOnly$;
    },
    set $lastStatisticsFilterDateRangeOnly$(nextValue: typeof $lastStatisticsFilterDateRangeOnly$) {
      writeStore(lastStatisticsFilterDateRangeOnly$, nextValue);
    },
    get $lastStatisticsFilterShowSelectedTitlesOnly$() {
      return $lastStatisticsFilterShowSelectedTitlesOnly$;
    },
    set $lastStatisticsFilterShowSelectedTitlesOnly$(
      nextValue: typeof $lastStatisticsFilterShowSelectedTitlesOnly$
    ) {
      writeStore(lastStatisticsFilterShowSelectedTitlesOnly$, nextValue);
    },
    get $skipKeyDownListener$() {
      return $skipKeyDownListener$;
    },
    set $skipKeyDownListener$(nextValue: typeof $skipKeyDownListener$) {
      writeStore(skipKeyDownListener$, nextValue);
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
    updateProps(next: Record<string, unknown>) {
      if ('statisticsTitleFilters' in next)
        api.statisticsTitleFilters = next.statisticsTitleFilters as typeof statisticsTitleFilters;
      if ('titlesInStatisticsDateRange' in next)
        api.titlesInStatisticsDateRange =
          next.titlesInStatisticsDateRange as typeof titlesInStatisticsDateRange;
    }
  };
  return api;
}
