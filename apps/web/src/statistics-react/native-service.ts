/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** DOM-owner only. Never import this module from the Android JS bundle. */
import {
  database,
  lastStatisticsStartDate$,
  lastStatisticsEndDate$,
  lastStartDayOfWeek$,
  startDayHoursForTracker$
} from '$lib/data/store';
import { get } from '$lib/state/store';
import { commitTransaction } from '$lib/data/database/books-db/commit-transaction.mjs';
import { contentHashPrimaryKeys } from '$lib/data/database/books-db/content-hash-index';
import { allLinkedBooks } from '$lib/manabi/books';
import { captureLibraryOperation } from '$lib/manabi/operation-scope';
import { visibleLibraryEntries } from '$lib/library/account-visibility';
import {
  assertBookPersonalAccess,
  readBookSummaries
} from '$lib/data/database/books-db/book-records';
import {
  statisticIdentityPlan,
  type StatisticsMigrationGuard
} from '$lib/data/database/books-db/reader-statistics';
import type { BooksDbContentStatistic } from '$lib/data/database/books-db/versions/books-db';
import type { LibraryAccessIdentity } from '../native-library/contract';
import { statisticsRouteError } from './native-route';
import { assertBookAccessIdentity } from '$lib/data/database/books-db/book-identity';
import { getDateString, getStartHoursDate } from '$lib/functions/statistic-util';
import { HeatmapDataAggregration } from '$lib/components/statistics/statistics-heatmap/statistics-heatmap';
import { createStatisticsHeatmap } from './statistics-heatmap-controller';
import { aggregateStatistics } from './statistics-aggregation';
import { StatisticsReadingDataAggregationMode } from '$lib/components/statistics/statistics-types';
import {
  nativeStatisticsTimeSources,
  nativeStatisticsCharactersSources,
  nativeStatisticsSpeedSources,
  type NativeStatisticsQuery,
  type NativeStatisticsSelectionAdmission,
  type NativeStatisticsSnapshot,
  type NativeStatisticsRow,
  type NativeStatisticsAction
} from './native-contract';
export type {
  NativeStatisticsQuery,
  NativeStatisticsSnapshot,
  NativeStatisticsAction
} from './native-contract';
import {
  mutateNativeStatistics,
  readNativeStatisticsProof,
  verifyNativeStatisticsProofs,
  type NativeStatisticsProof
} from './native-transactions';
export interface NativeStatisticsAuthority {
  key: string;
  signal: AbortSignal;
  assertCurrent(): void;
}
const PAGE_SIZE = 25;
const MAX_HISTORY_ROWS = 10000;
const MAX_SNAPSHOTS = 4;
const SNAPSHOT_TTL = 10 * 60 * 1000;
function captureStatisticsOperation(authority?: NativeStatisticsAuthority) {
  const local = captureLibraryOperation(),
    controller = new AbortController();
  const abort = () => controller.abort();
  local.signal.addEventListener('abort', abort, { once: true });
  authority?.signal.addEventListener('abort', abort, { once: true });
  if (local.signal.aborted || authority?.signal.aborted) abort();
  return {
    profileId: local.profileId,
    signal: controller.signal,
    assertCurrent() {
      local.assertCurrent();
      authority?.assertCurrent();
      controller.signal.throwIfAborted();
    },
    stop() {
      local.stop();
      local.signal.removeEventListener('abort', abort);
      authority?.signal.removeEventListener('abort', abort);
    }
  };
}
interface SnapshotProof {
  complete?: boolean;
  verifiedComplete?: boolean;
  created: number;
  authorityKey?: string;
  scope: ReturnType<typeof captureStatisticsOperation>;
  books: Map<number, NativeStatisticsProof>;
  selection?: SelectionProof;
}
declare const sharedStatisticsAdmission: unique symbol;
export interface SharedStatisticsMutationAdmission {
  readonly [sharedStatisticsAdmission]: true;
}
const sharedMutationAdmissions = new WeakMap<object, SnapshotProof>();
/** A process-local admission, never represented by a bridge payload. */
export function admitSharedStatisticsMutation(
  snapshotId: string,
  authority: NativeStatisticsAuthority
): SharedStatisticsMutationAdmission {
  const proof = snapshots.get(snapshotId);
  if (!proof?.complete || !proof.verifiedComplete || proof.authorityKey !== authority.key)
    throw new Error('This shared statistics projection is not complete.');
  authority.assertCurrent();
  authority.signal.throwIfAborted();
  proof.scope.assertCurrent();
  const admission = Object.freeze({}) as SharedStatisticsMutationAdmission;
  sharedMutationAdmissions.set(admission, proof);
  return admission;
}
interface SelectionProof {
  retired?: boolean;
  created: number;
  authorityKey?: string;
  scope: ReturnType<typeof captureStatisticsOperation>;
  book: LibraryAccessIdentity;
}
const selections = new Map<string, SelectionProof>();
function assertSelection(selection: SelectionProof) {
  if (selection.retired) throw new Error(statisticsRouteError);
  selection.scope.assertCurrent();
  const age = Date.now() - selection.created;
  if (age < 0 || age > SNAPSHOT_TTL) throw new Error(statisticsRouteError);
}
function clearExpiredSelections() {
  for (const [id, selection] of selections) {
    try {
      assertSelection(selection);
    } catch {
      selection.retired = true;
      selection.scope.stop();
      selections.delete(id);
    }
  }
}
const snapshots = new Map<string, SnapshotProof>();
function retireSnapshot(id: string) {
  snapshots.get(id)?.scope.stop();
  snapshots.delete(id);
}
function clearExpiredSnapshots() {
  for (const [id, item] of snapshots) {
    if (item.scope.signal.aborted || Date.now() - item.created > SNAPSHOT_TTL) retireSnapshot(id);
  }
}

const MAX_BOOKS = 200;
const dateKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
export function normalizeNativeStatisticsQuery(
  input: NativeStatisticsQuery = {},
  complete = false
): Required<NativeStatisticsQuery> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          'selectionToken',
          'startDate',
          'endDate',
          'year',
          'bookIds',
          'bookSelection',
          'page',
          'aggregation',
          'sort',
          'direction',
          'timeSource',
          'charactersSource',
          'speedSource',
          'heatmapAggregation'
        ].includes(key)
    )
  )
    throw new Error('Invalid statistics filter.');
  const today = getDateString(getStartHoursDate(get(startDayHoursForTracker$)));
  const startDate = input.startDate ?? (get(lastStatisticsStartDate$) || today);
  const endDate = input.endDate ?? (get(lastStatisticsEndDate$) || today);
  if (!dateKey(startDate) || !dateKey(endDate)) throw new Error('Invalid statistics filter.');
  const year = input.year ?? Number(endDate.slice(0, 4));
  const bookIds = input.bookIds ?? [];
  const selectionToken = input.selectionToken === undefined ? '' : input.selectionToken;
  const bookSelection = input.bookSelection ?? (bookIds.length ? 'selected' : 'all');
  const aggregation = input.aggregation ?? 'title',
    sort = input.sort ?? 'time',
    direction = input.direction ?? 'desc';
  const timeSource = input.timeSource === undefined ? 'readingTime' : input.timeSource,
    charactersSource =
      input.charactersSource === undefined ? 'charactersRead' : input.charactersSource,
    speedSource = input.speedSource === undefined ? 'lastReadingSpeed' : input.speedSource,
    heatmapAggregation = input.heatmapAggregation === undefined ? 'year' : input.heatmapAggregation;
  if (
    startDate > endDate ||
    typeof selectionToken !== 'string' ||
    (selectionToken !== '' && !/^[A-Za-z0-9-]{1,64}$/.test(selectionToken)) ||
    !Number.isSafeInteger(year) ||
    year < 1000 ||
    year > 9999 ||
    !Array.isArray(bookIds) ||
    (!complete && bookIds.length > MAX_BOOKS) ||
    bookIds.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    !['all', 'selected'].includes(bookSelection) ||
    !['title', 'date', 'none'].includes(aggregation) ||
    !['title', 'date', 'time', 'characters', 'speed'].includes(sort) ||
    !['asc', 'desc'].includes(direction) ||
    !nativeStatisticsTimeSources.some((source) => source.key === timeSource) ||
    !nativeStatisticsCharactersSources.some((source) => source.key === charactersSource) ||
    !nativeStatisticsSpeedSources.some((source) => source.key === speedSource) ||
    !['year', 'all-time'].includes(heatmapAggregation) ||
    (input.page !== undefined && (!Number.isSafeInteger(input.page) || input.page < 1))
  )
    throw new Error('Invalid statistics filter.');
  return {
    selectionToken,
    startDate,
    endDate,
    year,
    bookIds: bookSelection === 'all' ? [] : [...new Set(bookIds)],
    bookSelection,
    page: input.page ?? 1,
    aggregation,
    sort,
    direction,
    timeSource,
    charactersSource,
    speedSource,
    heatmapAggregation
  };
}
function guardFor(
  scope: ReturnType<typeof captureStatisticsOperation>,
  selection?: SelectionProof
): StatisticsMigrationGuard {
  const assertCurrent = () => {
    scope.assertCurrent();
    if (selection) assertSelection(selection);
  };
  const validate: StatisticsMigrationGuard['validate'] = (book, owner) => {
    assertCurrent();
    if (!book) throw new Error('The selected statistics book no longer exists.');
    const expected = selection?.book;
    if (expected && book.id === expected.bookId)
      // Library normalizes valid digest casing. UUID comparison needs the local
      // record and runs in validateIdentity at the actual transaction boundary.
      assertBookAccessIdentity(book, { ...expected, readerBookKey: undefined });
    assertBookPersonalAccess(book, owner, scope.profileId);
    if (!visibleLibraryEntries([book], get(allLinkedBooks), scope.profileId).cards.length)
      throw new Error(
        'This reading history belongs to another profile or has conflicting ownership.'
      );
  };
  return {
    assertCurrent,
    signal: scope.signal,
    validate,
    validateCopy: validate,
    ...(selection
      ? {
          validateIdentity: ((book, local) => {
            assertCurrent();
            assertBookAccessIdentity(book, selection.book, local);
          }) satisfies NonNullable<StatisticsMigrationGuard['validateIdentity']>
        }
      : {})
  };
}

/** Admission-only Library Open. No history projection, migration, or mutation
 * proof is created here; the shared route still performs its full guarded read. */
export async function admitStatisticsLibrarySelection(
  book: LibraryAccessIdentity,
  authority: NativeStatisticsAuthority
): Promise<NativeStatisticsSelectionAdmission> {
  if (!/^(?:content:[a-f0-9]{64}|local:[A-Za-z0-9-]{1,128})$/.test(book.readerBookKey ?? ''))
    throw new Error(
      'Re-import this book before opening Statistics. Its original identity is unavailable.'
    );
  clearExpiredSelections();
  const scope = captureStatisticsOperation(authority);
  const selection: SelectionProof = {
    created: Date.now(),
    authorityKey: authority.key,
    scope,
    book: { ...book }
  };
  const guard = guardFor(scope, selection);
  let retained = false;
  try {
    guard.assertCurrent();
    if (get(allLinkedBooks) === null)
      throw new Error('Library ownership is still loading. Try again shortly.');
    const db = await database.db;
    guard.assertCurrent();
    const tx = db.transaction(['data', 'readerBookScope', 'readerLocalIdentity'], 'readonly');
    const abort = () => {
      try {
        tx.abort();
      } catch {
        /* Already settled. */
      }
    };
    scope.signal.addEventListener('abort', abort, { once: true });
    try {
      await commitTransaction(tx, async () => {
        const current = await tx.objectStore('data').get(book.bookId);
        const owner = await tx.objectStore('readerBookScope').get(book.bookId);
        const local = await tx.objectStore('readerLocalIdentity').get(book.bookId);
        guard.validate(current, owner);
        if (!current) throw new Error(statisticsRouteError);
        guard.validateIdentity?.(current, local);
        if (current.contentHash && /^[a-f0-9]{64}$/i.test(current.contentHash)) {
          const ids = await contentHashPrimaryKeys(
            tx.objectStore('data').index('contentHash'),
            current.contentHash,
            guard.assertCurrent,
            guard.signal
          );
          for (const id of ids) {
            const copy = await tx.objectStore('data').get(id);
            if (!copy) throw new Error(statisticsRouteError);
            guard.validateCopy?.(copy, await tx.objectStore('readerBookScope').get(id));
          }
        }
        guard.assertCurrent();
        guard.signal.throwIfAborted();
      });
    } finally {
      scope.signal.removeEventListener('abort', abort);
    }
    guard.assertCurrent();
    while (selections.size >= MAX_SNAPSHOTS) {
      const oldest = selections.keys().next().value!;
      const expired = selections.get(oldest)!;
      expired.retired = true;
      expired.scope.stop();
      selections.delete(oldest);
    }
    const selectionToken = crypto.randomUUID();
    selections.set(selectionToken, selection);
    retained = true;
    return { admissionVersion: 1, selectionToken, bookId: book.bookId };
  } finally {
    if (!retained) scope.stop();
  }
}

/** Reads only proven per-book identity ranges. Global/unresolved history is never
 * serialized to native and every shared-content claimant must pass the guard. */
export async function readStatisticsSnapshot(
  input: NativeStatisticsQuery = {},
  authority?: NativeStatisticsAuthority,
  /** DOM-only original Library admission; never read from a bridge payload. */
  libraryBook?: LibraryAccessIdentity,
  projection?: {
    complete: true;
    pageSize: number;
    selectedTitles?: string[];
    prefilteredBookKeys?: string[];
  }
): Promise<NativeStatisticsSnapshot> {
  const query = normalizeNativeStatisticsQuery(input, !!projection);
  const pageSize = projection?.pageSize ?? PAGE_SIZE;
  clearExpiredSelections();
  let selection: SelectionProof | undefined;
  if (libraryBook) {
    if (
      !/^(?:content:[a-f0-9]{64}|local:[A-Za-z0-9-]{1,128})$/.test(libraryBook.readerBookKey ?? '')
    )
      throw new Error(
        'Re-import this book before opening Statistics. Its original identity is unavailable.'
      );
    selection = {
      created: Date.now(),
      authorityKey: authority?.key,
      scope: captureStatisticsOperation(authority),
      book: { ...libraryBook }
    };
    query.selectionToken = crypto.randomUUID();
  } else if (query.selectionToken) {
    selection = selections.get(query.selectionToken);
    if (!selection || selection.authorityKey !== authority?.key)
      throw new Error(statisticsRouteError);
    assertSelection(selection);
  }
  if (selection) {
    if (query.bookIds.some((id) => id !== selection.book.bookId))
      throw new Error(statisticsRouteError);
    if (query.bookSelection === 'all') query.bookIds = [selection.book.bookId];
    query.bookSelection = 'selected';
  }
  const scope = captureStatisticsOperation(authority),
    guard = guardFor(scope, selection);
  let retained = false;
  try {
    scope.assertCurrent();
    const db = await database.db,
      summaries = await readBookSummaries(db);
    scope.assertCurrent();
    if (get(allLinkedBooks) === null)
      throw new Error('Library ownership is still loading. Try again shortly.');
    const visible = visibleLibraryEntries(summaries, get(allLinkedBooks), scope.profileId).cards;
    const chosen =
      query.bookSelection === 'selected'
        ? visible.filter((book) => query.bookIds.includes(book.id))
        : visible;
    if (query.bookIds.some((id) => !chosen.some((book) => book.id === id)))
      throw new Error('A selected book is no longer available to this profile.');
    const notices: string[] = [];
    if (!projection && !selection && visible.length > MAX_BOOKS)
      notices.push(
        `Showing the first ${MAX_BOOKS} available books. Choose individual books to narrow the history.`
      );
    const books: NativeStatisticsSnapshot['books'] = [],
      rows: BooksDbContentStatistic[] = [],
      readKeys = new Set<string>(),
      sourceRows = new Map<string, BooksDbContentStatistic[]>(),
      proofBooks = new Map<number, NativeStatisticsProof>();
    let legacyRowCount = 0;
    const available = selection
      ? visible.filter((book) => book.id === selection.book.bookId)
      : projection
        ? visible
        : visible.slice(0, MAX_BOOKS);
    if (selection && !available.length) throw new Error(statisticsRouteError);
    const toResolve = [
      ...available,
      ...chosen.filter((book) => !available.some((item) => item.id === book.id))
    ].slice(0, projection ? undefined : MAX_BOOKS + query.bookIds.length);
    for (const book of toResolve) {
      scope.assertCurrent();
      try {
        const owner = await db.get('readerBookScope', book.id);
        guard.validate(await db.get('data', book.id), owner);
        const plan = await statisticIdentityPlan(db, book.id, guard, book);
        if (selection && plan.bookKey !== selection.book.readerBookKey)
          throw new Error(statisticsRouteError);
        // A content-key statistic can be shared by multiple cached copies. One
        // inaccessible claimant makes this global identity unsafe to project.
        const copies = summaries.filter(
          (other) => other.contentHash && other.contentHash === book.contentHash
        );
        for (const copy of copies) {
          scope.assertCurrent();
          const currentCopy = await db.get('data', copy.id);
          if (!currentCopy) throw new Error('A statistics copy changed.');
          guard.validateCopy?.(currentCopy, await db.get('readerBookScope', copy.id));
        }
        books.push({
          id: book.id,
          title: projection ? book.title : book.title.slice(0, 512),
          bookKey: plan.bookKey,
          deletable:
            !plan.unresolvedLegacy &&
            book.title.length <= 512 &&
            (query.bookSelection === 'all' || query.bookIds.includes(book.id))
        });
        if (plan.unresolvedLegacy)
          notices.push(`Unresolved older history for “${book.title.slice(0, 120)}” is excluded.`);
        if (query.bookSelection === 'selected' && !query.bookIds.includes(book.id)) continue;
        const captured = await readNativeStatisticsProof(
          db,
          book.id,
          plan,
          guard,
          projection ? undefined : MAX_HISTORY_ROWS
        );
        const ownedRows: BooksDbContentStatistic[] = [];
        for (const key of plan.keys) {
          let history = sourceRows.get(key);
          if (!history) {
            history = captured.rows.filter((row) => row.bookKey === key);
            if (
              !projection &&
              [...sourceRows.values()].reduce((sum, value) => sum + value.length, 0) +
                history.length >
                MAX_HISTORY_ROWS
            )
              throw new Error('Too much history for one snapshot. Select fewer books.');
            sourceRows.set(key, history);
          }
          ownedRows.push(...history);
        }
        const legacyRows = captured.legacyRows;
        if (!projection && legacyRowCount + legacyRows.length > MAX_HISTORY_ROWS)
          throw new Error('Too much legacy history for one snapshot. Select fewer books.');
        legacyRowCount += legacyRows.length;
        proofBooks.set(book.id, { plan, rows: ownedRows, legacyRows });
        for (const key of plan.keys) {
          if (readKeys.has(key)) continue;
          readKeys.add(key);
          rows.push(
            ...ownedRows
              .filter((row) => row.bookKey === key)
              .map((row) => ({ ...row, title: book.title }))
          );
        }
      } catch (cause) {
        scope.assertCurrent();
        // A requested Library identity must not degrade to an empty/all-books view.
        if (selection || projection) throw cause;
        const index = books.findIndex((value) => value.id === book.id);
        if (index >= 0) books.splice(index, 1);
        notices.push(
          `History for “${book.title.slice(0, 120)}” could not be safely resolved or exceeds the snapshot limit. Select fewer books.`
        );
      }
    }
    scope.assertCurrent();
    rows.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const prefilteredRows = projection?.prefilteredBookKeys?.length
      ? rows.filter((row) => projection.prefilteredBookKeys!.includes(row.bookKey))
      : rows;
    const selectedTitles = projection
      ? new Set(
          projection.selectedTitles ??
            prefilteredRows.filter((row) => row.readingTime > 0).map((row) => row.title)
        )
      : undefined;
    const filteredRows = projection
      ? prefilteredRows.filter((row) => selectedTitles!.has(row.title))
      : rows;
    const selected = filteredRows.filter(
      (row) =>
        row.dateKey >= query.startDate &&
        row.dateKey <= query.endDate &&
        (!projection || row.readingTime > 0)
    );
    const totals = selected.reduce(
      (sum, row) => ({
        ...sum,
        time: sum.time + row.readingTime,
        characters: sum.characters + row.charactersRead
      }),
      {
        time: 0,
        characters: 0,
        speed: 0,
        days: new Set(selected.filter((row) => row.readingTime > 0).map((row) => row.dateKey)).size
      }
    );
    totals.speed = totals.time ? Math.ceil((totals.characters * 3600) / totals.time) : 0;
    // Feed only already-proven, selected identities to the original model. No
    // controller or global/ownerless database read participates in aggregation.
    const aggregated = aggregateStatistics(
      selected.map((row) => ({
        ...row,
        id: `${row.bookKey}_${row.dateKey}`,
        averageReadingTime: row.readingTime,
        averageWeightedReadingTime: row.readingTime,
        averageCharactersRead: row.charactersRead,
        averageWeightedCharactersRead: row.charactersRead,
        averageReadingSpeed: row.lastReadingSpeed,
        averageWeightedReadingSpeed: row.lastReadingSpeed
      })),
      query.aggregation === 'date'
        ? StatisticsReadingDataAggregationMode.DATE
        : query.aggregation === 'title'
          ? StatisticsReadingDataAggregationMode.TITLE
          : StatisticsReadingDataAggregationMode.NONE
    );
    const titleKeys = new Map<string, Set<string>>(),
      dateKeys = new Map<string, Set<string>>(),
      dateTitles = new Map<string, Set<string>>();
    const keyBooks = new Map<string, Set<number>>();
    if (projection) {
      for (const [id, proof] of proofBooks)
        for (const key of proof.plan.keys) {
          const ids = keyBooks.get(key) ?? new Set<number>();
          ids.add(id);
          keyBooks.set(key, ids);
        }
      for (const row of selected) {
        const titles = dateTitles.get(row.dateKey) ?? new Set<string>();
        titles.add(row.title);
        dateTitles.set(row.dateKey, titles);
        for (const [map, value] of [
          [titleKeys, row.title],
          [dateKeys, row.dateKey]
        ] as const) {
          const keys = map.get(value) ?? new Set<string>();
          keys.add(row.bookKey);
          map.set(value, keys);
        }
      }
    }
    const mutationTargets = (keys: Iterable<string>) => {
      const bookKeys = [...new Set(keys)];
      return {
        bookKeys,
        bookIds: [...new Set(bookKeys.flatMap((key) => [...(keyBooks.get(key) ?? [])]))]
      };
    };
    const summary: NativeStatisticsRow[] = aggregated.map((row, index) => {
      const book =
        query.aggregation === 'none'
          ? books.find(
              (item) =>
                item.deletable &&
                row.bookKey &&
                proofBooks.get(item.id)?.plan.keys.includes(row.bookKey)
            )
          : undefined;
      return {
        id: `${query.aggregation}:${index}`,
        title: query.aggregation === 'date' ? '' : projection ? row.title : row.title.slice(0, 512),
        date: query.aggregation === 'title' ? '' : row.dateKey,
        time: row.readingTime,
        characters: row.charactersRead,
        speed: row.lastReadingSpeed,
        ...(projection
          ? {
              sharedMutationTargets: mutationTargets(
                query.aggregation === 'date'
                  ? (dateKeys.get(row.dateKey) ?? [])
                  : query.aggregation === 'title'
                    ? (titleKeys.get(row.title) ?? [])
                    : row.bookKey
                      ? [row.bookKey]
                      : []
              ),
              affectedTitles:
                query.aggregation === 'date'
                  ? [...(dateTitles.get(row.dateKey) ?? [])]
                  : [row.title]
            }
          : {}),
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
        ...(book && row.bookKey
          ? { entry: { bookId: book.id, bookKey: row.bookKey, date: row.dateKey } }
          : {})
      };
    });
    const sortValue = (row: NativeStatisticsRow) => {
      switch (query.sort) {
        case 'time':
          return row.measurements[query.timeSource];
        case 'characters':
          return row.measurements[query.charactersSource];
        case 'speed':
          return row.measurements[query.speedSource];
        default:
          return row[query.sort];
      }
    };
    summary.sort((a, b) => {
      const left = sortValue(a),
        right = sortValue(b);
      const diff =
        typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right, 'ja-JP', { numeric: true })
          : Number(left) - Number(right);
      return (
        diff * (query.direction === 'asc' ? 1 : -1) ||
        a.title.localeCompare(b.title, 'ja-JP', { numeric: true })
      );
    });
    const today = getStartHoursDate(get(startDayHoursForTracker$));
    const heatmap = createStatisticsHeatmap({
      heatmapAggregration:
        query.heatmapAggregation === 'all-time'
          ? HeatmapDataAggregration.ALL_TIME
          : HeatmapDataAggregration.YEAR,
      statisticsData: filteredRows,
      readingGoals: [],
      statisticsTitleFilters: new Map(filteredRows.map((row) => [row.title, true])),
      today,
      todayKey: getDateString(today)
    });
    let calendar: Pick<
      NativeStatisticsSnapshot,
      | 'days'
      | 'daysRead'
      | 'currentStreak'
      | 'currentStreakDates'
      | 'longestStreak'
      | 'longestStreakCount'
      | 'longestStreaks'
      | 'currentStreakRange'
      | 'longestStreakStartDate'
      | 'longestStreakDates'
    >;
    try {
      heatmap.heatmapYear = query.year;
      heatmap.controller.prepare();
      const data = heatmap.currentHeatmapData;
      calendar = {
        days: heatmap.currentHeatmapDays
          .filter((day) => day.isCurrentYear)
          .map((day) => ({
            date: day.dateString,
            color: day.color,
            details: [
              ...(projection
                ? day.dayDetails
                : day.dayDetails.slice(0, 6).map((line) => line.slice(0, 160))),
              ...(!projection && day.dayDetails.length > 6
                ? [
                    `${day.dayDetails.length - 6} more detail lines. Narrow the book filter to inspect them.`
                  ]
                : [])
            ],
            time: day.readingTime
          })),
        daysRead: 'daysRead' in data ? data.daysRead : '',
        currentStreak: data.currentStreak.duration,
        currentStreakDates: heatmap.currentHeatmapDays
          .filter(
            (day) =>
              day.dateString >= data.currentStreak.startDate &&
              day.dateString <= data.currentStreak.endDate
          )
          .map((day) => day.dateString),
        longestStreak: data.longestStreaks[0]?.duration ?? 0,
        ...(projection
          ? {
              longestStreakCount: data.longestStreaks.length,
              longestStreaks: data.longestStreaks.map((streak) => ({ ...streak })),
              currentStreakRange: { ...data.currentStreak }
            }
          : {}),
        longestStreakStartDate: data.longestStreaks[0]?.startDate ?? null,
        longestStreakDates: heatmap.currentHeatmapDays
          .filter((day) =>
            data.longestStreaks.some(
              (streak) => day.dateString >= streak.startDate && day.dateString <= streak.endDate
            )
          )
          .map((day) => day.dateString)
      };
    } finally {
      heatmap.controller.destroy();
    }
    const pages = Math.max(1, Math.ceil(summary.length / pageSize));
    query.page = Math.min(query.page, pages);
    scope.assertCurrent();
    clearExpiredSnapshots();
    while (snapshots.size >= MAX_SNAPSHOTS) retireSnapshot(snapshots.keys().next().value!);
    const snapshotId = crypto.randomUUID();
    guard.assertCurrent();
    snapshots.set(snapshotId, {
      created: Date.now(),
      complete: !!projection,
      authorityKey: authority?.key,
      scope,
      books: proofBooks,
      selection
    });
    if (libraryBook && selection) {
      while (selections.size >= MAX_SNAPSHOTS) {
        const oldest = selections.keys().next().value!;
        const expired = selections.get(oldest)!;
        expired.retired = true;
        expired.scope.stop();
        selections.delete(oldest);
      }
      selections.set(query.selectionToken, selection);
    }
    retained = true;
    return {
      snapshotId,
      ...(projection
        ? { sharedMutationTargets: mutationTargets(selected.map((row) => row.bookKey)) }
        : {}),
      query,
      today: getDateString(today),
      weekStartsOn: get(lastStartDayOfWeek$),
      books,
      rows: summary.slice((query.page - 1) * pageSize, query.page * pageSize),
      totalRows: summary.length,
      ...(projection
        ? {
            selectionTitles: [...new Set(selected.map((row) => row.title))],
            allTitles: [...new Set(rows.map((row) => row.title))]
          }
        : {}),
      ...(projection
        ? {
            titleChoices: [
              ...new Set(rows.filter((row) => row.readingTime).map((row) => row.title))
            ].map((title) => ({
              title,
              inDateRange: rows.some(
                (row) =>
                  row.title === title &&
                  row.readingTime > 0 &&
                  row.dateKey >= query.startDate &&
                  row.dateKey <= query.endDate
              )
            }))
          }
        : {}),
      pages,
      totals,
      ...calendar,
      allTime: filteredRows.length
        ? {
            startDate: filteredRows[0].dateKey,
            endDate: filteredRows[filteredRows.length - 1].dateKey
          }
        : null,
      goals: {
        available: false,
        reason:
          'Reading goals are stored without account ownership. Goal display and editing are unavailable until goals can be assigned safely to this profile.'
      },
      notices: [...new Set(notices)].slice(0, projection ? undefined : 20)
    };
  } finally {
    if (!retained) scope.stop();
    if (!retained && libraryBook) selection?.scope.stop();
  }
}

/** Every mutation consumes an original, account-bound read proof. Failed or stale
 * confirmations must refresh; duplicate clicks cannot repeat a write. */
export async function dispatchStatisticsAction(
  input: NativeStatisticsAction,
  authority?: NativeStatisticsAuthority,
  sharedAdmission?: SharedStatisticsMutationAdmission,
  sharedTargetKeys?: ReadonlySet<string>
): Promise<{ saved?: true; deleted?: true }> {
  // Capture the trusted DOM subset before any asynchronous transaction work.
  sharedTargetKeys = sharedTargetKeys ? new Set(sharedTargetKeys) : undefined;
  const validBook = (id: unknown) => Number.isSafeInteger(id) && Number(id) > 0;
  const validKey = (key: unknown) =>
    typeof key === 'string' && /^(?:content:[a-f0-9]{64}|local:[A-Za-z0-9-]{1,128})$/.test(key);
  if (!input || typeof input.snapshotId !== 'string' || input.snapshotId.length > 64)
    throw new Error('Invalid statistics action.');
  if (input.type === 'delete-range') {
    if (
      !Array.isArray(input.bookIds) ||
      !input.bookIds.length ||
      (input.bookIds.length > MAX_BOOKS && !snapshots.get(input.snapshotId)?.complete) ||
      input.bookIds.some((id) => !validBook(id)) ||
      new Set(input.bookIds).size !== input.bookIds.length ||
      !dateKey(input.startDate) ||
      !dateKey(input.endDate) ||
      input.startDate > input.endDate
    )
      throw new Error('Invalid statistics action.');
  } else if (
    input.type === 'save-day' ||
    input.type === 'delete-book-history' ||
    input.type === 'delete-day'
  ) {
    if (
      !validBook(input.bookId) ||
      !validKey(input.bookKey) ||
      typeof input.title !== 'string' ||
      input.title.length > 512
    )
      throw new Error('Invalid statistics action.');
    if (input.type === 'delete-day' && !dateKey(input.date))
      throw new Error('Invalid statistics action.');
    if (
      input.type === 'save-day' &&
      (!dateKey(input.date) ||
        !['create', 'edit'].includes(input.mode) ||
        !Number.isSafeInteger(input.time) ||
        input.time < 0 ||
        input.time > 86400 ||
        !Number.isSafeInteger(input.characters) ||
        input.characters < 0 ||
        input.characters > 100000000 ||
        typeof input.resetMinMax !== 'boolean')
    )
      throw new Error('Invalid statistics action.');
  } else throw new Error('Invalid statistics action.');
  input = input.type === 'delete-range' ? { ...input, bookIds: [...input.bookIds] } : { ...input };
  clearExpiredSnapshots();
  const proof = snapshots.get(input.snapshotId);
  if (!proof || proof.authorityKey !== authority?.key)
    throw new Error(
      'This statistics view expired or changed accounts. Refresh before trying again.'
    );
  if (
    proof.complete
      ? !sharedAdmission || sharedMutationAdmissions.get(sharedAdmission) !== proof
      : !!sharedAdmission
  )
    throw new Error('Shared statistics mutations require a completed projection admission.');
  if (sharedTargetKeys && (!sharedAdmission || input.type !== 'delete-range'))
    throw new Error('Invalid shared mutation target.');
  if (proof.complete && input.type === 'delete-range') {
    const possible = new Set(input.bookIds.flatMap((id) => proof.books.get(id)?.plan.keys ?? []));
    if (!sharedTargetKeys?.size || [...sharedTargetKeys].some((key) => !possible.has(key)))
      throw new Error('The selected history keys changed. Refresh Statistics.');
  }
  if (sharedAdmission) sharedMutationAdmissions.delete(sharedAdmission);
  // Remove admission immediately but retain the guard until commit has finished.
  snapshots.delete(input.snapshotId);
  const { scope } = proof;
  const guard = guardFor(scope, proof.selection);
  try {
    authority?.assertCurrent();
    authority?.signal.throwIfAborted();
    scope.assertCurrent();
    if (input.type !== 'delete-range') {
      const book = proof.books.get(input.bookId);
      if (
        !book ||
        book.plan.title !== input.title ||
        (input.type === 'delete-book-history'
          ? book.plan.bookKey !== input.bookKey
          : !book.plan.keys.includes(input.bookKey))
      )
        throw new Error('This reading history changed. Refresh before trying again.');
    }
    const db = await database.db;
    scope.assertCurrent();
    await mutateNativeStatistics(db, proof.books, input, guard, sharedTargetKeys);
    scope.assertCurrent();
    return input.type === 'save-day' ? { saved: true } : { deleted: true };
  } finally {
    scope.stop();
  }
}

/** DOM-only continuation fence. Never migrates or mutates history. */
export async function verifyStatisticsSnapshot(
  snapshotId: string,
  authority: NativeStatisticsAuthority,
  includeRows = true
) {
  clearExpiredSnapshots();
  const proof = snapshots.get(snapshotId);
  if (!proof || !proof.complete || proof.authorityKey !== authority.key)
    throw new Error('This statistics transfer expired. Refresh Statistics.');
  authority.assertCurrent();
  authority.signal.throwIfAborted();
  await verifyNativeStatisticsProofs(
    await database.db,
    proof.books,
    guardFor(proof.scope, proof.selection),
    includeRows
  );
  authority.assertCurrent();
  if (includeRows) proof.verifiedComplete = true;
}
export function releaseStatisticsSnapshot(snapshotId: string) {
  retireSnapshot(snapshotId);
}
