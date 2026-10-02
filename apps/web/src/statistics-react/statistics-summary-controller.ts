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
  StatisticsSummaryKey,
  type StatisticsDataSourceChange,
  type StatisticsDeleteRequest
} from '$lib/components/statistics/statistics-summary/statistics-summary';
import {
  type BookStatistic,
  StatisticsReadingDataAggregationMode
} from '$lib/components/statistics/statistics-types';

import { SortDirection } from '$lib/data/sort-types';
import {
  lastBlurredTrackerItems$,
  lastCharactersDataSource$,
  lastPrimaryReadingDataAggregationMode$,
  lastReadingSpeedDataSource$,
  lastReadingTimeDataSource$,
  lastStatisticsEndDate$,
  lastStatisticsStartDate$,
  lastStatisticsSummarySortDirection$,
  lastStatisticsSummarySortProperty$
} from '$lib/data/store';

import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
import { convertRemToPixels, getFullHeight, limitToRange } from '$lib/functions/utils';
import { debounceTime, fromEvent, tap } from 'rxjs';
import {
  ReaderController,
  readerTick,
  writeStore,
  type StoreValue
} from '../reader-react/controller';

export interface StatisticsSummaryProps {
  aggregratedStatistics: BookStatistic[];
  statisticsDateRangeLabel: string;
}

export function createStatisticsSummary(
  props: StatisticsSummaryProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let statisticsSummaryPageLabel: any;
  let statisticsSummaryPages: number[];
  let $lastPrimaryReadingDataAggregationMode$: StoreValue<
    typeof lastPrimaryReadingDataAggregationMode$
  > = __readerController.read(lastPrimaryReadingDataAggregationMode$);
  let $lastReadingTimeDataSource$: StoreValue<typeof lastReadingTimeDataSource$> =
    __readerController.read(lastReadingTimeDataSource$);
  let $lastCharactersDataSource$: StoreValue<typeof lastCharactersDataSource$> =
    __readerController.read(lastCharactersDataSource$);
  let $lastReadingSpeedDataSource$: StoreValue<typeof lastReadingSpeedDataSource$> =
    __readerController.read(lastReadingSpeedDataSource$);
  let $lastStatisticsSummarySortProperty$: StoreValue<typeof lastStatisticsSummarySortProperty$> =
    __readerController.read(lastStatisticsSummarySortProperty$);
  let $lastStatisticsStartDate$: StoreValue<typeof lastStatisticsStartDate$> =
    __readerController.read(lastStatisticsStartDate$);
  let $lastStatisticsEndDate$: StoreValue<typeof lastStatisticsEndDate$> =
    __readerController.read(lastStatisticsEndDate$);
  let $lastStatisticsSummarySortDirection$: StoreValue<typeof lastStatisticsSummarySortDirection$> =
    __readerController.read(lastStatisticsSummarySortDirection$);
  let $resizeHandler$: StoreValue<typeof resizeHandler$> = undefined as never;
  let $lastBlurredTrackerItems$: StoreValue<typeof lastBlurredTrackerItems$> =
    __readerController.read(lastBlurredTrackerItems$);
  let aggregratedStatistics: BookStatistic[] = props.aggregratedStatistics;
  let statisticsDateRangeLabel: string = props.statisticsDateRangeLabel;
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  const statisticsSummaryBaseRowRem = 3;
  const statisticsSummaryBaseRowGap = 1.5;
  let renderFullStatisticsSummaryTable = window && window.matchMedia('(min-width: 768px)').matches;
  let statisticsSummaryTableContainerElm: HTMLElement | null = null;
  let statisticsSummaryPopover: any;
  let statisticsSummaryButtonContainer: HTMLElement | null = null;
  let statisticsData: BookStatistic[] = [];
  let currentStatisticsSummaryRows: BookStatistic[] = [];
  let statisticsSummaryGridRowMod = 0;
  let statisticsSummaryMaxPages = 0;
  let currentStatisticsSummaryPage = 1;
  let rowsPerStatisticsSummaryPage = 0;
  const statisticsSummaryPageRefs: Array<HTMLButtonElement | null> = [];
  let statisticsSummaryPagesContainer: HTMLElement | null = null;
  let statisticsSummaryPopoverDetails: string[] = [];
  let rowInEdit: BookStatistic | undefined;
  let rowInEditTime: number | undefined = 0;
  let rowInEditCharacters: number | undefined = 0;
  let rowInEditResetMinMaxValues = false;
  const resizeHandler$ = fromEvent(window, 'resize').pipe(
    debounceTime(250),
    tap(() => {
      __readerController.changed(
        (renderFullStatisticsSummaryTable =
          window && window.matchMedia('(min-width: 768px)').matches)
      );
      updateRowsPerPage(false);
    }),
    reduceToEmptyString()
  );
  __readerController.effect(
    () => [currentStatisticsSummaryPage, statisticsSummaryMaxPages],
    () => {
      __readerController.changed(
        (statisticsSummaryPageLabel = `PAGE ${currentStatisticsSummaryPage} / ${statisticsSummaryMaxPages}`)
      );
    }
  );
  __readerController.effect(
    () => [statisticsSummaryMaxPages],
    () => {
      __readerController.changed(
        (statisticsSummaryPages = Array.apply(null, Array(statisticsSummaryMaxPages)).map(
          (_, index) => index + 1
        ))
      );
    }
  );
  __readerController.effect(
    () => [currentStatisticsSummaryPage],
    () => {
      updateTableData(false, currentStatisticsSummaryPage);
    }
  );
  __readerController.effect(
    () => [$lastPrimaryReadingDataAggregationMode$],
    () => {
      updateFilterAndSort($lastPrimaryReadingDataAggregationMode$);
    }
  );
  __readerController.effect(
    () => [aggregratedStatistics],
    () => {
      if (aggregratedStatistics) {
        setRowInEditMode();
        __readerController.changed((statisticsData = [...aggregratedStatistics]));
        updateRowsPerPage();
      }
    }
  );
  __readerController.effect(
    () => [
      $lastReadingTimeDataSource$,
      $lastCharactersDataSource$,
      $lastReadingSpeedDataSource$,
      $lastStatisticsSummarySortProperty$
    ],
    () => {
      if (
        $lastReadingTimeDataSource$ ||
        $lastCharactersDataSource$ ||
        $lastReadingSpeedDataSource$ ||
        $lastStatisticsSummarySortProperty$
      ) {
        let valueToSet: keyof BookStatistic | undefined;
        switch ($lastStatisticsSummarySortProperty$) {
          case 'readingTime':
          case 'averageReadingTime':
          case 'averageWeightedReadingTime':
            if ($lastStatisticsSummarySortProperty$ !== $lastReadingTimeDataSource$) {
              valueToSet = $lastReadingTimeDataSource$;
            }
            break;
          case 'charactersRead':
          case 'averageCharactersRead':
          case 'averageWeightedCharactersRead':
            if ($lastStatisticsSummarySortProperty$ !== $lastCharactersDataSource$) {
              valueToSet = $lastCharactersDataSource$;
            }
            break;
          case 'lastReadingSpeed':
          case 'minReadingSpeed':
          case 'altMinReadingSpeed':
          case 'maxReadingSpeed':
            if ($lastStatisticsSummarySortProperty$ !== $lastReadingSpeedDataSource$) {
              valueToSet = $lastReadingSpeedDataSource$;
            }
            break;
          default:
            break;
        }
        if (valueToSet) {
          writeStore(lastStatisticsSummarySortProperty$, valueToSet);
        }
        updateTableData();
      }
    }
  );
  function dispatchDeleteRequest(row: BookStatistic) {
    const request: StatisticsDeleteRequest = {
      startDate: '',
      endDate: '',
      titlesToCheck: new Set<string>()
    };
    if ($lastPrimaryReadingDataAggregationMode$ === StatisticsReadingDataAggregationMode.NONE) {
      request.startDate = row.dateKey;
      request.endDate = row.dateKey;
      request.titlesToCheck.add(row.title);
      request.bookKey = row.bookKey;
    } else if (
      $lastPrimaryReadingDataAggregationMode$ === StatisticsReadingDataAggregationMode.DATE
    ) {
      request.startDate = row.dateKey;
      request.endDate = row.dateKey;
    } else {
      request.startDate = $lastStatisticsStartDate$;
      request.endDate = $lastStatisticsEndDate$;
      request.titlesToCheck.add(row.title);
    }
    dispatch('delete', request);
  }
  function handlePropertyChange({
    detail: { property, statisticsSummaryKey }
  }: CustomEvent<StatisticsDataSourceChange>) {
    switch (statisticsSummaryKey) {
      case StatisticsSummaryKey.READING_TIME:
        writeStore(lastReadingTimeDataSource$, property);
        break;
      case StatisticsSummaryKey.CHARACTERS:
        writeStore(lastCharactersDataSource$, property);
        break;
      case StatisticsSummaryKey.READING_SPEED:
        writeStore(lastReadingSpeedDataSource$, property);
        break;
      default:
        break;
    }
    const wasSameProperty = property === $lastStatisticsSummarySortProperty$;
    if (wasSameProperty) {
      writeStore(
        lastStatisticsSummarySortDirection$,
        $lastStatisticsSummarySortDirection$ === SortDirection.ASC
          ? SortDirection.DESC
          : SortDirection.ASC
      );
    }
    writeStore(lastStatisticsSummarySortProperty$, property);
    if (wasSameProperty) {
      updateTableData();
    }
  }
  function updateRowsPerPage(executeSort = true) {
    readerTick().then(() => {
      if (__readerController.disposed) return;
      const table = statisticsSummaryTableContainerElm;
      const buttons = statisticsSummaryButtonContainer;
      __readerController.changed(
        (rowsPerStatisticsSummaryPage =
          renderFullStatisticsSummaryTable && table && buttons
            ? Math.max(
                1,
                Math.ceil(
                  (getFullHeight(window, table) - getFullHeight(window, buttons, true)) /
                    convertRemToPixels(
                      window,
                      statisticsSummaryBaseRowRem + statisticsSummaryBaseRowGap + 0.4
                    )
                )
              )
            : 1)
      );
      updatePageData(executeSort);
    });
  }
  function updatePageData(executeSort: boolean, newPage?: number) {
    __readerController.changed(
      (statisticsSummaryMaxPages = Math.ceil(statisticsData.length / rowsPerStatisticsSummaryPage))
    );
    __readerController.changed(
      (currentStatisticsSummaryPage = newPage
        ? limitToRange(1, statisticsSummaryMaxPages, newPage)
        : limitToRange(1, statisticsSummaryMaxPages, currentStatisticsSummaryPage))
    );
    updateTableData(executeSort);
  }
  function updateTableData(executeSort = true, pageNumber = currentStatisticsSummaryPage) {
    if (!pageNumber) {
      return;
    }
    if (executeSort) {
      applyTableSort();
    }
    const currenPageStart = (pageNumber - 1) * rowsPerStatisticsSummaryPage;
    __readerController.changed(
      (currentStatisticsSummaryRows = statisticsData.slice(
        currenPageStart,
        currenPageStart + rowsPerStatisticsSummaryPage
      ))
    );
  }
  function applyTableSort() {
    statisticsData.sort(sortTable);
    __readerController.changed((statisticsData = [...statisticsData]));
  }
  function sortTable(row1: BookStatistic, row2: BookStatistic) {
    const isTitleSort = $lastStatisticsSummarySortProperty$ === 'title';
    const isDateKeySort = $lastStatisticsSummarySortProperty$ === 'dateKey';
    const row1Prop = row1[$lastStatisticsSummarySortProperty$] || (isTitleSort ? '' : 0);
    const row2Prop = row2[$lastStatisticsSummarySortProperty$] || (isTitleSort ? '' : 0);
    let sortDiff = 0;
    if ($lastStatisticsSummarySortDirection$ === SortDirection.ASC) {
      if (isTitleSort) {
        sortDiff = row1.title.localeCompare(row2.title, 'ja-JP', { numeric: true });
      } else if (isDateKeySort) {
        if (row1Prop === row2Prop) {
          sortDiff = 0;
        } else {
          sortDiff = row1Prop > row2Prop ? 1 : -1;
        }
      } else {
        sortDiff = +row1Prop - +row2Prop;
      }
    } else if (isTitleSort) {
      sortDiff = row2.title.localeCompare(row1.title, 'ja-JP', { numeric: true });
    } else if (isDateKeySort) {
      if (row1Prop === row2Prop) {
        sortDiff = 0;
      } else {
        sortDiff = row2Prop > row1Prop ? 1 : -1;
      }
    } else {
      sortDiff = +row2Prop - +row1Prop;
    }
    if (!sortDiff) {
      sortDiff = row1.title.localeCompare(row2.title, 'ja-JP', { numeric: true });
    }
    return sortDiff;
  }
  function updateFilterAndSort(aggregrationMode: StatisticsReadingDataAggregationMode) {
    setRowInEditMode();
    switch (aggregrationMode) {
      case StatisticsReadingDataAggregationMode.DATE:
        if ($lastStatisticsSummarySortProperty$ === 'title') {
          writeStore(lastStatisticsSummarySortProperty$, 'readingTime');
        }
        break;
      case StatisticsReadingDataAggregationMode.TITLE:
        if ($lastStatisticsSummarySortProperty$ === 'dateKey') {
          writeStore(lastStatisticsSummarySortProperty$, 'readingTime');
        }
        break;
      default:
        writeStore(lastReadingTimeDataSource$, 'readingTime');
        break;
    }
    __readerController.changed(
      (statisticsSummaryGridRowMod =
        aggregrationMode === StatisticsReadingDataAggregationMode.NONE ? 0 : 1)
    );
  }
  function setRowInEditMode(row?: BookStatistic) {
    if (row) {
      __readerController.changed((rowInEditTime = row.readingTime));
      __readerController.changed((rowInEditCharacters = row.charactersRead));
      __readerController.changed((rowInEditResetMinMaxValues = false));
      __readerController.changed((rowInEdit = row));
    } else {
      __readerController.changed((rowInEdit = undefined));
      __readerController.changed((rowInEditTime = 0));
      __readerController.changed((rowInEditCharacters = 0));
      __readerController.changed((rowInEditResetMinMaxValues = false));
    }
  }
  __readerController.observeSource(
    () => lastPrimaryReadingDataAggregationMode$,
    (value) => {
      $lastPrimaryReadingDataAggregationMode$ = value;
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
    () => lastStatisticsSummarySortProperty$,
    (value) => {
      $lastStatisticsSummarySortProperty$ = value;
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
    () => lastStatisticsSummarySortDirection$,
    (value) => {
      $lastStatisticsSummarySortDirection$ = value;
    }
  );
  __readerController.observeSource(
    () => resizeHandler$,
    (value) => {
      $resizeHandler$ = value;
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
    dispatchDeleteRequest,
    handlePropertyChange,
    updateRowsPerPage,
    updatePageData,
    updateTableData,
    applyTableSort,
    sortTable,
    updateFilterAndSort,
    setRowInEditMode,
    get aggregratedStatistics() {
      return aggregratedStatistics;
    },
    set aggregratedStatistics(nextValue: typeof aggregratedStatistics) {
      if (Object.is(aggregratedStatistics, nextValue)) return;
      aggregratedStatistics = nextValue;
      __readerController.invalidate();
    },
    get statisticsDateRangeLabel() {
      return statisticsDateRangeLabel;
    },
    set statisticsDateRangeLabel(nextValue: typeof statisticsDateRangeLabel) {
      if (Object.is(statisticsDateRangeLabel, nextValue)) return;
      statisticsDateRangeLabel = nextValue;
      __readerController.invalidate();
    },
    get dispatch() {
      return dispatch;
    },
    get statisticsSummaryBaseRowRem() {
      return statisticsSummaryBaseRowRem;
    },
    get statisticsSummaryBaseRowGap() {
      return statisticsSummaryBaseRowGap;
    },
    get renderFullStatisticsSummaryTable() {
      return renderFullStatisticsSummaryTable;
    },
    set renderFullStatisticsSummaryTable(nextValue: typeof renderFullStatisticsSummaryTable) {
      if (Object.is(renderFullStatisticsSummaryTable, nextValue)) return;
      renderFullStatisticsSummaryTable = nextValue;
      __readerController.invalidate();
    },
    get statisticsSummaryTableContainerElm() {
      return statisticsSummaryTableContainerElm;
    },
    set statisticsSummaryTableContainerElm(nextValue: typeof statisticsSummaryTableContainerElm) {
      if (Object.is(statisticsSummaryTableContainerElm, nextValue)) return;
      statisticsSummaryTableContainerElm = nextValue;
      __readerController.invalidate();
    },
    get statisticsSummaryPopover() {
      return statisticsSummaryPopover;
    },
    set statisticsSummaryPopover(nextValue: typeof statisticsSummaryPopover) {
      if (Object.is(statisticsSummaryPopover, nextValue)) return;
      statisticsSummaryPopover = nextValue;
      __readerController.invalidate();
    },
    get statisticsSummaryButtonContainer() {
      return statisticsSummaryButtonContainer;
    },
    set statisticsSummaryButtonContainer(nextValue: typeof statisticsSummaryButtonContainer) {
      if (Object.is(statisticsSummaryButtonContainer, nextValue)) return;
      statisticsSummaryButtonContainer = nextValue;
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
    get currentStatisticsSummaryRows() {
      return currentStatisticsSummaryRows;
    },
    set currentStatisticsSummaryRows(nextValue: typeof currentStatisticsSummaryRows) {
      if (Object.is(currentStatisticsSummaryRows, nextValue)) return;
      currentStatisticsSummaryRows = nextValue;
      __readerController.invalidate();
    },
    get statisticsSummaryGridRowMod() {
      return statisticsSummaryGridRowMod;
    },
    set statisticsSummaryGridRowMod(nextValue: typeof statisticsSummaryGridRowMod) {
      if (Object.is(statisticsSummaryGridRowMod, nextValue)) return;
      statisticsSummaryGridRowMod = nextValue;
      __readerController.invalidate();
    },
    get statisticsSummaryMaxPages() {
      return statisticsSummaryMaxPages;
    },
    set statisticsSummaryMaxPages(nextValue: typeof statisticsSummaryMaxPages) {
      if (Object.is(statisticsSummaryMaxPages, nextValue)) return;
      statisticsSummaryMaxPages = nextValue;
      __readerController.invalidate();
    },
    get currentStatisticsSummaryPage() {
      return currentStatisticsSummaryPage;
    },
    set currentStatisticsSummaryPage(nextValue: typeof currentStatisticsSummaryPage) {
      if (Object.is(currentStatisticsSummaryPage, nextValue)) return;
      currentStatisticsSummaryPage = nextValue;
      __readerController.invalidate();
    },
    get rowsPerStatisticsSummaryPage() {
      return rowsPerStatisticsSummaryPage;
    },
    set rowsPerStatisticsSummaryPage(nextValue: typeof rowsPerStatisticsSummaryPage) {
      if (Object.is(rowsPerStatisticsSummaryPage, nextValue)) return;
      rowsPerStatisticsSummaryPage = nextValue;
      __readerController.invalidate();
    },
    get statisticsSummaryPageRefs() {
      return statisticsSummaryPageRefs;
    },
    get statisticsSummaryPagesContainer() {
      return statisticsSummaryPagesContainer;
    },
    set statisticsSummaryPagesContainer(nextValue: typeof statisticsSummaryPagesContainer) {
      if (Object.is(statisticsSummaryPagesContainer, nextValue)) return;
      statisticsSummaryPagesContainer = nextValue;
      __readerController.invalidate();
    },
    get statisticsSummaryPopoverDetails() {
      return statisticsSummaryPopoverDetails;
    },
    set statisticsSummaryPopoverDetails(nextValue: typeof statisticsSummaryPopoverDetails) {
      if (Object.is(statisticsSummaryPopoverDetails, nextValue)) return;
      statisticsSummaryPopoverDetails = nextValue;
      __readerController.invalidate();
    },
    get rowInEdit() {
      return rowInEdit;
    },
    set rowInEdit(nextValue: typeof rowInEdit) {
      if (Object.is(rowInEdit, nextValue)) return;
      rowInEdit = nextValue;
      __readerController.invalidate();
    },
    get rowInEditTime() {
      return rowInEditTime;
    },
    set rowInEditTime(nextValue: typeof rowInEditTime) {
      if (Object.is(rowInEditTime, nextValue)) return;
      rowInEditTime = nextValue;
      __readerController.invalidate();
    },
    get rowInEditCharacters() {
      return rowInEditCharacters;
    },
    set rowInEditCharacters(nextValue: typeof rowInEditCharacters) {
      if (Object.is(rowInEditCharacters, nextValue)) return;
      rowInEditCharacters = nextValue;
      __readerController.invalidate();
    },
    get rowInEditResetMinMaxValues() {
      return rowInEditResetMinMaxValues;
    },
    set rowInEditResetMinMaxValues(nextValue: typeof rowInEditResetMinMaxValues) {
      if (Object.is(rowInEditResetMinMaxValues, nextValue)) return;
      rowInEditResetMinMaxValues = nextValue;
      __readerController.invalidate();
    },
    get resizeHandler$() {
      return resizeHandler$;
    },
    get statisticsSummaryPageLabel() {
      return statisticsSummaryPageLabel;
    },
    set statisticsSummaryPageLabel(nextValue: typeof statisticsSummaryPageLabel) {
      if (Object.is(statisticsSummaryPageLabel, nextValue)) return;
      statisticsSummaryPageLabel = nextValue;
      __readerController.invalidate();
    },
    get statisticsSummaryPages() {
      return statisticsSummaryPages;
    },
    set statisticsSummaryPages(nextValue: typeof statisticsSummaryPages) {
      if (Object.is(statisticsSummaryPages, nextValue)) return;
      statisticsSummaryPages = nextValue;
      __readerController.invalidate();
    },
    get $lastPrimaryReadingDataAggregationMode$() {
      return $lastPrimaryReadingDataAggregationMode$;
    },
    set $lastPrimaryReadingDataAggregationMode$(
      nextValue: typeof $lastPrimaryReadingDataAggregationMode$
    ) {
      writeStore(lastPrimaryReadingDataAggregationMode$, nextValue);
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
    get $lastStatisticsSummarySortProperty$() {
      return $lastStatisticsSummarySortProperty$;
    },
    set $lastStatisticsSummarySortProperty$(nextValue: typeof $lastStatisticsSummarySortProperty$) {
      writeStore(lastStatisticsSummarySortProperty$, nextValue);
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
    get $lastStatisticsSummarySortDirection$() {
      return $lastStatisticsSummarySortDirection$;
    },
    set $lastStatisticsSummarySortDirection$(
      nextValue: typeof $lastStatisticsSummarySortDirection$
    ) {
      writeStore(lastStatisticsSummarySortDirection$, nextValue);
    },
    get $resizeHandler$() {
      return $resizeHandler$;
    },
    get $lastBlurredTrackerItems$() {
      return $lastBlurredTrackerItems$;
    },
    set $lastBlurredTrackerItems$(nextValue: typeof $lastBlurredTrackerItems$) {
      writeStore(lastBlurredTrackerItems$, nextValue);
    },
    updateProps(next: Record<string, unknown>) {
      if ('aggregratedStatistics' in next)
        api.aggregratedStatistics = next.aggregratedStatistics as typeof aggregratedStatistics;
      if ('statisticsDateRangeLabel' in next)
        api.statisticsDateRangeLabel =
          next.statisticsDateRangeLabel as typeof statisticsDateRangeLabel;
    }
  };
  return api;
}
