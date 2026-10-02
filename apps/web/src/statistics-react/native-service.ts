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
import { getDateString, getStartHoursDate } from '$lib/functions/statistic-util';
import { HeatmapDataAggregration } from '$lib/components/statistics/statistics-heatmap/statistics-heatmap';
import { createStatisticsHeatmap } from './statistics-heatmap-controller';
import type {
  NativeStatisticsQuery,
  NativeStatisticsSnapshot,
  NativeStatisticsRow,
  NativeStatisticsAction
} from './native-contract';
export type {
  NativeStatisticsQuery,
  NativeStatisticsSnapshot,
  NativeStatisticsAction
} from './native-contract';
import {
  mutateNativeStatistics,
  readNativeStatisticsProof,
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
  created: number;
  authorityKey?: string;
  scope: ReturnType<typeof captureStatisticsOperation>;
  books: Map<number, NativeStatisticsProof>;
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
  input: NativeStatisticsQuery = {}
): Required<NativeStatisticsQuery> {
  const today = getDateString(getStartHoursDate(get(startDayHoursForTracker$)));
  const startDate = input.startDate ?? (get(lastStatisticsStartDate$) || today);
  const endDate = input.endDate ?? (get(lastStatisticsEndDate$) || today);
  const year = input.year ?? Number(endDate.slice(0, 4));
  const bookIds = input.bookIds ?? [];
  const bookSelection = input.bookSelection ?? (bookIds.length ? 'selected' : 'all');
  const aggregation = input.aggregation ?? 'title',
    sort = input.sort ?? 'time',
    direction = input.direction ?? 'desc';
  if (
    !dateKey(startDate) ||
    !dateKey(endDate) ||
    startDate > endDate ||
    !Number.isSafeInteger(year) ||
    year < 1000 ||
    year > 9999 ||
    !Array.isArray(bookIds) ||
    bookIds.length > MAX_BOOKS ||
    bookIds.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    !['all', 'selected'].includes(bookSelection) ||
    !['title', 'date', 'none'].includes(aggregation) ||
    !['title', 'date', 'time', 'characters', 'speed'].includes(sort) ||
    !['asc', 'desc'].includes(direction) ||
    (input.page !== undefined && (!Number.isSafeInteger(input.page) || input.page < 1))
  )
    throw new Error('Invalid statistics filter.');
  return {
    startDate,
    endDate,
    year,
    bookIds: bookSelection === 'all' ? [] : [...new Set(bookIds)],
    bookSelection,
    page: input.page ?? 1,
    aggregation,
    sort,
    direction
  };
}
function guardFor(scope: ReturnType<typeof captureStatisticsOperation>): StatisticsMigrationGuard {
  const validate: StatisticsMigrationGuard['validate'] = (book, owner) => {
    scope.assertCurrent();
    if (!book) throw new Error('The selected statistics book no longer exists.');
    assertBookPersonalAccess(book, owner, scope.profileId);
    if (!visibleLibraryEntries([book], get(allLinkedBooks), scope.profileId).cards.length)
      throw new Error(
        'This reading history belongs to another profile or has conflicting ownership.'
      );
  };
  return {
    assertCurrent: scope.assertCurrent,
    signal: scope.signal,
    validate,
    validateCopy: validate
  };
}

/** Reads only proven per-book identity ranges. Global/unresolved history is never
 * serialized to native and every shared-content claimant must pass the guard. */
export async function readStatisticsSnapshot(
  input: NativeStatisticsQuery = {},
  authority?: NativeStatisticsAuthority
): Promise<NativeStatisticsSnapshot> {
  const query = normalizeNativeStatisticsQuery(input),
    scope = captureStatisticsOperation(authority),
    guard = guardFor(scope);
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
    if (visible.length > MAX_BOOKS)
      notices.push(
        `Showing the first ${MAX_BOOKS} available books. Choose individual books to narrow the history.`
      );
    const books: NativeStatisticsSnapshot['books'] = [],
      rows: BooksDbContentStatistic[] = [],
      readKeys = new Set<string>(),
      sourceRows = new Map<string, BooksDbContentStatistic[]>(),
      proofBooks = new Map<number, NativeStatisticsProof>();
    let legacyRowCount = 0;
    const available = visible.slice(0, MAX_BOOKS);
    const toResolve = [
      ...available,
      ...chosen.filter((book) => !available.some((item) => item.id === book.id))
    ].slice(0, MAX_BOOKS + query.bookIds.length);
    for (const book of toResolve) {
      scope.assertCurrent();
      try {
        const owner = await db.get('readerBookScope', book.id);
        guard.validate(await db.get('data', book.id), owner);
        const plan = await statisticIdentityPlan(db, book.id, guard, book);
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
          title: book.title.slice(0, 512),
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
          MAX_HISTORY_ROWS
        );
        const ownedRows: BooksDbContentStatistic[] = [];
        for (const key of plan.keys) {
          let history = sourceRows.get(key);
          if (!history) {
            history = captured.rows.filter((row) => row.bookKey === key);
            if (
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
        if (legacyRowCount + legacyRows.length > MAX_HISTORY_ROWS)
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
      } catch {
        scope.assertCurrent();
        const index = books.findIndex((value) => value.id === book.id);
        if (index >= 0) books.splice(index, 1);
        notices.push(
          `History for “${book.title.slice(0, 120)}” could not be safely resolved or exceeds the snapshot limit. Select fewer books.`
        );
      }
    }
    scope.assertCurrent();
    rows.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const selected = rows.filter(
      (row) => row.dateKey >= query.startDate && row.dateKey <= query.endDate
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
    const groups = new Map<string, NativeStatisticsRow>();
    for (const row of selected) {
      const key =
        query.aggregation === 'date'
          ? row.dateKey
          : query.aggregation === 'title'
            ? row.title
            : `${row.bookKey}_${row.dateKey}`;
      const previous = groups.get(key) ?? {
        id: `${query.aggregation}:${groups.size}`,
        title: query.aggregation === 'date' ? '' : row.title.slice(0, 512),
        date: query.aggregation === 'title' ? '' : row.dateKey,
        time: 0,
        characters: 0,
        speed: 0,
        ...(query.aggregation === 'none'
          ? {
              entry: (() => {
                const book = books.find(
                  (item) =>
                    item.deletable && proofBooks.get(item.id)?.plan.keys.includes(row.bookKey)
                );
                return book
                  ? { bookId: book.id, bookKey: row.bookKey, date: row.dateKey }
                  : undefined;
              })()
            }
          : {})
      };
      previous.time += row.readingTime;
      previous.characters += row.charactersRead;
      previous.speed = previous.time ? Math.ceil((previous.characters * 3600) / previous.time) : 0;
      groups.set(key, previous);
    }
    const summary = [...groups.values()].sort((a, b) => {
      const left = a[query.sort],
        right = b[query.sort];
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
      heatmapAggregration: HeatmapDataAggregration.YEAR,
      statisticsData: rows,
      readingGoals: [],
      statisticsTitleFilters: new Map(rows.map((row) => [row.title, true])),
      today,
      todayKey: getDateString(today)
    });
    let calendar: Pick<
      NativeStatisticsSnapshot,
      'days' | 'daysRead' | 'currentStreak' | 'longestStreak' | 'longestStreakDates'
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
              ...day.dayDetails.slice(0, 6).map((line) => line.slice(0, 160)),
              ...(day.dayDetails.length > 6
                ? [
                    `${day.dayDetails.length - 6} more detail lines. Narrow the book filter to inspect them.`
                  ]
                : [])
            ],
            time: day.readingTime
          })),
        daysRead: 'daysRead' in data ? data.daysRead : '',
        currentStreak: data.currentStreak.duration,
        longestStreak: data.longestStreaks[0]?.duration ?? 0,
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
    const pages = Math.max(1, Math.ceil(summary.length / PAGE_SIZE));
    query.page = Math.min(query.page, pages);
    scope.assertCurrent();
    clearExpiredSnapshots();
    while (snapshots.size >= MAX_SNAPSHOTS) retireSnapshot(snapshots.keys().next().value!);
    const snapshotId = crypto.randomUUID();
    snapshots.set(snapshotId, {
      created: Date.now(),
      authorityKey: authority?.key,
      scope,
      books: proofBooks
    });
    retained = true;
    return {
      snapshotId,
      query,
      today: getDateString(today),
      weekStartsOn: get(lastStartDayOfWeek$),
      books,
      rows: summary.slice((query.page - 1) * PAGE_SIZE, query.page * PAGE_SIZE),
      totalRows: summary.length,
      pages,
      totals,
      ...calendar,
      allTime: rows.length
        ? { startDate: rows[0].dateKey, endDate: rows[rows.length - 1].dateKey }
        : null,
      goals: {
        available: false,
        reason:
          'Reading goals are stored without account ownership. Goal display and editing are unavailable until goals can be assigned safely to this profile.'
      },
      notices: [...new Set(notices)].slice(0, 20)
    };
  } finally {
    if (!retained) scope.stop();
  }
}

/** Every mutation consumes an original, account-bound read proof. Failed or stale
 * confirmations must refresh; duplicate clicks cannot repeat a write. */
export async function dispatchStatisticsAction(
  input: NativeStatisticsAction,
  authority?: NativeStatisticsAuthority
): Promise<{ saved?: true; deleted?: true }> {
  const validBook = (id: unknown) => Number.isSafeInteger(id) && Number(id) > 0;
  const validKey = (key: unknown) =>
    typeof key === 'string' && /^(?:content:[a-f0-9]{64}|local:[A-Za-z0-9-]{1,128})$/.test(key);
  if (!input || typeof input.snapshotId !== 'string' || input.snapshotId.length > 64)
    throw new Error('Invalid statistics action.');
  if (input.type === 'delete-range') {
    if (
      !Array.isArray(input.bookIds) ||
      !input.bookIds.length ||
      input.bookIds.length > MAX_BOOKS ||
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
  // Remove admission immediately but retain the guard until commit has finished.
  snapshots.delete(input.snapshotId);
  const { scope } = proof;
  const guard = guardFor(scope);
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
    await mutateNativeStatistics(db, proof.books, input, guard);
    scope.assertCurrent();
    return input.type === 'save-day' ? { saved: true } : { deleted: true };
  } finally {
    scope.stop();
  }
}
