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
import { onKeyUpStatisticsTab } from '../routes/b/on-keydown-reader';
import { getDefaultStatistic } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';

import type {
  StatisticsDeleteRequest,
  StatisticsEditRequest
} from '$lib/components/statistics/statistics-summary/statistics-summary';
import {
  type BookStatistic,
  StatisticsReadingDataAggregationMode,
  statisticsRangeTemplates,
  copyStatisticsData$,
  statisticsTitleFilterEnabled$,
  statisticsTitleFilterIsOpen$,
  type StatisticsTitleFilterItem,
  preFilteredTitlesForStatistics$,
  preFilteredBookKeysForStatistics$,
  statisticsDataAggregrationModes,
  exportStatisticsData$,
  exportRawStatistics$,
  statisticsActionInProgress$,
  deleteStatisticsData$,
  setStatisticsDatesToAllTime$,
  StatisticsRangeTemplate
} from '$lib/components/statistics/statistics-types';
import type {
  BooksDbReadingGoal,
  BooksDbStatistic
} from '$lib/data/database/books-db/versions/books-db';

import {
  readStatisticsRecoverySnapshot,
  titlesWithMultipleStatisticIdentities
} from '$lib/data/database/books-db/reader-statistics';
import { logger } from '$lib/data/logger';
import { getDateRangeLabel } from '$lib/data/reading-goal';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
import {
  confirmStatisticsDeletion$,
  database,
  lastPrimaryReadingDataAggregationMode$,
  lastReadingDataHeatmapAggregationMode$,
  lastReadingGoalsHeatmapAggregationMode$,
  lastStatisticsEndDate$,
  lastStatisticsRangeTemplate$,
  lastStatisticsStartDate$,
  lastStatisticsTab$,
  skipKeyDownListener$,
  startDayHoursForTracker$,
  statisticsTabKeybindMap$
} from '$lib/data/store';
import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
import {
  getDateString,
  getNumberFromObject,
  getStartHoursDate,
  secondsToMinutes
} from '$lib/functions/statistic-util';
import { matchesStatisticsBookPrefilter } from '../lib/components/statistics/title-filter-model';
import { pluralize } from '$lib/functions/utils';
import pLimit from 'p-limit';
import { tap } from 'rxjs';
import { ReaderController, writeStore, type StoreValue } from '../reader-react/controller';
import { ConfirmDialog, MessageDialog } from '../ui/dialogs';
import { statisticsLifetime } from './lifetime';

export interface StatisticsContentProps {}

export function createStatisticsContent(
  props: StatisticsContentProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  const lifetime = statisticsLifetime(__readerController);
  const { current: isCurrent, showDialogs } = lifetime;
  let statisticsDateRangeLabel: any;
  let $lastPrimaryReadingDataAggregationMode$: StoreValue<
    typeof lastPrimaryReadingDataAggregationMode$
  > = __readerController.read(lastPrimaryReadingDataAggregationMode$);
  let $statisticsActionInProgress$: StoreValue<typeof statisticsActionInProgress$> =
    __readerController.read(statisticsActionInProgress$);
  let $lastStatisticsStartDate$: StoreValue<typeof lastStatisticsStartDate$> =
    __readerController.read(lastStatisticsStartDate$);
  let $lastStatisticsEndDate$: StoreValue<typeof lastStatisticsEndDate$> =
    __readerController.read(lastStatisticsEndDate$);
  let $lastStatisticsRangeTemplate$: StoreValue<typeof lastStatisticsRangeTemplate$> =
    __readerController.read(lastStatisticsRangeTemplate$);
  let $startDayHoursForTracker$: StoreValue<typeof startDayHoursForTracker$> =
    __readerController.read(startDayHoursForTracker$);
  let $skipKeyDownListener$: StoreValue<typeof skipKeyDownListener$> =
    __readerController.read(skipKeyDownListener$);
  let $confirmStatisticsDeletion$: StoreValue<typeof confirmStatisticsDeletion$> =
    __readerController.read(confirmStatisticsDeletion$);
  let $preFilteredTitlesForStatistics$: StoreValue<typeof preFilteredTitlesForStatistics$> =
    __readerController.read(preFilteredTitlesForStatistics$);
  let $preFilteredBookKeysForStatistics$: StoreValue<typeof preFilteredBookKeysForStatistics$> =
    __readerController.read(preFilteredBookKeysForStatistics$);
  let $statisticsTitleFilterEnabled$: StoreValue<typeof statisticsTitleFilterEnabled$> =
    __readerController.read(statisticsTitleFilterEnabled$);
  let $copyStatisticsDataHandler$: StoreValue<typeof copyStatisticsDataHandler$> =
    undefined as never;
  let $exportStatisticsDataHandler$: StoreValue<typeof exportStatisticsDataHandler$> =
    undefined as never;
  let $exportRawStatisticsHandler$: StoreValue<typeof exportRawStatisticsHandler$> =
    undefined as never;
  let $deleteStatisticsDataHandler$: StoreValue<typeof deleteStatisticsDataHandler$> =
    undefined as never;
  let $setStatisticsDatesToAllTimeHandler$: StoreValue<typeof setStatisticsDatesToAllTimeHandler$> =
    undefined as never;
  let $lastStatisticsTab$: StoreValue<typeof lastStatisticsTab$> =
    __readerController.read(lastStatisticsTab$);
  let $lastReadingDataHeatmapAggregationMode$: StoreValue<
    typeof lastReadingDataHeatmapAggregationMode$
  > = __readerController.read(lastReadingDataHeatmapAggregationMode$);
  let $lastReadingGoalsHeatmapAggregationMode$: StoreValue<
    typeof lastReadingGoalsHeatmapAggregationMode$
  > = __readerController.read(lastReadingGoalsHeatmapAggregationMode$);
  let $statisticsTitleFilterIsOpen$: StoreValue<typeof statisticsTitleFilterIsOpen$> =
    __readerController.read(statisticsTitleFilterIsOpen$);
  const copyStatisticsDataHandler$ = copyStatisticsData$.pipe(
    tap((dataKeyToCopy) => {
      const statistics =
        $lastPrimaryReadingDataAggregationMode$ === StatisticsReadingDataAggregationMode.TITLE
          ? aggregratedStatistics
          : getAggregatedStatistics(StatisticsReadingDataAggregationMode.TITLE);
      let logKey = '';
      switch (dataKeyToCopy) {
        case 'readingTime':
          logKey = 'readtime';
          break;
        default:
          logKey = 'reading';
          break;
      }
      const dataLines = [`Reading Data for ${statisticsDateRangeLabel}\n`];
      for (let index = 0, { length } = statistics; index < length; index += 1) {
        const statistic = statistics[index];
        let loggedValue = 0;
        if (dataKeyToCopy === 'readingTime') {
          loggedValue = Math.floor(secondsToMinutes(statistic.readingTime));
        } else {
          loggedValue = getNumberFromObject(statistic, dataKeyToCopy);
        }
        if (loggedValue) {
          dataLines.push(`.log ${logKey} ${loggedValue} ${statistic.title}`);
        }
      }
      if (dataLines.length > 1) {
        navigator.clipboard
          .writeText(dataLines.join('\n'))
          .catch((error) => logger.error(`Error writing to clipboard: ${error.message}`));
      }
    }),
    reduceToEmptyString()
  );
  const exportStatisticsDataHandler$ = exportStatisticsData$.pipe(
    tap((exportAllData) => {
      void lifetime.run(async () => {
        try {
          const statisticsDataToExport = new Map<string, BooksDbStatistic[]>();
          // Explicit “All” remains global. “Selection” uses the same date/title/book
          // identity projection the user is looking at.
          const selectedRows = exportAllData ? statisticsData : statisticsForSelection;
          const ambiguousTitles = titlesWithMultipleStatisticIdentities(selectedRows);
          const selectedTitles = new Set(selectedRows.map((row) => row.title));
          const unresolvedTitles = (await (await database.db).getAll('readerStatisticMigration'))
            .filter(
              (receipt) =>
                selectedTitles.has(receipt.title) &&
                (receipt.state === 'ambiguous' ||
                  (receipt.state === 'identity-conflict' && !receipt.legacyAssigned))
            )
            .map((receipt) => receipt.title);
          if (ambiguousTitles.length || unresolvedTitles.length) {
            throw new Error(
              `The TTU ZIP cannot safely identify all days for ${[...new Set([...ambiguousTitles, ...unresolvedTitles])].join(', ')}. Download raw history (JSON) to preserve every book identity and day.`
            );
          }
          for (let index = 0; index < selectedRows.length; index += 1) {
            const {
              title,
              dateKey,
              charactersRead,
              readingTime,
              minReadingSpeed,
              altMinReadingSpeed,
              lastReadingSpeed,
              maxReadingSpeed,
              lastStatisticModified,
              completedBook,
              completedData
            } = selectedRows[index];
            const entries = statisticsDataToExport.get(title) || [];
            entries.push({
              title,
              dateKey,
              charactersRead,
              readingTime,
              minReadingSpeed,
              altMinReadingSpeed,
              lastReadingSpeed,
              maxReadingSpeed,
              lastStatisticModified,
              completedBook,
              completedData
            });
            statisticsDataToExport.set(title, entries);
          }
          if (!isCurrent()) return;
          const entriesToExport = [...statisticsDataToExport.entries()];
          const backupHandler = getStorageHandler(window, StorageKey.BACKUP);
          const exportLimiter = pLimit(1);
          const exportTasks: Promise<void>[] = [];
          backupHandler.clearData();
          entriesToExport.forEach(([titleToExport, dataToExport]) =>
            exportTasks.push(
              exportLimiter(async () => {
                try {
                  if (!isCurrent()) return;
                  const lastStatisticsModified = await database.getLastModifiedForType(
                    titleToExport,
                    StorageDataType.STATISTICS
                  );
                  if (!isCurrent()) return;
                  if (dataToExport.length) {
                    backupHandler.startContext({ id: 0, title: titleToExport, imagePath: '' });
                    await backupHandler.saveStatistics(dataToExport, lastStatisticsModified);
                  }
                } catch (error) {
                  exportLimiter.clearQueue();
                  throw error;
                }
              })
            )
          );
          if (entriesToExport.length) {
            exportTasks.push(
              exportLimiter(async () => {
                if (isCurrent()) await backupHandler.createExportZip(document, false);
              })
            );
          }
          await Promise.all(exportTasks).finally(() => backupHandler.clearData());
        } catch ({ message }: any) {
          logger.error(`Failed to Export Data: ${message}`);
          showDialogs([
            {
              component: MessageDialog,
              props: { title: 'Statistics export unavailable', message }
            }
          ]);
        }
      });
    }),
    reduceToEmptyString()
  );
  const exportRawStatisticsHandler$ = exportRawStatistics$.pipe(
    tap(() => {
      void lifetime.run(async () => {
        try {
          const snapshot = await readStatisticsRecoverySnapshot(await database.db);
          if (!isCurrent()) return;
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
          );
          const link = document.createElement('a');
          link.href = url;
          link.download = `manabi-reader-statistics-recovery-${new Date()
            .toISOString()
            .slice(0, 10)}.json`;
          document.body.append(link);
          try {
            link.click();
          } finally {
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`Failed to export raw statistics: ${message}`);
          showDialogs([
            {
              component: MessageDialog,
              props: { title: 'Statistics export failed', message }
            }
          ]);
        }
      });
    }),
    reduceToEmptyString()
  );
  const deleteStatisticsDataHandler$ = deleteStatisticsData$.pipe(
    tap(async (deleteAllData) => {
      const dataList = deleteAllData ? statisticsData : statisticsForSelection;
      const request: StatisticsDeleteRequest = {
        startDate: deleteAllData ? '' : $lastStatisticsStartDate$,
        endDate: deleteAllData ? '' : $lastStatisticsEndDate$,
        titlesToCheck: new Set<string>(),
        // “Delete All” is intentionally global. Selection is already narrowed by
        // date, title and logical book identity and must not be expanded by title.
        takeAsIs: deleteAllData
      };
      for (let index = 0, { length } = dataList; index < length; index += 1) {
        request.titlesToCheck.add(dataList[index].title);
      }
      handleDeleteRequest(new CustomEvent<StatisticsDeleteRequest>('delete', { detail: request }));
    }),
    reduceToEmptyString()
  );
  const setStatisticsDatesToAllTimeHandler$ = setStatisticsDatesToAllTime$.pipe(
    tap(() => {
      if (!statisticsTitleFilters.size) {
        return;
      }
      let startDate = '';
      const available = statisticsForBookPrefilter();
      for (let index = 0, { length } = available; index < length; index += 1) {
        const statistic = available[index];
        if (statisticsTitleFilters.get(statistic.title)) {
          startDate = statistic.dateKey;
          break;
        }
      }
      if (!startDate) {
        return;
      }
      for (let index = available.length - 1; index >= 0; index -= 1) {
        const statistic = available[index];
        if (statisticsTitleFilters.get(statistic.title)) {
          writeStore(lastStatisticsStartDate$, startDate);
          writeStore(lastStatisticsEndDate$, statistic.dateKey);
          writeStore(lastStatisticsRangeTemplate$, StatisticsRangeTemplate.CUSTOM);
          break;
        }
      }
    }),
    reduceToEmptyString()
  );
  let isLoading = true;
  let today = getStartHoursDate($startDayHoursForTracker$);
  let todayKey = getDateString(today);
  let statisticsTitleFilters = new Map<string, boolean>();
  let titlesInStatisticsDateRange = new Set<string>();
  let statisticsData: BookStatistic[] = [];
  let statisticsForSelection: BookStatistic[] = [];
  let aggregratedStatistics: BookStatistic[] = [];
  let readingGoals: BooksDbReadingGoal[] = [];
  let bookPrefilterStatistics: BookStatistic[] = [];
  __readerController.effect(
    () => [statisticsData, $preFilteredBookKeysForStatistics$],
    () => {
      __readerController.changed((bookPrefilterStatistics = statisticsForBookPrefilter()));
    }
  );
  __readerController.effect(
    () => [$lastStatisticsStartDate$, $lastStatisticsEndDate$],
    () => {
      __readerController.changed(
        (statisticsDateRangeLabel = getDateRangeLabel(
          $lastStatisticsStartDate$,
          $lastStatisticsEndDate$
        ))
      );
    }
  );
  __readerController.effect(
    () => [
      statisticsData,
      $lastPrimaryReadingDataAggregationMode$,
      $lastStatisticsStartDate$,
      $lastStatisticsEndDate$,
      $startDayHoursForTracker$
    ],
    () => {
      if (
        statisticsData &&
        $lastPrimaryReadingDataAggregationMode$ &&
        $lastStatisticsStartDate$ &&
        $lastStatisticsEndDate$
      ) {
        __readerController.changed((today = getStartHoursDate($startDayHoursForTracker$)));
        __readerController.changed((todayKey = getDateString(today)));
        updateStatisticsData();
      }
    }
  );
  lifetime.signal.addEventListener('abort', () => {
    __readerController.changed((statisticsData = []));
    __readerController.changed((readingGoals = []));
    __readerController.changed((statisticsTitleFilters = new Map()));
    __readerController.changed((isLoading = false));
    updateStatisticsData();
  });
  __readerController.onMount(init);

  function onKeyUp(ev: KeyboardEvent) {
    if (
      $skipKeyDownListener$ ||
      ev.altKey ||
      ev.ctrlKey ||
      ev.shiftKey ||
      ev.metaKey ||
      ev.repeat
    ) {
      return;
    }
    const result = onKeyUpStatisticsTab(
      ev,
      statisticsTabKeybindMap$.getValue(),
      toggleStatisticsRangeTemplate,
      toggleStatisticsDataAggregationMode
    );
    if (!result) return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    ev.preventDefault();
  }
  function handleDeleteRequest(event: CustomEvent<StatisticsDeleteRequest>) {
    return lifetime.run(() => performDeleteRequest(event));
  }
  function handleEditRequest(event: CustomEvent<StatisticsEditRequest>) {
    return lifetime.run(() => performEditRequest(event));
  }
  async function performDeleteRequest({
    detail: { startDate, endDate, titlesToCheck, bookKey, takeAsIs }
  }: CustomEvent<StatisticsDeleteRequest>) {
    const titlesToDelete = new Set<string>();
    const legacyTitlesToDelete = new Set<string>();
    const bookKeysToDelete = new Set<string>();
    for (const statistic of takeAsIs ? statisticsData : statisticsForSelection) {
      if (
        (!startDate || (statistic.dateKey >= startDate && statistic.dateKey <= endDate)) &&
        (!titlesToCheck.size || titlesToCheck.has(statistic.title)) &&
        (!bookKey || statistic.bookKey === bookKey)
      ) {
        titlesToDelete.add(statistic.title);
        if (statistic.bookKey) bookKeysToDelete.add(statistic.bookKey);
        else legacyTitlesToDelete.add(statistic.title);
      }
    }
    if (!titlesToDelete.size) {
      return;
    }
    const titleLabel = pluralize(titlesToDelete.size, 'Title');
    let wasCanceled = false;
    if ($confirmStatisticsDeletion$) {
      wasCanceled = await new Promise((resolver) => {
        showDialogs([
          {
            component: ConfirmDialog,
            props: {
              dialogHeader: 'Delete Data',
              dialogMessage: `This will delete data ${startDate ? `from ${getDateRangeLabel(startDate, endDate)}` : ''}  for ${titleLabel} (which may include start and/or completion Data)\n\nExecute an one time Sync with an export behavior of "overwrite" and/or statistics merge mode of "replace" to apply deletions to other devices.\n\n${titleLabel}:\n${[
                ...titlesToDelete
              ].join('\n\n')}`,
              contentStyles: 'white-space: pre-line;max-height: 20rem;overflow: auto;',
              resolver
            },
            disableCloseOnClick: true,
            zIndex: '70'
          }
        ]);
      });
    }
    if (wasCanceled || !isCurrent()) {
      return;
    }
    const error = await database
      .deleteStatisticEntries([...legacyTitlesToDelete], false, startDate, endDate, [
        ...bookKeysToDelete
      ])
      .catch(({ message }) => message);
    if (!isCurrent()) return;
    if (error) {
      await new Promise((resolver) => {
        showDialogs([
          {
            component: ConfirmDialog,
            props: {
              dialogHeader: 'Delete Data',
              dialogMessage: `Failed to delete Data: ${error}`,
              showCancel: false,
              resolver
            },
            disableCloseOnClick: true,
            zIndex: '70'
          }
        ]);
      });
    } else {
      const filterMap = new Map<string, boolean>();
      const notDeletedMap = new Map<string, boolean>();
      __readerController.changed(
        (statisticsData = statisticsData.filter((statistic) => {
          if (
            statistic.bookKey
              ? bookKeysToDelete.has(statistic.bookKey)
              : legacyTitlesToDelete.has(statistic.title)
          ) {
            const returnValue = startDate
              ? !(statistic.dateKey >= startDate && statistic.dateKey <= endDate)
              : false;
            if (returnValue || !filterMap.get(statistic.title)) {
              filterMap.set(statistic.title, returnValue);
            }
            return returnValue;
          }
          if (statistic.readingTime) {
            notDeletedMap.set(
              statistic.title,
              statisticsTitleFilters.get(statistic.title) || false
            );
          }
          return true;
        }))
      );
      for (const title of titlesToDelete)
        filterMap.set(
          title,
          statisticsData.some((statistic) => statistic.title === title)
        );
      const preFilteredTitlesForStatistics = [...$preFilteredTitlesForStatistics$];
      for (let index = 0, { length } = preFilteredTitlesForStatistics; index < length; index += 1) {
        const preFilteredTitleForStatistics = preFilteredTitlesForStatistics[index];
        if (
          filterMap.has(preFilteredTitleForStatistics) &&
          !filterMap.get(preFilteredTitleForStatistics)
        ) {
          statisticsTitleFilters.delete(preFilteredTitleForStatistics);
          $preFilteredTitlesForStatistics$.delete(preFilteredTitleForStatistics);
        }
      }
      if ($preFilteredTitlesForStatistics$.size) {
        __readerController.changed((statisticsTitleFilters = statisticsTitleFilters));
        writeStore(preFilteredTitlesForStatistics$, $preFilteredTitlesForStatistics$);
      } else {
        const filteredEntries = [...filterMap.entries()];
        const titleFilters = [...notDeletedMap.entries()];
        const newStatisticsTitleFilterData = new Map<string, boolean>();
        for (let index = 0, { length } = filteredEntries; index < length; index += 1) {
          const [title, hasData] = filteredEntries[index];
          if (hasData) {
            newStatisticsTitleFilterData.set(title, true);
          }
        }
        for (let index = 0, { length } = titleFilters; index < length; index += 1) {
          const [title, isDisplayed] = titleFilters[index];
          newStatisticsTitleFilterData.set(title, isDisplayed);
        }
        __readerController.changed((statisticsTitleFilters = newStatisticsTitleFilterData));
      }
      updateStatisticsData();
    }
  }
  async function performEditRequest({
    detail: { dateKey, title, bookKey, newReadingTime, newCharactersRead, resetMinMaxValues }
  }: CustomEvent<StatisticsEditRequest>) {
    const statisticIndex = statisticsData.findIndex(
      (statistic) =>
        statistic.dateKey === dateKey && statistic.title === title && statistic.bookKey === bookKey
    );
    const statistic = statisticsData[statisticIndex];
    if (!statistic) return;
    const newStatistic: BookStatistic = {
      ...statistic,
      readingTime: newReadingTime,
      averageReadingTime: newReadingTime,
      averageWeightedReadingTime: newReadingTime,
      charactersRead: newCharactersRead,
      averageCharactersRead: newCharactersRead,
      averageWeightedCharactersRead: newCharactersRead,
      lastReadingSpeed: newReadingTime ? Math.ceil((3600 * newCharactersRead) / newReadingTime) : 0,
      lastStatisticModified: Date.now()
    };
    newStatistic.averageReadingSpeed = newStatistic.lastReadingSpeed;
    newStatistic.averageWeightedReadingSpeed = newStatistic.lastReadingSpeed;
    newStatistic.minReadingSpeed =
      newStatistic.minReadingSpeed && !resetMinMaxValues
        ? Math.min(newStatistic.minReadingSpeed, newStatistic.lastReadingSpeed)
        : newStatistic.lastReadingSpeed;
    newStatistic.maxReadingSpeed = resetMinMaxValues
      ? newStatistic.lastReadingSpeed
      : Math.max(newStatistic.maxReadingSpeed, newStatistic.lastReadingSpeed);
    if (newCharactersRead || resetMinMaxValues) {
      newStatistic.altMinReadingSpeed =
        newStatistic.altMinReadingSpeed && !resetMinMaxValues
          ? Math.min(newStatistic.altMinReadingSpeed, newStatistic.lastReadingSpeed)
          : newStatistic.lastReadingSpeed;
    }
    const wasCanceled = await new Promise((resolver) => {
      showDialogs([
        {
          component: ConfirmDialog,
          props: {
            dialogHeader: 'Update Data',
            dialogMessage: `This will update the Data for ${title} on ${dateKey}.\n\nTime: ${secondsToMinutes(statistic.readingTime)} min => ${secondsToMinutes(newReadingTime)} min\nCharacters: ${statistic.charactersRead} => ${newCharactersRead}\nSpeed: ${statistic.lastReadingSpeed} / h => ${newStatistic.lastReadingSpeed} / h\nMin Speed: ${statistic.minReadingSpeed} / h => ${newStatistic.minReadingSpeed} / h\nAlt Min Speed: ${statistic.altMinReadingSpeed} / h => ${newStatistic.altMinReadingSpeed} / h\nMax Speed: ${statistic.maxReadingSpeed} / h => ${newStatistic.maxReadingSpeed} / h`,
            contentStyles: 'white-space: pre-line;max-height: 20rem;overflow: auto;',
            resolver
          },
          disableCloseOnClick: true,
          zIndex: '70'
        }
      ]);
    });
    if (wasCanceled || !isCurrent()) {
      return;
    }
    try {
      await database.updateStatistic(newStatistic);
      if (!isCurrent()) return;
      __readerController.changed(
        (statisticsData[statisticIndex] = { ...statistic, ...newStatistic })
      );
      updateStatisticsData();
    } catch ({ message }: any) {
      showDialogs([
        {
          component: MessageDialog,
          props: {
            title: 'Error',
            message: `Update failed: ${message}`
          }
        }
      ]);
    }
  }
  function updateTitleFilter({
    detail: newStatisticsTitleFilters
  }: CustomEvent<StatisticsTitleFilterItem[]>) {
    const newStatisticsTitleFilterData = new Map<string, boolean>();
    for (let index = 0, { length } = newStatisticsTitleFilters; index < length; index += 1) {
      const newStatisticsTitleFilter = newStatisticsTitleFilters[index];
      newStatisticsTitleFilterData.set(
        newStatisticsTitleFilter.title,
        newStatisticsTitleFilter.isSelected
      );
    }
    __readerController.changed((statisticsTitleFilters = newStatisticsTitleFilterData));
    updateStatisticsData();
  }
  function clearPrefilter() {
    const newStatisticsTitleFilterData = new Map<string, boolean>();
    for (let index = 0, { length } = statisticsData; index < length; index += 1) {
      const statistic = statisticsData[index];
      if (statistic.readingTime) {
        newStatisticsTitleFilterData.set(statistic.title, true);
      }
    }
    __readerController.changed((statisticsTitleFilters = newStatisticsTitleFilterData));
    writeStore(preFilteredTitlesForStatistics$, new Set());
    writeStore(preFilteredBookKeysForStatistics$, new Set());
    updateStatisticsData();
  }
  function toggleStatisticsRangeTemplate() {
    let nextIndex =
      statisticsRangeTemplates.findIndex(
        (statisticsRangeTemplate) => $lastStatisticsRangeTemplate$ === statisticsRangeTemplate
      ) + 1;
    if (nextIndex >= statisticsRangeTemplates.length - 1) {
      nextIndex = 0;
    }
    writeStore(lastStatisticsRangeTemplate$, statisticsRangeTemplates[nextIndex]);
  }
  function toggleStatisticsDataAggregationMode() {
    let nextIndex =
      statisticsDataAggregrationModes.findIndex(
        (mode) => $lastPrimaryReadingDataAggregationMode$ === mode
      ) + 1;
    if (nextIndex > statisticsDataAggregrationModes.length - 1) {
      nextIndex = 0;
    }
    writeStore(lastPrimaryReadingDataAggregationMode$, statisticsDataAggregrationModes[nextIndex]);
  }
  async function init() {
    try {
      const hasPrefilteredTitlesForStatistics = !!$preFilteredTitlesForStatistics$.size;
      const bookKeyPrefilter = $preFilteredBookKeysForStatistics$;
      [statisticsData, readingGoals] = await Promise.all([
        database.getAllStatistics(),
        database.getReadingGoals()
      ]).then(([statistics, readingGoalData]) => [
        statistics.map((statistic) => {
          if (
            statistic.readingTime &&
            matchesStatisticsBookPrefilter(
              'bookKey' in statistic && typeof statistic.bookKey === 'string'
                ? statistic.bookKey
                : undefined,
              bookKeyPrefilter
            ) &&
            (!hasPrefilteredTitlesForStatistics ||
              $preFilteredTitlesForStatistics$.has(statistic.title))
          ) {
            statisticsTitleFilters.set(statistic.title, true);
          }
          return {
            ...statistic,
            ...{
              id: `${'bookKey' in statistic ? statistic.bookKey : statistic.title}_${statistic.dateKey}`,
              averageReadingTime: statistic.readingTime,
              averageWeightedReadingTime: statistic.readingTime,
              averageCharactersRead: statistic.charactersRead,
              averageWeightedCharactersRead: statistic.charactersRead,
              averageReadingSpeed: statistic.lastReadingSpeed,
              averageWeightedReadingSpeed: statistic.lastReadingSpeed
            }
          };
        }),
        readingGoalData
      ]);
    } catch ({ message }: any) {
      showDialogs([
        {
          component: MessageDialog,
          props: {
            title: 'Error',
            message: `Error getting Data: ${message}`
          }
        }
      ]);
    } finally {
      if (!isCurrent()) return;
      __readerController.changed((isLoading = false));
      writeStore(statisticsTitleFilterEnabled$, true);
    }
  }
  function statisticsForBookPrefilter() {
    return statisticsData.filter((statistic) =>
      matchesStatisticsBookPrefilter(statistic.bookKey, $preFilteredBookKeysForStatistics$)
    );
  }
  function updateStatisticsData() {
    const newTitleFilterForStatisticsSet = new Set<string>();
    __readerController.changed(
      (statisticsForSelection = statisticsData.filter((statistic) =>
        filterStatisticsForSelection(statistic, newTitleFilterForStatisticsSet)
      ))
    );
    __readerController.changed((titlesInStatisticsDateRange = newTitleFilterForStatisticsSet));
    __readerController.changed(
      (aggregratedStatistics = [
        ...getAggregatedStatistics($lastPrimaryReadingDataAggregationMode$)
      ])
    );
  }
  function getAggregatedStatistics(
    statisticsDataAggegrationMode: StatisticsReadingDataAggregationMode
  ) {
    let aggregatedStatisticsData: BookStatistic[] = [];
    if (statisticsDataAggegrationMode === StatisticsReadingDataAggregationMode.NONE) {
      aggregatedStatisticsData = statisticsForSelection;
    } else {
      const aggregationKey =
        statisticsDataAggegrationMode === StatisticsReadingDataAggregationMode.DATE
          ? 'dateKey'
          : 'title';
      const aggregrationMap = new Map<string, BookStatistic[]>();
      for (let index = 0, { length } = statisticsForSelection; index < length; index += 1) {
        const entry = statisticsForSelection[index];
        const keyValue = entry[aggregationKey];
        const entries = aggregrationMap.get(keyValue) || [];
        entries.push(entry);
        aggregrationMap.set(keyValue, entries);
      }
      const aggregationKeys = [...aggregrationMap.keys()];
      for (let index = 0, { length } = aggregationKeys; index < length; index += 1) {
        const key = aggregationKeys[index];
        const entries = aggregrationMap.get(key) || [];
        const statistic: BookStatistic = {
          ...getDefaultStatistic('-', '-'),
          ...{
            id: `${key}`,
            averageReadingTime: 0,
            averageWeightedReadingTime: 0,
            averageCharactersRead: 0,
            averageWeightedCharactersRead: 0,
            averageReadingSpeed: 0,
            averageWeightedReadingSpeed: 0
          }
        };
        let weightedSum = 0;
        let validReadingDays = 0;
        for (let index2 = 0, { length: length2 } = entries; index2 < length2; index2 += 1) {
          const entry = entries[index2];
          if (aggregationKey === 'title') {
            statistic.title = key;
          } else {
            statistic.dateKey = key;
          }
          statistic.readingTime += entry.readingTime;
          statistic.charactersRead += entry.charactersRead;
          statistic.minReadingSpeed = statistic.minReadingSpeed
            ? Math.min(statistic.minReadingSpeed, entry.minReadingSpeed)
            : entry.minReadingSpeed;
          statistic.altMinReadingSpeed = statistic.altMinReadingSpeed
            ? Math.min(statistic.altMinReadingSpeed, entry.altMinReadingSpeed)
            : statistic.altMinReadingSpeed;
          statistic.maxReadingSpeed = Math.max(statistic.maxReadingSpeed, entry.lastReadingSpeed);
          weightedSum += entry.readingTime * entry.charactersRead;
          if (statistic.readingTime) {
            validReadingDays += 1;
          }
        }
        statistic.lastReadingSpeed = statistic.readingTime
          ? Math.ceil((3600 * statistic.charactersRead) / statistic.readingTime)
          : 0;
        statistic.averageReadingTime = validReadingDays
          ? Math.ceil(statistic.readingTime / validReadingDays)
          : 0;
        statistic.averageWeightedReadingTime = statistic.charactersRead
          ? Math.ceil(weightedSum / statistic.charactersRead)
          : 0;
        statistic.averageCharactersRead = validReadingDays
          ? Math.ceil(statistic.charactersRead / validReadingDays)
          : 0;
        statistic.averageWeightedCharactersRead = statistic.readingTime
          ? Math.ceil(weightedSum / statistic.readingTime)
          : 0;
        statistic.averageReadingSpeed = statistic.averageReadingTime
          ? Math.ceil((3600 * statistic.averageCharactersRead) / statistic.averageReadingTime)
          : 0;
        statistic.averageWeightedReadingSpeed = statistic.averageWeightedReadingTime
          ? Math.ceil(
              (3600 * statistic.averageWeightedCharactersRead) /
                statistic.averageWeightedReadingTime
            )
          : 0;
        aggregatedStatisticsData.push(statistic);
      }
    }
    return aggregatedStatisticsData;
  }
  function filterStatisticsForSelection(
    statistic: BookStatistic,
    newTitleFilterForStatisticsSet: Set<string>
  ) {
    const isInDateRange =
      statistic.readingTime &&
      statistic.dateKey >= $lastStatisticsStartDate$ &&
      statistic.dateKey <= $lastStatisticsEndDate$;
    if (isInDateRange) {
      newTitleFilterForStatisticsSet.add(statistic.title);
    }
    return (
      isInDateRange &&
      matchesStatisticsBookPrefilter(statistic.bookKey, $preFilteredBookKeysForStatistics$) &&
      statisticsTitleFilters.get(statistic.title)
    );
  }
  __readerController.observeSource(
    () => lastPrimaryReadingDataAggregationMode$,
    (value) => {
      $lastPrimaryReadingDataAggregationMode$ = value;
    }
  );
  __readerController.observeSource(
    () => statisticsActionInProgress$,
    (value) => {
      $statisticsActionInProgress$ = value;
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
    () => lastStatisticsRangeTemplate$,
    (value) => {
      $lastStatisticsRangeTemplate$ = value;
    }
  );
  __readerController.observeSource(
    () => startDayHoursForTracker$,
    (value) => {
      $startDayHoursForTracker$ = value;
    }
  );
  __readerController.observeSource(
    () => skipKeyDownListener$,
    (value) => {
      $skipKeyDownListener$ = value;
    }
  );
  __readerController.observeSource(
    () => confirmStatisticsDeletion$,
    (value) => {
      $confirmStatisticsDeletion$ = value;
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
    () => statisticsTitleFilterEnabled$,
    (value) => {
      $statisticsTitleFilterEnabled$ = value;
    }
  );
  __readerController.observeSource(
    () => copyStatisticsDataHandler$,
    (value) => {
      $copyStatisticsDataHandler$ = value;
    }
  );
  __readerController.observeSource(
    () => exportStatisticsDataHandler$,
    (value) => {
      $exportStatisticsDataHandler$ = value;
    }
  );
  __readerController.observeSource(
    () => exportRawStatisticsHandler$,
    (value) => {
      $exportRawStatisticsHandler$ = value;
    }
  );
  __readerController.observeSource(
    () => deleteStatisticsDataHandler$,
    (value) => {
      $deleteStatisticsDataHandler$ = value;
    }
  );
  __readerController.observeSource(
    () => setStatisticsDatesToAllTimeHandler$,
    (value) => {
      $setStatisticsDatesToAllTimeHandler$ = value;
    }
  );
  __readerController.observeSource(
    () => lastStatisticsTab$,
    (value) => {
      $lastStatisticsTab$ = value;
    }
  );
  __readerController.observeSource(
    () => lastReadingDataHeatmapAggregationMode$,
    (value) => {
      $lastReadingDataHeatmapAggregationMode$ = value;
    }
  );
  __readerController.observeSource(
    () => lastReadingGoalsHeatmapAggregationMode$,
    (value) => {
      $lastReadingGoalsHeatmapAggregationMode$ = value;
    }
  );
  __readerController.observeSource(
    () => statisticsTitleFilterIsOpen$,
    (value) => {
      $statisticsTitleFilterIsOpen$ = value;
    }
  );
  const api = {
    get bookPrefilterStatistics() {
      return bookPrefilterStatistics;
    },
    controller: __readerController,
    onKeyUp,
    handleDeleteRequest,
    handleEditRequest,
    updateTitleFilter,
    clearPrefilter,
    toggleStatisticsRangeTemplate,
    toggleStatisticsDataAggregationMode,
    init,
    statisticsForBookPrefilter,
    updateStatisticsData,
    getAggregatedStatistics,
    filterStatisticsForSelection,
    get copyStatisticsDataHandler$() {
      return copyStatisticsDataHandler$;
    },
    get exportStatisticsDataHandler$() {
      return exportStatisticsDataHandler$;
    },
    get exportRawStatisticsHandler$() {
      return exportRawStatisticsHandler$;
    },
    get deleteStatisticsDataHandler$() {
      return deleteStatisticsDataHandler$;
    },
    get setStatisticsDatesToAllTimeHandler$() {
      return setStatisticsDatesToAllTimeHandler$;
    },
    get isLoading() {
      return isLoading;
    },
    set isLoading(nextValue: typeof isLoading) {
      if (Object.is(isLoading, nextValue)) return;
      isLoading = nextValue;
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
    get statisticsData() {
      return statisticsData;
    },
    set statisticsData(nextValue: typeof statisticsData) {
      if (Object.is(statisticsData, nextValue)) return;
      statisticsData = nextValue;
      __readerController.invalidate();
    },
    get statisticsForSelection() {
      return statisticsForSelection;
    },
    set statisticsForSelection(nextValue: typeof statisticsForSelection) {
      if (Object.is(statisticsForSelection, nextValue)) return;
      statisticsForSelection = nextValue;
      __readerController.invalidate();
    },
    get aggregratedStatistics() {
      return aggregratedStatistics;
    },
    set aggregratedStatistics(nextValue: typeof aggregratedStatistics) {
      if (Object.is(aggregratedStatistics, nextValue)) return;
      aggregratedStatistics = nextValue;
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
    get statisticsDateRangeLabel() {
      return statisticsDateRangeLabel;
    },
    set statisticsDateRangeLabel(nextValue: typeof statisticsDateRangeLabel) {
      if (Object.is(statisticsDateRangeLabel, nextValue)) return;
      statisticsDateRangeLabel = nextValue;
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
    get $statisticsActionInProgress$() {
      return $statisticsActionInProgress$;
    },
    set $statisticsActionInProgress$(nextValue: typeof $statisticsActionInProgress$) {
      writeStore(statisticsActionInProgress$, nextValue);
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
    get $lastStatisticsRangeTemplate$() {
      return $lastStatisticsRangeTemplate$;
    },
    set $lastStatisticsRangeTemplate$(nextValue: typeof $lastStatisticsRangeTemplate$) {
      writeStore(lastStatisticsRangeTemplate$, nextValue);
    },
    get $startDayHoursForTracker$() {
      return $startDayHoursForTracker$;
    },
    set $startDayHoursForTracker$(nextValue: typeof $startDayHoursForTracker$) {
      writeStore(startDayHoursForTracker$, nextValue);
    },
    get $skipKeyDownListener$() {
      return $skipKeyDownListener$;
    },
    set $skipKeyDownListener$(nextValue: typeof $skipKeyDownListener$) {
      writeStore(skipKeyDownListener$, nextValue);
    },
    get $confirmStatisticsDeletion$() {
      return $confirmStatisticsDeletion$;
    },
    set $confirmStatisticsDeletion$(nextValue: typeof $confirmStatisticsDeletion$) {
      writeStore(confirmStatisticsDeletion$, nextValue);
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
    get $statisticsTitleFilterEnabled$() {
      return $statisticsTitleFilterEnabled$;
    },
    set $statisticsTitleFilterEnabled$(nextValue: typeof $statisticsTitleFilterEnabled$) {
      writeStore(statisticsTitleFilterEnabled$, nextValue);
    },
    get $copyStatisticsDataHandler$() {
      return $copyStatisticsDataHandler$;
    },
    set $copyStatisticsDataHandler$(nextValue: typeof $copyStatisticsDataHandler$) {
      writeStore(copyStatisticsDataHandler$, nextValue);
    },
    get $exportStatisticsDataHandler$() {
      return $exportStatisticsDataHandler$;
    },
    set $exportStatisticsDataHandler$(nextValue: typeof $exportStatisticsDataHandler$) {
      writeStore(exportStatisticsDataHandler$, nextValue);
    },
    get $exportRawStatisticsHandler$() {
      return $exportRawStatisticsHandler$;
    },
    set $exportRawStatisticsHandler$(nextValue: typeof $exportRawStatisticsHandler$) {
      writeStore(exportRawStatisticsHandler$, nextValue);
    },
    get $deleteStatisticsDataHandler$() {
      return $deleteStatisticsDataHandler$;
    },
    set $deleteStatisticsDataHandler$(nextValue: typeof $deleteStatisticsDataHandler$) {
      writeStore(deleteStatisticsDataHandler$, nextValue);
    },
    get $setStatisticsDatesToAllTimeHandler$() {
      return $setStatisticsDatesToAllTimeHandler$;
    },
    set $setStatisticsDatesToAllTimeHandler$(
      nextValue: typeof $setStatisticsDatesToAllTimeHandler$
    ) {
      writeStore(setStatisticsDatesToAllTimeHandler$, nextValue);
    },
    get $lastStatisticsTab$() {
      return $lastStatisticsTab$;
    },
    set $lastStatisticsTab$(nextValue: typeof $lastStatisticsTab$) {
      writeStore(lastStatisticsTab$, nextValue);
    },
    get $lastReadingDataHeatmapAggregationMode$() {
      return $lastReadingDataHeatmapAggregationMode$;
    },
    set $lastReadingDataHeatmapAggregationMode$(
      nextValue: typeof $lastReadingDataHeatmapAggregationMode$
    ) {
      writeStore(lastReadingDataHeatmapAggregationMode$, nextValue);
    },
    get $lastReadingGoalsHeatmapAggregationMode$() {
      return $lastReadingGoalsHeatmapAggregationMode$;
    },
    set $lastReadingGoalsHeatmapAggregationMode$(
      nextValue: typeof $lastReadingGoalsHeatmapAggregationMode$
    ) {
      writeStore(lastReadingGoalsHeatmapAggregationMode$, nextValue);
    },
    get $statisticsTitleFilterIsOpen$() {
      return $statisticsTitleFilterIsOpen$;
    },
    set $statisticsTitleFilterIsOpen$(nextValue: typeof $statisticsTitleFilterIsOpen$) {
      writeStore(statisticsTitleFilterIsOpen$, nextValue);
    },
    updateProps(next: Record<string, unknown>) {}
  };
  return api;
}
