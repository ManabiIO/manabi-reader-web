/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as rxjs from 'rxjs';
import pLimit from 'p-limit';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';

const root = fileURLToPath(new URL('../../apps/web/src/', import.meta.url));
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function fixture() {
  const frames = [],
    exports = new Map(),
    errors = [],
    copied = [],
    deleted = [],
    updated = [];
  const writableSubject = (value) => {
    const s = new rxjs.BehaviorSubject(value);
    s.set = (v) => s.next(v);
    return s;
  };
  const defaults = {
    lastStatisticsStartDate$: '2024-01-01',
    lastStatisticsEndDate$: '2024-12-31',
    lastStatisticsRangeTemplate$: 'Custom',
    lastStartDayOfWeek$: 1,
    startDayHoursForTracker$: 0,
    lastPrimaryReadingDataAggregationMode$: 'none',
    lastStatisticsTab$: 'summary',
    lastReadingDataHeatmapAggregationMode$: 'year',
    lastReadingGoalsHeatmapAggregationMode$: 'year',
    skipKeyDownListener$: false,
    confirmStatisticsDeletion$: false,
    lastStatisticsFilterDateRangeOnly$: false,
    lastStatisticsFilterShowSelectedTitlesOnly$: false,
    lastReadingTimeDataSource$: 'readingTime',
    lastCharactersDataSource$: 'charactersRead',
    lastReadingSpeedDataSource$: 'lastReadingSpeed',
    lastStatisticsSummarySortDirection$: 'desc',
    lastStatisticsSummarySortProperty$: 'readingTime',
    lastBlurredTrackerItems$: [],
    statisticsTabKeybindMap$: {}
  };
  const store = Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, writableSubject(value)])
  );
  const db = {
    lastItem$: writableSubject(undefined),
    db: Promise.resolve({ getAll: async () => [] }),
    getAllStatistics: async () => [],
    getReadingGoals: async () => [],
    deleteStatisticEntries: async (...args) => {
      deleted.push(args);
    },
    updateStatistic: async (value) => {
      updated.push(value);
    }
  };
  store.database = db;
  const dialogs = { dialogs$: writableSubject([]) };
  const scopeAbort = new AbortController();
  const mock = {
    '$lib/manabi/operation-scope': {
      captureLibraryOperation: () => ({
        profileId: 'me',
        signal: scopeAbort.signal,
        assertCurrent() {
          if (scopeAbort.signal.aborted) throw new Error('account_changed');
        },
        stop() {}
      })
    },
    react: {},
    rxjs,
    'rxjs/operators': rxjs,
    'p-limit': { __esModule: true, default: pLimit },
    '$lib/data/store': store,
    '$lib/functions/svelte/store': { writableSubject },
    '$lib/data/dialog-manager': { dialogManager: dialogs },
    '$lib/data/logger': { logger: { error: (message) => errors.push(message) } },
    '$lib/hooks/observe-element-width': { observeElementWidth: () => () => {} },
    '$lib/functions/utils': {
      pluralize: (n, term, count = true) => `${count ? n + ' ' : ''}${term}${n === 1 ? '' : 's'}`,
      limitToRange: (min, max, value) => Math.max(min, Math.min(max, value)),
      caluclatePercentage: (value, total) => Math.floor((value / total) * 100),
      convertRemToPixels: (_window, value) => value * 16,
      getFullHeight: () => 500
    },
    '$lib/data/storage/storage-handler-factory': {
      getStorageHandler() {
        throw new Error('Unexpected export');
      }
    },
    '../ui/dialogs': {
      ConfirmDialog: function ConfirmDialog() {},
      MessageDialog: function MessageDialog() {}
    },
    '../routes/b/on-keydown-reader': { onKeyUpStatisticsTab: () => false }
  };
  const window = {
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {}
  };
  function load(relative) {
    const filename = resolve(root, relative);
    if (exports.has(filename)) return exports.get(filename);
    const result = {};
    exports.set(filename, result);
    const source = readFileSync(filename, 'utf8');
    const code = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    }).outputText;
    runInNewContext(
      code,
      {
        exports: result,
        Date,
        Set,
        Map,
        Promise,
        Array,
        Math,
        Error,
        Object,
        Symbol,
        Number,
        String,
        RegExp,
        IDBKeyRange,
        crypto: globalThis.crypto,
        queueMicrotask,
        setTimeout,
        clearTimeout,
        console,
        window,
        AbortController,
        requestAnimationFrame: (cb) => {
          frames.push(cb);
          return frames.length;
        },
        cancelAnimationFrame() {},
        document: { activeElement: null },
        navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
        CustomEvent: class CustomEvent {
          constructor(type, { detail }) {
            this.type = type;
            this.detail = detail;
          }
        },
        require(name) {
          if (name in mock) return mock[name];
          if (name.startsWith('$lib/')) return load(`lib/${name.slice(5)}.ts`);
          if (name.startsWith('.'))
            return load(
              resolve(dirname(filename), name + (/\.[cm]?[jt]s$/.test(name) ? '' : '.ts'))
            );
          throw new Error(`Unexpected dependency ${name} in ${relative}`);
        }
      },
      { filename }
    );
    return result;
  }
  const types = load('lib/components/statistics/statistics-types.ts');
  const heatmap = load('lib/components/statistics/statistics-heatmap/statistics-heatmap.ts');
  const trackers = load('lib/components/book-reader/book-reading-tracker/book-reading-tracker.ts');
  const row = (title, dateKey, time = 60, bookKey) => ({
    ...trackers.getDefaultStatistic(title, dateKey),
    readingTime: time,
    charactersRead: time * 2,
    lastReadingSpeed: 7200,
    bookKey
  });
  const frame = async () => {
    const ready = frames.splice(0);
    ready.forEach((cb) => cb());
    await settle();
  };
  const start = (name, props = {}) => {
    const key = name
      .split('-')
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join('');
    const value = load(`statistics-react/${name}-controller.ts`)[`create${key}`](props);
    value.controller.prepare();
    value.controller.start();
    return value;
  };
  return {
    load,
    start,
    scopeAbort,
    mock,
    writableSubject,
    store,
    types,
    heatmap,
    trackers,
    dialogs,
    copied,
    deleted,
    updated,
    errors,
    db,
    row,
    frame,
    frames
  };
}

test('React date templates publish every date-store write, including destructured source assignments', async () => {
  const f = fixture();
  const c = f.start('statistics-screen');
  for (const [template, date, expected] of [
    [f.types.StatisticsRangeTemplate.WEEK, '2024-02-29', ['2024-02-26', '2024-03-03']],
    [f.types.StatisticsRangeTemplate.MONTH, '2024-02-29', ['2024-02-01', '2024-02-29']],
    [f.types.StatisticsRangeTemplate.YEAR, '2024-02-29', ['2024-01-01', '2024-12-31']]
  ]) {
    f.store.lastStatisticsRangeTemplate$.next(template);
    c.setSelectedStatisticsDays(new Date(`${date}T12:00:00`));
    assert.deepEqual(
      [f.store.lastStatisticsStartDate$.value, f.store.lastStatisticsEndDate$.value],
      expected
    );
  }
  c.controller.destroy();
  await f.frame();
});

test('React custom dates reorder reversed inputs without losing either bound', () => {
  const f = fixture();
  const c = f.start('statistics-screen');
  c.handleSelectedStatisticsDateChange({ detail: { isStartDate: true, dateString: '2025-02-01' } });
  assert.equal(f.store.lastStatisticsStartDate$.value, '2024-12-31');
  assert.equal(f.store.lastStatisticsEndDate$.value, '2025-02-01');
  assert.equal(f.store.lastStatisticsRangeTemplate$.value, f.types.StatisticsRangeTemplate.CUSTOM);
  c.controller.destroy();
});

test('React Strict Mode prepare/cleanup does not clear a book prefilter', async () => {
  const f = fixture();
  const key = `content:${'a'.repeat(64)}`;
  f.types.preFilteredBookKeysForStatistics$.next(new Set([key]));
  const probe = f
    .load('statistics-react/statistics-screen-controller.ts')
    .createStatisticsScreen({});
  probe.controller.prepare();
  probe.controller.destroy();
  await f.frame();
  assert.equal(f.types.preFilteredBookKeysForStatistics$.value.has(key), true);
  const real = f.start('statistics-screen');
  real.controller.destroy();
  assert.equal(f.types.preFilteredBookKeysForStatistics$.value.size, 0);
});

test('React title filter retains private draft changes through search, paging, and unrelated store emissions', async () => {
  const f = fixture(),
    titles = new Map(Array.from({ length: 61 }, (_, i) => [`Title ${i}`, true]));
  const c = f.start('statistics-title-filter', {
    statisticsTitleFilters: titles,
    titlesInStatisticsDateRange: new Set(titles.keys())
  });
  c.selectTitle('Title 0', false);
  c.page = 3;
  await settle();
  f.store.skipKeyDownListener$.next(true);
  await settle();
  assert.equal(c.titlesToFilter[0].isSelected, false);
  assert.equal(titles.get('Title 0'), true);
  assert.equal(c.current.page, 3);
  assert.equal(c.current.rows.length, 11);
  c.titleFilter = 'Title 60';
  await settle();
  assert.equal(c.current.page, 1);
  assert.equal(c.current.rows[0].title, 'Title 60');
  c.controller.destroy();
  assert.equal(f.store.skipKeyDownListener$.value, false);
});

test('React summary keeps an in-progress edit through resize and only resets for changed data', async () => {
  const f = fixture(),
    rows = [f.row('One', '2024-02-28'), f.row('Two', '2024-02-29')];
  const c = f.start('statistics-summary', {
    aggregratedStatistics: rows,
    statisticsDateRangeLabel: '2024'
  });
  await f.frame();
  c.setRowInEditMode(rows[0]);
  c.rowInEditCharacters = 123;
  c.updateRowsPerPage(false);
  await f.frame();
  assert.equal(c.rowInEdit, rows[0]);
  assert.equal(c.rowInEditCharacters, 123);
  c.updateProps({ aggregratedStatistics: [...rows] });
  await settle();
  assert.equal(c.rowInEdit, undefined);
  c.controller.destroy();
  await f.frame();
});

test('React heatmap preserves year navigation and highlighted streak on unrelated renders', async () => {
  const f = fixture(),
    rows = [f.row('One', '2024-02-28'), f.row('One', '2024-02-29')];
  const props = {
    heatmapAggregration: f.heatmap.HeatmapDataAggregration.YEAR,
    statisticsData: rows,
    readingGoals: [],
    statisticsTitleFilters: new Map([['One', true]]),
    today: new Date('2024-02-29T12:00:00'),
    todayKey: '2024-02-29'
  };
  const c = f.start('statistics-heatmap', props);
  await settle();
  assert.equal(c.currentHeatmapDays.filter((day) => day.isCurrentYear).length, 366);
  assert.equal(c.currentHeatmapData.daysRead, '2 / 2 days (100%)');
  assert.equal(c.currentHeatmapData.longestStreaks[0].duration, 2);
  await c.highlightStreaks(
    c.currentHeatmapData.longestStreaks,
    f.heatmap.HeatmapStreakType.LONGEST
  );
  await settle();
  const selected = c.selectedStreakDates;
  c.updateProps(props);
  await settle();
  assert.equal(c.selectedStreakDates, selected);
  assert.equal(selected.size, 2);
  c.changeHeatmapYear(1);
  await settle();
  assert.equal(c.heatmapYear, 2025);
  assert.equal(c.currentHeatmapDays.filter((day) => day.isCurrentYear).length, 365);
  c.updateProps(props);
  await settle();
  assert.equal(c.heatmapYear, 2025);
  c.controller.destroy();
  await f.frame();
});

test('React content caches book-prefilter projections, preserves identities, and deletes only selected dates', async () => {
  const f = fixture(),
    a = `content:${'a'.repeat(64)}`,
    b = `content:${'b'.repeat(64)}`;
  f.types.preFilteredBookKeysForStatistics$.next(new Set([a]));
  f.db.getAllStatistics = async () => [
    f.row('Same', '2024-02-28', 60, a),
    f.row('Same', '2024-02-29', 90, b),
    f.row('Same', '2025-01-01', 120, a)
  ];
  const c = f.start('statistics-content');
  await settle();
  assert.equal(c.statisticsForSelection.length, 1);
  const stable = c.bookPrefilterStatistics;
  c.updateProps({});
  await settle();
  assert.equal(c.bookPrefilterStatistics, stable);
  await c.handleDeleteRequest({
    detail: { startDate: '2024-02-28', endDate: '2024-02-28', titlesToCheck: new Set(['Same']) }
  });
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(f.deleted)), [
    [[], false, '2024-02-28', '2024-02-28', [a]]
  ]);
  assert.deepEqual(
    c.statisticsData.map((r) => r.bookKey + '/' + r.dateKey),
    [b + '/2024-02-29', a + '/2025-01-01']
  );
  c.controller.destroy();
});

test('React content cancels its confirmation on teardown without deleting another route’s dialog', async () => {
  const f = fixture();
  f.store.confirmStatisticsDeletion$.next(true);
  f.db.getAllStatistics = async () => [f.row('One', '2024-02-28', 60, 'local:one')];
  const c = f.start('statistics-content');
  await settle();
  const pending = c.handleDeleteRequest({
    detail: { startDate: '', endDate: '', titlesToCheck: new Set(['One']) }
  });
  assert.equal(f.dialogs.dialogs$.value[0].props.dialogHeader, 'Delete Data');
  const other = { component: 'other', props: { title: 'Unrelated dialog' } };
  f.dialogs.dialogs$.next([other]);
  c.controller.destroy();
  await pending;
  assert.equal(f.deleted.length, 0);
  assert.equal(f.dialogs.dialogs$.value[0], other);
  assert.equal(f.types.statisticsActionInProgress$.value, false);
});

test('React content refuses duplicate actions and account changes before confirmation commits', async () => {
  const f = fixture();
  f.store.confirmStatisticsDeletion$.next(true);
  f.db.getAllStatistics = async () => [f.row('One', '2024-02-28', 60, 'local:one')];
  const c = f.start('statistics-content');
  await settle();
  const event = { detail: { startDate: '', endDate: '', titlesToCheck: new Set(['One']) } };
  const pending = c.handleDeleteRequest(event),
    shown = f.dialogs.dialogs$.value[0];
  await c.handleDeleteRequest(event);
  assert.equal(f.dialogs.dialogs$.value[0], shown);
  f.scopeAbort.abort();
  await pending;
  await settle();
  assert.equal(f.deleted.length, 0);
  assert.equal(c.statisticsData.length, 0);
  assert.equal(f.types.statisticsActionInProgress$.value, false);
  c.controller.destroy();
});

test('a late old-route delete cannot release a newer route’s progress lease', async () => {
  const f = fixture(),
    resolvers = [];
  f.db.getAllStatistics = async () => [f.row('One', '2024-02-28', 60, 'local:one')];
  f.db.deleteStatisticEntries = () => new Promise((resolve) => resolvers.push(resolve));
  const old = f.start('statistics-content');
  await settle();
  const event = { detail: { startDate: '', endDate: '', titlesToCheck: new Set(['One']) } };
  const first = old.handleDeleteRequest(event);
  old.controller.destroy();
  const next = f.start('statistics-content');
  await settle();
  const second = next.handleDeleteRequest(event);
  assert.equal(f.types.statisticsActionInProgress$.value, true);
  resolvers[0]();
  await first;
  assert.equal(f.types.statisticsActionInProgress$.value, true);
  resolvers[1]();
  await second;
  assert.equal(f.types.statisticsActionInProgress$.value, false);
  next.controller.destroy();
});

test('React goal heatmap retains original completion and daily streak calculations', async () => {
  const f = fixture();
  const c = f.start('statistics-heatmap', {
    heatmapType: f.heatmap.HeatmapType.READING_GOALS,
    heatmapAggregration: f.heatmap.HeatmapDataAggregration.YEAR,
    statisticsData: [f.row('One', '2024-02-28'), f.row('One', '2024-02-29')],
    readingGoals: [
      {
        goalStartDate: '2024-02-28',
        goalEndDate: '',
        goalOriginalEndDate: '',
        timeGoal: 60,
        characterGoal: 120,
        goalFrequency: f.trackers.ReadingGoalFrequency.DAILY,
        lastGoalModified: 1
      }
    ],
    statisticsTitleFilters: new Map([['One', true]]),
    today: new Date('2024-02-29T12:00:00'),
    todayKey: '2024-02-29'
  });
  await settle();
  assert.equal(c.currentHeatmapData.longestStreaks[0].duration, 2);
  assert.match(c.currentHeatmapData.completedReadingGoals, /^2 /);
  const leap = c.currentHeatmapDays.find((day) => day.dateString === '2024-02-29');
  assert.ok(leap.dayDetails.some((detail) => detail.includes('100%')));
  c.controller.destroy();
  await f.frame();
});

test('React selection export refuses ambiguous same-title identities and restores the action lease', async () => {
  const f = fixture();
  f.db.getAllStatistics = async () => [
    f.row('Same', '2024-02-28', 60, 'local:one'),
    f.row('Same', '2024-02-29', 60, 'local:two')
  ];
  const c = f.start('statistics-content');
  await settle();
  f.types.exportStatisticsData$.next(false);
  await settle();
  assert.equal(f.dialogs.dialogs$.value[0].props.title, 'Statistics export unavailable');
  assert.match(f.dialogs.dialogs$.value[0].props.message, /same title|identity|identities/i);
  assert.equal(f.types.statisticsActionInProgress$.value, false);
  c.controller.destroy();
});

let dbSerial = 0;
async function nativeFixture() {
  const f = fixture();
  const db = await openDB(`native-statistics-controller-${++dbSerial}`, 1, {
    upgrade(db) {
      const data = db.createObjectStore('data', { keyPath: 'id' });
      data.createIndex('title', 'title');
      data.createIndex('contentHash', 'contentHash');
      db.createObjectStore('readerBookScope', { keyPath: 'bookId' });
      db.createObjectStore('readerLocalIdentity', { keyPath: 'bookId' });
      db.createObjectStore('readerStatisticMigration', { keyPath: 'title' });
      const content = db.createObjectStore('readerStatistic', { keyPath: ['bookKey', 'dateKey'] });
      content.createIndex('dateKey', 'dateKey');
      const legacy = db.createObjectStore('statistic', { keyPath: ['title', 'dateKey'] });
      legacy.createIndex('dateKey', 'dateKey');
      db.createObjectStore('lastModified', { keyPath: ['title', 'dataType'] });
    }
  });
  f.db.db = Promise.resolve(db);
  f.mock['$lib/manabi/books'] = { allLinkedBooks: f.writableSubject([]) };
  const service = f.load('statistics-react/native-service.ts');
  const book = async (id, title, digit, libraryOwner = 'me', readerOwner = 'me') => {
    const value = {
      id,
      title,
      contentHash: digit.repeat(64),
      libraryOwner,
      elementHtml: '<p>reader</p>'
    };
    await db.put('data', value);
    if (readerOwner) await db.put('readerBookScope', { bookId: id, accountId: readerOwner });
    return value;
  };
  const history = async (book, date, time = 60) => {
    const row = f.row(book.title, date, time, `content:${book.contentHash}`);
    await db.put('readerStatistic', row);
    return row;
  };
  return { ...f, nativeDb: db, service, book, history };
}

test('native statistics queries reject malformed ranges, identifiers, and unbounded selections', async () => {
  const f = await nativeFixture();
  for (const query of [
    { startDate: '2024-02-30' },
    { startDate: '2025-01-01', endDate: '2024-01-01' },
    { bookIds: [-1] },
    { bookIds: Array(201).fill(1) },
    { year: Infinity },
    { page: 0 },
    { aggregation: 'other' },
    { direction: 'sideways' }
  ])
    assert.throws(
      () => f.service.normalizeNativeStatisticsQuery(query),
      /Invalid statistics filter/
    );
  f.nativeDb.close();
});

test('native snapshot reads proven identities only and never exposes orphan or foreign-profile rows', async () => {
  const f = await nativeFixture();
  const own = await f.book(1, 'Same title', 'a');
  const foreign = await f.book(2, 'Same title', 'b', 'other', 'other');
  await f.history(own, '2024-02-28', 60);
  await f.history(foreign, '2024-02-29', 900);
  await f.nativeDb.put(
    'readerStatistic',
    f.row('Orphan', '2024-02-29', 999, `content:${'c'.repeat(64)}`)
  );
  const result = await f.service.readStatisticsSnapshot({
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    year: 2024
  });
  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].id, 1);
  assert.equal(result.totals.time, 60);
  assert.equal(result.rows[0].time, 60);
  assert.equal(result.days.length, 366);
  assert.equal(
    result.rows.some((row) => row.title === 'Orphan'),
    false
  );
  await assert.rejects(f.service.readStatisticsSnapshot({ bookIds: [2] }), /no longer available/);
  f.nativeDb.close();
});

test('native snapshot refuses a content identity with a foreign shared-copy claimant', async () => {
  const f = await nativeFixture();
  const own = await f.book(1, 'My copy', 'a');
  await f.book(2, 'Foreign copy', 'a', 'other', 'other');
  await f.history(own, '2024-02-28', 60);
  const result = await f.service.readStatisticsSnapshot({ year: 2024 });
  assert.equal(result.books.length, 0);
  assert.equal(result.rows.length, 0);
  assert.ok(result.notices.some((notice) => notice.includes('could not be safely resolved')));
  f.nativeDb.close();
});

test('native selected-book filtering retains choices while history remains identity-scoped', async () => {
  const f = await nativeFixture();
  const first = await f.book(1, 'Same title', 'a');
  const second = await f.book(2, 'Same title', 'b');
  await f.history(first, '2024-02-28', 60);
  await f.history(second, '2024-02-29', 120);
  const result = await f.service.readStatisticsSnapshot({ year: 2024, bookIds: [1] });
  assert.equal(result.books.length, 2);
  assert.equal(result.totals.time, 60);
  assert.equal(result.rows.length, 1);
  f.nativeDb.close();
});

test('native whole-history deletion reuses the live identity transaction and keeps same-title siblings', async () => {
  const f = await nativeFixture();
  const first = await f.book(1, 'Same title', 'a');
  const second = await f.book(2, 'Same title', 'b');
  await f.history(first, '2024-02-28', 60);
  await f.history(second, '2024-02-29', 120);
  const action = {
    type: 'delete-book-history',
    bookId: 1,
    title: first.title,
    bookKey: `content:${first.contentHash}`
  };
  await assert.rejects(
    f.service.dispatchStatisticsAction({ ...action, bookKey: `content:${second.contentHash}` }),
    /history changed/
  );
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 2);
  await f.service.dispatchStatisticsAction(action);
  const remaining = await f.nativeDb.getAll('readerStatistic');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].bookKey, `content:${second.contentHash}`);
  assert.ok(await f.nativeDb.get('data', 1));
  f.nativeDb.close();
});

test('native action rejects a switched profile before any database mutation', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'One', 'a');
  await f.history(book, '2024-02-28');
  f.scopeAbort.abort();
  await assert.rejects(
    f.service.dispatchStatisticsAction({
      type: 'delete-book-history',
      bookId: 1,
      title: book.title,
      bookKey: `content:${book.contentHash}`
    }),
    /account_changed/
  );
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 1);
  f.nativeDb.close();
});
