/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** In-process DOM-owner adapter. Never imported by the Android application bundle. */
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { USER_GUIDE_URL } from '$lib/components/navigation/docs-link';
import { localUser, localProfileUser } from '$lib/manabi/client';
import {
  database,
  lastStatisticsStartDate$,
  lastStatisticsEndDate$,
  lastStartDayOfWeek$,
  lastStatisticsRangeTemplate$,
  lastPrimaryReadingDataAggregationMode$,
  lastReadingTimeDataSource$,
  lastCharactersDataSource$,
  lastReadingSpeedDataSource$,
  lastStatisticsSummarySortProperty$,
  lastStatisticsSummarySortDirection$,
  lastReadingDataHeatmapAggregationMode$,
  lastReadingGoalsHeatmapAggregationMode$,
  startDayHoursForTracker$,
  confirmStatisticsDeletion$,
  lastStatisticsTab$,
  lastBlurredTrackerItems$,
  statisticsTabKeybindMap$,
  lastStatisticsFilterDateRangeOnly$,
  lastStatisticsFilterShowSelectedTitlesOnly$
} from '$lib/data/store';
import { get } from '$lib/state/store';
import { appearance$, theme$, customThemes$ } from '$lib/appearance/state';
import { captureLibraryOperation } from '$lib/manabi/operation-scope';
import {
  type BookStatistic,
  StatisticsReadingDataAggregationMode,
  StatisticsRangeTemplate,
  StatisticsTab,
  preFilteredBookKeysForStatistics$,
  preFilteredTitlesForStatistics$,
  statisticsActionInProgress$
} from '$lib/components/statistics/statistics-types';
import { SortDirection } from '$lib/data/sort-types';
import {
  HeatmapDataAggregration,
  HeatmapType,
  type HeatmapStreak
} from '$lib/components/statistics/statistics-heatmap/statistics-heatmap';
import { getDateString, getStartHoursDate } from '$lib/functions/statistic-util';
import { getDateRangeLabel } from '$lib/data/reading-goal';
import { aggregateStatistics } from '../../statistics-react/statistics-aggregation';
import { createStatisticsHeatmap } from '../../statistics-react/statistics-heatmap-controller';
import { matchesStatisticsBookPrefilter } from '../../lib/components/statistics/title-filter-model';
import {
  titlesWithMultipleStatisticIdentities,
  readStatisticsRecoverySnapshot
} from '$lib/data/database/books-db/reader-statistics';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
import type {
  BooksDbReadingGoal,
  BooksDbStatistic
} from '$lib/data/database/books-db/versions/books-db';
import type {
  StatisticsDay,
  StatisticsPort,
  StatisticsQuery,
  StatisticsRow,
  StatisticsSnapshot
} from './contract';
import { readStatisticsQueryPreferences } from './preferences.dom';

let progressLease: symbol | undefined;
let portSerial = 0;
const available = { available: true } as const;
const sourceMode = (value: StatisticsQuery['aggregation']) =>
  value === 'title'
    ? StatisticsReadingDataAggregationMode.TITLE
    : value === 'date'
      ? StatisticsReadingDataAggregationMode.DATE
      : StatisticsReadingDataAggregationMode.NONE;
function projectRow(
  row: BookStatistic,
  aggregation: StatisticsQuery['aggregation']
): StatisticsRow {
  return {
    id: row.id,
    title: aggregation === 'date' ? '' : row.title,
    date: aggregation === 'title' ? '' : row.dateKey,
    time: row.readingTime,
    characters: row.charactersRead,
    speed: row.lastReadingSpeed,
    measurements: {
      readingTime: row.readingTime,
      averageReadingTime: row.averageReadingTime,
      averageWeightedReadingTime: row.averageWeightedReadingTime,
      charactersRead: row.charactersRead,
      averageCharactersRead: row.averageCharactersRead,
      averageWeightedCharactersRead: row.averageWeightedCharactersRead,
      lastReadingSpeed: row.lastReadingSpeed,
      minReadingSpeed: row.minReadingSpeed,
      altMinReadingSpeed: row.altMinReadingSpeed,
      maxReadingSpeed: row.maxReadingSpeed
    },
    ...(aggregation === 'none'
      ? {
          entry: {
            title: row.title,
            date: row.dateKey,
            ...(row.bookKey ? { bookKey: row.bookKey } : {})
          }
        }
      : {})
  };
}
function heatmapProjection(
  rows: BookStatistic[],
  goals: BooksDbReadingGoal[],
  query: StatisticsQuery,
  goal: boolean,
  today: Date
) {
  const model = createStatisticsHeatmap({
    heatmapType: goal ? HeatmapType.READING_GOALS : HeatmapType.STATISTICS,
    heatmapAggregration:
      (goal ? query.goalHeatmapAggregation : query.heatmapAggregation) === 'all-time'
        ? HeatmapDataAggregration.ALL_TIME
        : HeatmapDataAggregration.YEAR,
    statisticsData: rows,
    readingGoals: goals,
    statisticsTitleFilters: new Map(rows.map((row) => [row.title, true])),
    today,
    todayKey: getDateString(today)
  });
  try {
    model.heatmapYear = goal ? query.goalYear : query.year;
    model.controller.prepare();
    const result = model.currentHeatmapData;
    const days: StatisticsDay[] = model.currentHeatmapDays
      .filter((day) => day.isCurrentYear)
      .map((day) => ({
        date: day.dateString,
        color: day.color,
        details: [...day.dayDetails],
        time: day.readingTime
      }));
    const datesFor = (streaks: HeatmapStreak[]) =>
      days
        .filter((day) =>
          streaks.some((streak) => day.date >= streak.startDate && day.date <= streak.endDate)
        )
        .map((day) => day.date);
    return {
      days,
      daysRead: 'daysRead' in result ? result.daysRead : '',
      completed: 'completedReadingGoals' in result ? result.completedReadingGoals : '',
      currentStreakRange: { ...result.currentStreak },
      longestStreaks: result.longestStreaks.map((streak) => ({ ...streak })),
      completedStreaks: result.streaks.map((streak) => ({ ...streak })),
      longestStreakCount: result.longestStreaks.length,
      currentStreak: result.currentStreak.duration,
      longestStreak: result.longestStreaks[0]?.duration ?? 0,
      longestStreakStartDate: result.longestStreaks[0]?.startDate ?? null,
      longestStreakDates: datesFor(result.longestStreaks),
      currentStreakDates: datesFor([result.currentStreak]),
      completedDates: datesFor(result.streaks)
    };
  } finally {
    model.controller.destroy();
  }
}
interface ReadProof {
  snapshot: StatisticsSnapshot;
  all: BookStatistic[];
  selected: BookStatistic[];
}
export function createWebStatisticsPort(): StatisticsPort {
  const ownerKey = `web-statistics:${++portSerial}`;
  let operation: ReturnType<typeof captureLibraryOperation> | undefined;
  let generation = 0;
  let proof: ReadProof | undefined;
  let lastItem: number | undefined;
  const ensureScope = () => (operation ??= captureLibraryOperation());
  const assertCurrent = (signal?: AbortSignal) => {
    ensureScope().assertCurrent();
    signal?.throwIfAborted();
  };
  function readProof(id: string, signal: AbortSignal) {
    assertCurrent(signal);
    if (!proof || proof.snapshot.snapshotId !== id)
      throw new Error('History changed. Refresh before continuing.');
    return proof;
  }
  const port: StatisticsPort = {
    capabilities: {
      goals: available,
      clipboard: available,
      ttuExport: available,
      rawRecovery: available,
      globalDelete: available,
      createDay: {
        available: false,
        reason: 'Choose an existing reading day to edit. New days are recorded while reading.'
      }
    },
    ownerKey,
    userGuideHref: USER_GUIDE_URL,
    initialTheme: {
      themeId: get(theme$),
      appearance: get(appearance$),
      customThemes: get(customThemes$)
    },
    initialFilterPreferences: {
      dateOnly: get(lastStatisticsFilterDateRangeOnly$),
      selectedOnly: get(lastStatisticsFilterShowSelectedTitlesOnly$)
    },
    persistFilterPreferences(value) {
      lastStatisticsFilterDateRangeOnly$.next(value.dateOnly);
      lastStatisticsFilterShowSelectedTitlesOnly$.next(value.selectedOnly);
    },
    initialView: get(lastStatisticsTab$) === StatisticsTab.SUMMARY ? 'summary' : 'overview',
    initialQuery: () => readStatisticsQueryPreferences(),
    subscribeInvalidation(listener) {
      const scope = ensureScope();
      const changed = () => {
        generation++;
        proof = undefined;
        listener();
      };
      scope.signal.addEventListener('abort', changed);
      const sub = database.lastItem$.subscribe((item) => {
        lastItem = item?.dataId;
      });
      return () => {
        scope.signal.removeEventListener('abort', changed);
        sub.unsubscribe();
      };
    },
    async load(input, signal) {
      assertCurrent(signal);
      const scope = ensureScope(),
        readGeneration = generation;
      const [raw, goals] = await Promise.all([
        database.getAllStatistics(),
        database.getReadingGoals()
      ]);
      scope.assertCurrent();
      signal.throwIfAborted();
      if (readGeneration !== generation) throw new Error('Statistics access changed.');
      const query = {
        ...input,
        prefilteredBookKeys: [...input.prefilteredBookKeys],
        ...(input.selectedTitles ? { selectedTitles: [...input.selectedTitles] } : {})
      };
      const all: BookStatistic[] = raw
        .map((row) => ({
          ...row,
          id: `${'bookKey' in row ? row.bookKey : row.title}_${row.dateKey}`,
          averageReadingTime: row.readingTime,
          averageWeightedReadingTime: row.readingTime,
          averageCharactersRead: row.charactersRead,
          averageWeightedCharactersRead: row.charactersRead,
          averageReadingSpeed: row.lastReadingSpeed,
          averageWeightedReadingSpeed: row.lastReadingSpeed
        }))
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
      const prefilter = new Set(query.prefilteredBookKeys);
      const filtered = all.filter((row) => matchesStatisticsBookPrefilter(row.bookKey, prefilter));
      const selectedTitles = new Set(
        query.selectedTitles ?? filtered.filter((row) => row.readingTime).map((row) => row.title)
      );
      const selected = filtered.filter(
        (row) =>
          row.readingTime &&
          row.dateKey >= query.startDate &&
          row.dateKey <= query.endDate &&
          selectedTitles.has(row.title)
      );
      const heatmapRows = filtered.filter((row) => selectedTitles.has(row.title));
      const titles = [...new Set(all.filter((row) => row.readingTime).map((row) => row.title))]
        .sort((a, b) => a.localeCompare(b, 'ja-JP', { numeric: true }))
        .map((title) => ({
          title,
          selected: selectedTitles.has(title),
          inDateRange: all.some(
            (row) =>
              row.title === title &&
              row.readingTime &&
              row.dateKey >= query.startDate &&
              row.dateKey <= query.endDate
          )
        }));
      const titlesByDate = new Map<string, Set<string>>();
      for (const row of selected) {
        const titles = titlesByDate.get(row.dateKey) ?? new Set<string>();
        titles.add(row.title);
        titlesByDate.set(row.dateKey, titles);
      }
      const rows = aggregateStatistics(selected, sourceMode(query.aggregation)).map((row) => ({
        ...projectRow(row, query.aggregation),
        affectedTitles:
          query.aggregation === 'date' ? [...(titlesByDate.get(row.dateKey) ?? [])] : [row.title]
      }));
      const value = (row: StatisticsRow) =>
        query.sort === 'time'
          ? row.measurements[query.timeSource]
          : query.sort === 'characters'
            ? row.measurements[query.charactersSource]
            : query.sort === 'speed'
              ? row.measurements[query.speedSource]
              : row[query.sort];
      rows.sort((a, b) => {
        const left = value(a),
          right = value(b);
        return (
          (typeof left === 'string' && typeof right === 'string'
            ? left.localeCompare(right, 'ja-JP', { numeric: true })
            : Number(left) - Number(right)) * (query.direction === 'asc' ? 1 : -1)
        );
      });
      const pages = Math.max(1, Math.ceil(rows.length / query.pageSize));
      query.page = Math.max(1, Math.min(query.page, pages));
      const totals = selected.reduce(
        (sum, row) => ({
          ...sum,
          time: sum.time + row.readingTime,
          characters: sum.characters + row.charactersRead
        }),
        { time: 0, characters: 0, speed: 0, days: new Set(selected.map((row) => row.dateKey)).size }
      );
      totals.speed = totals.time ? Math.ceil((3600 * totals.characters) / totals.time) : 0;
      // The existing heatmap model reads only this presentation preference; storage remains in this owner.
      lastStartDayOfWeek$.next(query.weekStartsOn);
      const today = getStartHoursDate(get(startDayHoursForTracker$));
      const calendar = heatmapProjection(heatmapRows, goals, query, false, today);
      const goalCalendar = goals.length
        ? heatmapProjection(heatmapRows, goals, query, true, today)
        : undefined;
      const books = [
        ...new Map(
          filtered.map((row) => [
            row.bookKey ?? `legacy:${row.title}`,
            { title: row.title, bookKey: row.bookKey, deletable: true }
          ])
        ).values()
      ];
      const snapshot: StatisticsSnapshot = {
        snapshotId: crypto.randomUUID(),
        uiTheme: {
          themeId: get(theme$),
          appearance: get(appearance$),
          customThemes: get(customThemes$)
        },
        query,
        today: getDateString(today),
        dateRangeLabel: getDateRangeLabel(query.startDate, query.endDate),
        shortcuts: Object.fromEntries(
          Object.entries(get(statisticsTabKeybindMap$)).flatMap<
            [string, 'range-template' | 'aggregation']
          >(([key, value]) =>
            value === 'templateRangeToggle'
              ? [[key, 'range-template']]
              : value === 'aggregationToggle'
                ? [[key, 'aggregation']]
                : []
          )
        ),
        currentBookId: lastItem,
        blurredMeasurements: [...get(lastBlurredTrackerItems$)],
        books,
        titles,
        rows: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
        totalRows: rows.length,
        selectionTitles: [...new Set(selected.map((row) => row.title))],
        allTitles: [...new Set(all.map((row) => row.title))],
        pages,
        totals,
        days: calendar.days,
        goalDays: goalCalendar?.days ?? [],
        daysRead: calendar.daysRead,
        currentStreak: calendar.currentStreak,
        longestStreak: calendar.longestStreak,
        longestStreakCount: calendar.longestStreakCount,
        longestStreaks: calendar.longestStreaks,
        currentStreakRange: calendar.currentStreakRange,
        longestStreakStartDate: calendar.longestStreakStartDate,
        longestStreakDates: calendar.longestStreakDates,
        currentStreakDates: calendar.currentStreakDates,
        goalStats: goalCalendar
          ? {
              completed: goalCalendar.completed,
              longestStreakCount: goalCalendar.longestStreakCount,
              longestStreaks: goalCalendar.longestStreaks,
              currentStreakRange: goalCalendar.currentStreakRange,
              completedStreaks: goalCalendar.completedStreaks,
              currentStreak: goalCalendar.currentStreak,
              longestStreak: goalCalendar.longestStreak,
              longestStreakStartDate: goalCalendar.longestStreakStartDate,
              longestStreakDates: goalCalendar.longestStreakDates,
              currentStreakDates: goalCalendar.currentStreakDates,
              completedDates: goalCalendar.completedDates
            }
          : undefined,
        allTime: heatmapRows.length
          ? {
              startDate: heatmapRows[0].dateKey,
              endDate: heatmapRows[heatmapRows.length - 1].dateKey
            }
          : null,
        notices: []
      };
      assertCurrent(signal);
      proof = { snapshot, all, selected };
      return snapshot;
    },
    async mutate(action, signal) {
      const captured = readProof(action.snapshotId, signal);
      // Consume before awaiting: no duplicate click can replay the captured target.
      proof = undefined;
      if (action.type === 'delete' && action.row) {
        const rowId = action.row.id;
        const row = captured.snapshot.rows.find((row) => row.id === rowId);
        if (!row) throw new Error('The captured reading row changed. Refresh Statistics.');
        action = { ...action, row };
      }
      if (action.type === 'save-day') {
        if (action.mode !== 'edit') throw new Error('Choose an existing reading day to edit.');
        const entry = action.entry;
        if (
          !captured.snapshot.rows.some(
            (row) =>
              row.entry?.title === entry.title &&
              row.entry.date === entry.date &&
              row.entry.bookKey === entry.bookKey
          )
        )
          throw new Error('The captured reading day changed. Refresh Statistics.');
        const row = captured.all.find(
          (item) =>
            item.title === entry.title &&
            item.dateKey === entry.date &&
            (entry.bookKey ? item.bookKey === entry.bookKey : !item.bookKey)
        );
        if (!row) throw new Error('The selected reading day changed. Refresh Statistics.');
        const speed = action.time ? Math.ceil((3600 * action.characters) / action.time) : 0;
        const next = {
          ...row,
          readingTime: action.time,
          averageReadingTime: action.time,
          averageWeightedReadingTime: action.time,
          charactersRead: action.characters,
          averageCharactersRead: action.characters,
          averageWeightedCharactersRead: action.characters,
          lastReadingSpeed: speed,
          averageReadingSpeed: speed,
          averageWeightedReadingSpeed: speed,
          lastStatisticModified: Date.now(),
          minReadingSpeed:
            row.minReadingSpeed && !action.resetMinMax
              ? Math.min(row.minReadingSpeed, speed)
              : speed,
          maxReadingSpeed: action.resetMinMax ? speed : Math.max(row.maxReadingSpeed, speed),
          altMinReadingSpeed:
            action.characters || action.resetMinMax
              ? row.altMinReadingSpeed && !action.resetMinMax
                ? Math.min(row.altMinReadingSpeed, speed)
                : speed
              : row.altMinReadingSpeed
        };
        assertCurrent(signal);
        await database.updateStatistic(next);
        assertCurrent(signal);
        return;
      }
      const query = captured.snapshot.query;
      const start = action.scope === 'all' ? '' : action.row?.date || query.startDate;
      const end = action.scope === 'all' ? '' : action.row?.date || query.endDate;
      const candidates = (action.scope === 'all' ? captured.all : captured.selected).filter(
        (row) =>
          (!start || (row.dateKey >= start && row.dateKey <= end)) &&
          (!action.row?.title || row.title === action.row.title) &&
          (!action.row?.entry || row.bookKey === action.row.entry.bookKey)
      );
      const identities = [
        ...new Set(candidates.flatMap((row) => (row.bookKey ? [row.bookKey] : [])))
      ];
      const legacy = [...new Set(candidates.filter((row) => !row.bookKey).map((row) => row.title))];
      if (!identities.length && !legacy.length) return;
      assertCurrent(signal);
      await database.deleteStatisticEntries(legacy, false, start, end, identities);
      assertCurrent(signal);
    },
    async copy(measurement, snapshotId, signal) {
      const captured = readProof(snapshotId, signal);
      const rows = aggregateStatistics(
        captured.selected,
        StatisticsReadingDataAggregationMode.TITLE
      );
      const lines = [
        `Reading Data for ${getDateRangeLabel(captured.snapshot.query.startDate, captured.snapshot.query.endDate)}\n`
      ];
      for (const row of rows) {
        const value =
          measurement === 'readingTime' ? Math.floor(row.readingTime / 60) : row.charactersRead;
        if (value)
          lines.push(
            `.log ${measurement === 'readingTime' ? 'readtime' : 'reading'} ${value} ${row.title}`
          );
      }
      assertCurrent(signal);
      if (lines.length > 1) await navigator.clipboard.writeText(lines.join('\n'));
      assertCurrent(signal);
    },
    async export(format, selection, snapshotId, signal) {
      const captured = readProof(snapshotId, signal);
      if (format === 'raw') {
        const snapshot = await readStatisticsRecoverySnapshot(await database.db);
        assertCurrent(signal);
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = `manabi-reader-statistics-recovery-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.append(link);
        try {
          assertCurrent(signal);
          link.click();
        } finally {
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        }
        return;
      }
      const selected = selection === 'all' ? captured.all : captured.selected;
      const titles = new Set(selected.map((row) => row.title));
      const ambiguous = titlesWithMultipleStatisticIdentities(selected);
      const receipts = await (await database.db).getAll('readerStatisticMigration');
      assertCurrent(signal);
      const unresolved = receipts
        .filter(
          (receipt) =>
            titles.has(receipt.title) &&
            (receipt.state === 'ambiguous' ||
              (receipt.state === 'identity-conflict' && !receipt.legacyAssigned))
        )
        .map((receipt) => receipt.title);
      if (ambiguous.length || unresolved.length)
        throw new Error(
          `The TTU ZIP cannot safely identify all days for ${[...new Set([...ambiguous, ...unresolved])].join(', ')}. Download raw history (JSON) to preserve every book identity and day.`
        );
      const groups = new Map<string, BooksDbStatistic[]>();
      for (const row of selected) {
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
        } = row;
        const entries = groups.get(title) ?? [];
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
        groups.set(title, entries);
      }
      const backup = getStorageHandler(window, StorageKey.BACKUP);
      backup.clearData();
      try {
        for (const [title, rows] of groups) {
          assertCurrent(signal);
          const modified = await database.getLastModifiedForType(title, StorageDataType.STATISTICS);
          assertCurrent(signal);
          backup.startContext({ id: 0, title, imagePath: '' });
          await backup.saveStatistics(rows, modified);
          assertCurrent(signal);
        }
        if (groups.size) {
          assertCurrent(signal);
          await backup.createExportZip(document, false);
          assertCurrent(signal);
        }
      } finally {
        backup.clearData();
      }
    },
    persistView(view) {
      lastStatisticsTab$.next(view === 'summary' ? StatisticsTab.SUMMARY : StatisticsTab.OVERVIEW);
    },
    persistQuery(query) {
      lastStatisticsStartDate$.next(query.startDate);
      lastStatisticsEndDate$.next(query.endDate);
      lastStartDayOfWeek$.next(query.weekStartsOn);
      lastStatisticsRangeTemplate$.next(query.rangeTemplate as StatisticsRangeTemplate);
      confirmStatisticsDeletion$.next(query.confirmDeletion);
      lastPrimaryReadingDataAggregationMode$.next(sourceMode(query.aggregation));
      lastReadingTimeDataSource$.next(query.timeSource);
      lastCharactersDataSource$.next(query.charactersSource);
      lastReadingSpeedDataSource$.next(query.speedSource);
      lastStatisticsSummarySortProperty$.next(
        query.sort === 'date'
          ? 'dateKey'
          : query.sort === 'title'
            ? 'title'
            : query.sort === 'time'
              ? query.timeSource
              : query.sort === 'characters'
                ? query.charactersSource
                : query.speedSource
      );
      lastStatisticsSummarySortDirection$.next(query.direction as SortDirection);
      lastReadingDataHeatmapAggregationMode$.next(
        query.heatmapAggregation === 'all-time'
          ? HeatmapDataAggregration.ALL_TIME
          : HeatmapDataAggregration.YEAR
      );
      lastReadingGoalsHeatmapAggregationMode$.next(
        query.goalHeatmapAggregation === 'all-time'
          ? HeatmapDataAggregration.ALL_TIME
          : HeatmapDataAggregration.YEAR
      );
      preFilteredBookKeysForStatistics$.next(new Set(query.prefilteredBookKeys));
      if (!query.prefilteredBookKeys.length && query.selectedTitles === undefined)
        preFilteredTitlesForStatistics$.next(new Set());
    },
    setProgress(busy, lease) {
      if (busy) {
        progressLease = lease;
        statisticsActionInProgress$.next(true);
      } else if (progressLease === lease) {
        progressLease = undefined;
        statisticsActionInProgress$.next(false);
      }
    },
    release() {
      operation?.stop();
      operation = undefined;
      proof = undefined;
      generation++;
    }
  };
  return port;
}
export function useStatisticsPort() {
  const owner = useRef({ id: localProfileUser()?.id ?? null, revision: 0 });
  const subscribe = useCallback(
    (notify: () => void) =>
      localUser.subscribe((user) => {
        const id = user?.id ?? null;
        if (owner.current.id !== id) {
          owner.current = { id, revision: owner.current.revision + 1 };
          notify();
        }
      }),
    []
  );
  const getSnapshot = useCallback(() => owner.current.revision, []);
  const revision = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(() => createWebStatisticsPort(), [revision]);
}
