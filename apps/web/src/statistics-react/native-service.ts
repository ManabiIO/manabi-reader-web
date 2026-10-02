/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
/** DOM-owner only. Never import this module from the Android JS bundle. */
/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
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
  deleteStatisticsForIdentityPlan,
  statisticIdentityPlan,
  statisticRange,
  type StatisticsMigrationGuard,
  type StatisticIdentityPlan
} from '$lib/data/database/books-db/reader-statistics';
import type { BooksDbContentStatistic } from '$lib/data/database/books-db/versions/books-db';
import { getDateString, getStartHoursDate } from '$lib/functions/statistic-util';
import { HeatmapDataAggregration } from '$lib/components/statistics/statistics-heatmap/statistics-heatmap';
import { createStatisticsHeatmap } from './statistics-heatmap-controller';
import type {
  NativeStatisticsQuery,
  NativeStatisticsSnapshot,
  NativeStatisticsRow,
  NativeStatisticsDelete
} from './native-contract';
export type {
  NativeStatisticsQuery,
  NativeStatisticsSnapshot,
  NativeStatisticsDelete
} from './native-contract';
const PAGE_SIZE = 25;
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
    bookIds: [...new Set(bookIds)],
    page: input.page ?? 1,
    aggregation,
    sort,
    direction
  };
}
function guardFor(scope: ReturnType<typeof captureLibraryOperation>): StatisticsMigrationGuard {
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
  input: NativeStatisticsQuery = {}
): Promise<NativeStatisticsSnapshot> {
  const query = normalizeNativeStatisticsQuery(input),
    scope = captureLibraryOperation(),
    guard = guardFor(scope);
  try {
    scope.assertCurrent();
    const db = await database.db,
      summaries = await readBookSummaries(db);
    scope.assertCurrent();
    if (get(allLinkedBooks) === null)
      throw new Error('Library ownership is still loading. Try again shortly.');
    const visible = visibleLibraryEntries(summaries, get(allLinkedBooks), scope.profileId).cards;
    const chosen = query.bookIds.length
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
      readKeys = new Set<string>();
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
          deletable: !plan.unresolvedLegacy && book.title.length <= 512
        });
        if (plan.unresolvedLegacy)
          notices.push(`Unresolved older history for “${book.title.slice(0, 120)}” is excluded.`);
        if (query.bookIds.length && !query.bookIds.includes(book.id)) continue;
        for (const key of plan.keys) {
          if (readKeys.has(key)) continue;
          readKeys.add(key);
          const history = await db.getAll('readerStatistic', statisticRange(key));
          scope.assertCurrent();
          rows.push(...history.map((row) => ({ ...row, title: book.title, bookKey: key })));
        }
      } catch (error) {
        scope.assertCurrent();
        notices.push(`History for “${book.title.slice(0, 120)}” could not be safely resolved.`);
      }
    }
    scope.assertCurrent();
    rows.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const selected = rows.filter(
      (row) => row.readingTime && row.dateKey >= query.startDate && row.dateKey <= query.endDate
    );
    const totals = selected.reduce(
      (sum, row) => ({
        ...sum,
        time: sum.time + row.readingTime,
        characters: sum.characters + row.charactersRead
      }),
      { time: 0, characters: 0, speed: 0, days: new Set(selected.map((row) => row.dateKey)).size }
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
        id: key,
        title: query.aggregation === 'date' ? '' : row.title.slice(0, 512),
        date: query.aggregation === 'title' ? '' : row.dateKey,
        time: 0,
        characters: 0,
        speed: 0
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
            details: day.dayDetails,
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
    return {
      query,
      today: getDateString(today),
      weekStartsOn: get(lastStartDayOfWeek$),
      books,
      rows: summary.slice((query.page - 1) * PAGE_SIZE, query.page * PAGE_SIZE),
      totalRows: summary.length,
      pages,
      totals,
      ...calendar,
      notices: [...new Set(notices)].slice(0, 20)
    };
  } finally {
    scope.stop();
  }
}

/** Deliberately bounded: this operation means all history for one displayed book.
 * Date-range deletion/editing need a transaction-scoped domain API before bridging. */
export async function dispatchStatisticsAction(
  input: NativeStatisticsDelete
): Promise<{ deleted: true }> {
  if (
    !input ||
    input.type !== 'delete-book-history' ||
    !Number.isSafeInteger(input.bookId) ||
    input.bookId < 1 ||
    typeof input.title !== 'string' ||
    input.title.length > 512 ||
    typeof input.bookKey !== 'string' ||
    !/^(?:content:[a-f0-9]{64}|local:[A-Za-z0-9-]{1,128})$/.test(input.bookKey)
  )
    throw new Error('Invalid statistics action.');
  const scope = captureLibraryOperation(),
    guard = guardFor(scope);
  try {
    scope.assertCurrent();
    const db = await database.db;
    const book = await db.get('data', input.bookId);
    guard.validate(book, await db.get('readerBookScope', input.bookId));
    if (!book || book.title !== input.title)
      throw new Error('This statistics book changed. Refresh before deleting.');
    const plan: StatisticIdentityPlan = await statisticIdentityPlan(db, input.bookId, guard, book);
    if (plan.bookKey !== input.bookKey)
      throw new Error('This reading history changed. Refresh before deleting.');
    await deleteStatisticsForIdentityPlan(db, input.bookId, plan, guard);
    scope.assertCurrent();
    return { deleted: true };
  } finally {
    scope.stop();
  }
}
