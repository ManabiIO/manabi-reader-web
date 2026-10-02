/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** DOM owner: the native application imports only ports.native and contract/transport. */
import { appearance$, theme$, customThemes$ } from '$lib/appearance/state';
import { get } from '$lib/state/store';
import { statisticsTabKeybindMap$ } from '$lib/data/store';
import { getDateRangeLabel } from '$lib/data/reading-goal';
import {
  readStatisticsSnapshot,
  dispatchStatisticsAction,
  admitSharedStatisticsMutation,
  type SharedStatisticsMutationAdmission,
  verifyStatisticsSnapshot,
  releaseStatisticsSnapshot,
  type NativeStatisticsAuthority
} from '../../statistics-react/native-service';
import {
  statisticsTimeSources,
  statisticsCharactersSources,
  statisticsSpeedSources,
  type StatisticsQuery,
  type StatisticsSnapshot,
  type StatisticsMutation
} from './contract';
import type { NativeStatisticsMutationTargets } from '../../statistics-react/native-contract';
import { readStatisticsQueryPreferences } from './preferences.dom';
import { StatisticsTransfers, StatisticsCancellationLedger } from './transport';

const transfers = new StatisticsTransfers();
const cancellations = new StatisticsCancellationLedger();
const projections = new Map<
  string,
  {
    owner: string;
    created: number;
    complete: boolean;
    admission?: SharedStatisticsMutationAdmission;
    targets?: NativeStatisticsMutationTargets;
    rowTargets?: Map<string, NativeStatisticsMutationTargets>;
    snapshot: StatisticsSnapshot;
  }
>();
const reads = new Map<string, { requestId: string; controller: AbortController }>();
const generations = new Map<string, symbol>();
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => new Error('Invalid shared statistics request.');
function parseQuery(value: unknown): StatisticsQuery {
  if (!object(value)) throw invalid();
  const required = [
    'startDate',
    'endDate',
    'year',
    'goalYear',
    'weekStartsOn',
    'rangeTemplate',
    'confirmDeletion',
    'aggregation',
    'sort',
    'direction',
    'timeSource',
    'charactersSource',
    'speedSource',
    'page',
    'pageSize',
    'prefilteredBookKeys',
    'heatmapAggregation',
    'goalHeatmapAggregation'
  ];
  if (
    Object.keys(value).some(
      (key) => ![...required, 'selectionToken', 'selectedTitles', 'prefilteredTitles'].includes(key)
    ) ||
    required.some((key) => !Object.hasOwn(value, key))
  )
    throw invalid();
  const integer = (key: string, min: number, max: number) =>
    Number.isSafeInteger(value[key]) && Number(value[key]) >= min && Number(value[key]) <= max;
  const strings = (input: unknown): input is string[] =>
    Array.isArray(input) && input.every((item) => typeof item === 'string');
  if (
    !integer('year', 1000, 9999) ||
    !integer('goalYear', 1000, 9999) ||
    !integer('weekStartsOn', 0, 6) ||
    !integer('page', 1, Number.MAX_SAFE_INTEGER) ||
    !integer('pageSize', 1, 250) ||
    typeof value.confirmDeletion !== 'boolean' ||
    [
      'rangeTemplate',
      'aggregation',
      'sort',
      'direction',
      'heatmapAggregation',
      'goalHeatmapAggregation'
    ].some((key) => typeof value[key] !== 'string') ||
    !['Today', 'This Week', 'This Month', 'This Year', 'Custom'].includes(
      String(value.rangeTemplate)
    ) ||
    !['title', 'date', 'none'].includes(String(value.aggregation)) ||
    !['title', 'date', 'time', 'characters', 'speed'].includes(String(value.sort)) ||
    !['asc', 'desc'].includes(String(value.direction)) ||
    !statisticsTimeSources.some((source) => source.key === value.timeSource) ||
    !statisticsCharactersSources.some((source) => source.key === value.charactersSource) ||
    !statisticsSpeedSources.some((source) => source.key === value.speedSource) ||
    !['year', 'all-time'].includes(String(value.heatmapAggregation)) ||
    !['year', 'all-time'].includes(String(value.goalHeatmapAggregation)) ||
    !strings(value.prefilteredBookKeys) ||
    value.prefilteredBookKeys.some(
      (key) => !/^(?:content:[a-f0-9]{64}|local:[A-Za-z0-9-]{1,128})$/.test(key)
    ) ||
    (value.selectedTitles !== undefined && !strings(value.selectedTitles)) ||
    (value.prefilteredTitles !== undefined && !strings(value.prefilteredTitles)) ||
    (value.selectionToken !== undefined &&
      (typeof value.selectionToken !== 'string' ||
        !/^[A-Za-z0-9-]{1,64}$/.test(value.selectionToken))) ||
    typeof value.startDate !== 'string' ||
    typeof value.endDate !== 'string'
  )
    throw invalid();
  // Fixed key order binds every continuation to the same logical query.
  return Object.fromEntries(
    [...required, 'selectionToken', 'selectedTitles', 'prefilteredTitles']
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, Array.isArray(value[key]) ? [...value[key]] : value[key]])
  ) as unknown as StatisticsQuery;
}
function retire(owner?: string) {
  for (const [id, value] of projections)
    if (!owner || value.owner === owner || Date.now() - value.created > 120000) {
      projections.delete(id);
      releaseStatisticsSnapshot(id);
    }
  transfers.clear(owner);
}
export async function readSharedStatisticsRequest(
  payload: Record<string, unknown>,
  authority: NativeStatisticsAuthority
) {
  if (payload.sharedVersion === 1 && payload.cancel === true) {
    if (
      Object.keys(payload).some((key) => !['sharedVersion', 'cancel', 'requestId'].includes(key)) ||
      typeof payload.requestId !== 'string' ||
      !/^[A-Za-z0-9-]{1,96}$/.test(payload.requestId)
    )
      throw invalid();
    authority.assertCurrent();
    authority.signal.throwIfAborted();
    cancellations.cancel(authority.key, payload.requestId);
    if (reads.get(authority.key)?.requestId === payload.requestId) {
      reads.get(authority.key)!.controller.abort();
      reads.delete(authority.key);
      generations.delete(authority.key);
      retire(authority.key);
    }
    return { cancelled: true };
  }
  if (
    payload.sharedVersion !== 1 ||
    Object.keys(payload).some(
      (key) => !['sharedVersion', 'query', 'cursor', 'requestId', 'initialize'].includes(key)
    ) ||
    (payload.initialize !== undefined && payload.initialize !== true) ||
    (payload.requestId !== undefined &&
      (typeof payload.requestId !== 'string' || !/^[A-Za-z0-9-]{1,96}$/.test(payload.requestId))) ||
    (payload.cursor !== undefined &&
      (typeof payload.cursor !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(payload.cursor)))
  )
    throw invalid();
  let query = parseQuery(payload.query);
  const queryKey = JSON.stringify([query, payload.initialize === true]);
  authority.assertCurrent();
  authority.signal.throwIfAborted();
  cancellations.assertNotCancelled(authority.key, String(payload.requestId ?? ''));
  if (typeof payload.cursor === 'string') {
    if (reads.get(authority.key)?.requestId !== String(payload.requestId ?? ''))
      throw new Error('This Statistics continuation changed or expired.');
    const snapshotId = transfers.snapshot(payload.cursor, authority.key, queryKey);
    try {
      // Intermediate chunks recheck canonical identity/authority. Only the final
      // chunk scans source rows again, before the UI can expose any projection.
      await verifyStatisticsSnapshot(
        snapshotId,
        authority,
        transfers.isFinal(payload.cursor, authority.key, queryKey)
      );
      const reply = transfers.next(payload.cursor, authority.key, queryKey);
      if (reply.complete && projections.has(snapshotId)) {
        projections.get(snapshotId)!.admission = admitSharedStatisticsMutation(
          snapshotId,
          authority
        );
        projections.get(snapshotId)!.complete = true;
      }
      return reply;
    } catch (error) {
      retire(authority.key);
      throw error;
    }
  }
  if (payload.initialize === true) {
    query = {
      ...query,
      ...readStatisticsQueryPreferences(false),
      selectionToken: query.selectionToken,
      selectedTitles: query.selectedTitles,
      prefilteredBookKeys: query.prefilteredBookKeys,
      prefilteredTitles: query.prefilteredTitles
    };
  }
  reads.get(authority.key)?.controller.abort();
  const local = new AbortController();
  reads.set(authority.key, { requestId: String(payload.requestId ?? ''), controller: local });
  while (reads.size > 2) {
    const key = reads.keys().next().value!;
    reads.get(key)!.controller.abort();
    reads.delete(key);
    retire(key);
  }
  const outer = authority;
  authority = {
    key: outer.key,
    signal: AbortSignal.any([outer.signal, local.signal]),
    assertCurrent() {
      outer.assertCurrent();
      local.signal.throwIfAborted();
    }
  };
  const generation = Symbol('statistics-read');
  generations.set(authority.key, generation);
  retire(authority.key);
  while (projections.size >= 2) {
    const oldest = projections.keys().next().value!;
    releaseStatisticsSnapshot(oldest);
    projections.delete(oldest);
  }
  const aborted = () => {
    retire(authority.key);
    generations.delete(authority.key);
  };
  authority.signal.addEventListener('abort', aborted, { once: true });
  let admissionId: string | undefined;
  try {
    const native = await readStatisticsSnapshot(
      {
        selectionToken: query.selectionToken,
        startDate: query.startDate,
        endDate: query.endDate,
        year: query.year,
        page: query.page,
        aggregation: query.aggregation,
        sort: query.sort,
        direction: query.direction,
        timeSource: query.timeSource,
        charactersSource: query.charactersSource,
        speedSource: query.speedSource,
        heatmapAggregation: query.heatmapAggregation
      },
      authority,
      undefined,
      {
        complete: true,
        pageSize: query.pageSize,
        selectedTitles: query.selectedTitles,
        prefilteredBookKeys: query.prefilteredBookKeys
      }
    );
    admissionId = native.snapshotId;
    authority.assertCurrent();
    authority.signal.throwIfAborted();
    if (generations.get(authority.key) !== generation) {
      releaseStatisticsSnapshot(native.snapshotId);
      throw new Error('A newer Statistics query replaced this transfer.');
    }
    const choices =
      native.titleChoices ?? native.books.map((book) => ({ title: book.title, inDateRange: true }));
    const snapshot: StatisticsSnapshot = {
      snapshotId: native.snapshotId,
      uiTheme: {
        themeId: get(theme$),
        appearance: get(appearance$),
        customThemes: get(customThemes$)
      },
      query: {
        ...query,
        page: native.query.page,
        ...(native.query.selectionToken ? { selectionToken: native.query.selectionToken } : {})
      },
      today: native.today,
      dateRangeLabel: getDateRangeLabel(query.startDate, query.endDate),
      shortcuts: Object.fromEntries(
        Object.entries(get(statisticsTabKeybindMap$)).flatMap(([key, value]) =>
          value === 'templateRangeToggle'
            ? [[key, 'range-template']]
            : value === 'aggregationToggle'
              ? [[key, 'aggregation']]
              : []
        )
      ),
      books: native.books,
      titles: choices.map((item) => ({
        ...item,
        selected: query.selectedTitles === undefined || query.selectedTitles.includes(item.title)
      })),
      rows: native.rows.map(({ sharedMutationTargets: _targets, ...row }) => ({
        ...row,
        ...(row.entry ? { entry: { ...row.entry, title: row.title } } : {})
      })),
      totalRows: native.totalRows,
      selectionTitles: native.selectionTitles,
      allTitles: native.allTitles,
      pages: native.pages,
      totals: native.totals,
      days: native.days,
      goalDays: [],
      daysRead: native.daysRead,
      currentStreak: native.currentStreak,
      currentStreakDates: native.currentStreakDates ?? [],
      longestStreak: native.longestStreak,
      longestStreakCount: native.longestStreakCount,
      longestStreaks: native.longestStreaks,
      currentStreakRange: native.currentStreakRange,
      longestStreakStartDate: native.longestStreakStartDate,
      longestStreakDates: native.longestStreakDates,
      allTime: native.allTime,
      notices: native.notices
    };
    const reply = transfers.begin(snapshot.snapshotId, authority.key, queryKey, snapshot);
    projections.set(snapshot.snapshotId, {
      owner: authority.key,
      created: Date.now(),
      complete: false,
      targets: native.sharedMutationTargets,
      rowTargets: new Map(
        native.rows.flatMap((row) =>
          row.sharedMutationTargets ? [[row.id, row.sharedMutationTargets] as const] : []
        )
      ),
      snapshot
    });
    await verifyStatisticsSnapshot(snapshot.snapshotId, authority, reply.complete);
    if (generations.get(authority.key) !== generation) {
      releaseStatisticsSnapshot(snapshot.snapshotId);
      throw new Error('Statistics query changed.');
    }
    if (reply.complete) {
      projections.get(snapshot.snapshotId)!.admission = admitSharedStatisticsMutation(
        snapshot.snapshotId,
        authority
      );
      projections.get(snapshot.snapshotId)!.complete = true;
    }
    return reply;
  } catch (error) {
    if (admissionId) releaseStatisticsSnapshot(admissionId);
    if (generations.get(authority.key) === generation) retire(authority.key);
    throw error;
  } finally {
    authority.signal.removeEventListener('abort', aborted);
    if (generations.get(authority.key) === generation) generations.delete(authority.key);
  }
}
export async function dispatchSharedStatisticsAction(
  payload: Record<string, unknown>,
  authority: NativeStatisticsAuthority
) {
  if (
    payload.sharedVersion !== 1 ||
    Object.keys(payload).some((key) => !['sharedVersion', 'mutation'].includes(key)) ||
    !object(payload.mutation)
  )
    throw invalid();
  const action = payload.mutation as unknown as StatisticsMutation;
  const projected = projections.get(action.snapshotId);
  authority.assertCurrent();
  authority.signal.throwIfAborted();
  if (
    !projected ||
    !projected.complete ||
    !projected.admission ||
    projected.owner !== authority.key ||
    Date.now() - projected.created > 120000
  )
    throw new Error('This statistics view expired. Refresh Statistics.');
  const { snapshot, admission } = projected;
  projections.delete(action.snapshotId);
  transfers.clear(authority.key);
  if (action.type === 'save-day') {
    if (!object(action.entry)) throw invalid();
    const entry = action.entry;
    const book = snapshot.books.find(
      (book) => book.id === entry.bookId && book.title === entry.title && book.deletable
    );
    const row = snapshot.rows.find(
      (row) =>
        row.entry?.bookId === entry.bookId &&
        row.entry.bookKey === entry.bookKey &&
        row.entry.date === entry.date
    );
    if (
      !book ||
      !entry.bookKey ||
      (action.mode === 'edit' ? !row : action.mode !== 'create' || book.bookKey !== entry.bookKey)
    )
      throw new Error('The captured reading day changed. Refresh Statistics.');
    return dispatchStatisticsAction(
      {
        type: 'save-day',
        snapshotId: action.snapshotId,
        bookId: book.id!,
        bookKey: entry.bookKey,
        title: book.title,
        date: entry.date,
        mode: action.mode,
        time: action.time,
        characters: action.characters,
        resetMinMax: action.resetMinMax
      },
      authority,
      admission
    );
  }
  if (action.type !== 'delete' || action.scope !== 'selection')
    throw new Error('Global reading-history deletion is unavailable on this device.');
  const row = action.row ? snapshot.rows.find((row) => row.id === action.row!.id) : undefined;
  if (action.row && !row) throw new Error('The captured reading row changed. Refresh Statistics.');
  if (row?.entry)
    return dispatchStatisticsAction(
      {
        type: 'delete-day',
        snapshotId: action.snapshotId,
        bookId: row.entry.bookId!,
        bookKey: row.entry.bookKey!,
        title: row.entry.title,
        date: row.entry.date
      },
      authority,
      admission
    );
  if (snapshot.query.prefilteredBookKeys.length) {
    releaseStatisticsSnapshot(action.snapshotId);
    throw new Error(
      'Bulk deletion of an identity-key subset is unavailable on this device. Delete an individual day or reopen Statistics from Library.'
    );
  }
  const targets = row ? projected.rowTargets?.get(row.id) : projected.targets;
  const ids = targets?.bookIds ?? [];
  if (!ids.length) {
    releaseStatisticsSnapshot(action.snapshotId);
    return { deleted: true };
  }
  return dispatchStatisticsAction(
    {
      type: 'delete-range',
      snapshotId: action.snapshotId,
      bookIds: ids,
      startDate: row?.date || snapshot.query.startDate,
      endDate: row?.date || snapshot.query.endDate
    },
    authority,
    admission,
    new Set(targets!.bookKeys)
  );
}
