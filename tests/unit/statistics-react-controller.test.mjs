/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

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
          if (name.startsWith('$lib/'))
            return load(`lib/${name.slice(5)}${/\.[cm]?[jt]s$/.test(name) ? '' : '.ts'}`);
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

test('React statistics exposes observable projections as read-only while source updates still flow', async () => {
  const f = fixture();
  const screen = f.start('statistics-screen');
  const summary = f.start('statistics-summary', {
    aggregratedStatistics: [],
    statisticsDateRangeLabel: '2024'
  });
  const content = f.start('statistics-content');
  for (const [controller, names] of [
    [screen, ['$currentBookId$']],
    [summary, ['$resizeHandler$']],
    [
      content,
      [
        '$copyStatisticsDataHandler$',
        '$exportStatisticsDataHandler$',
        '$exportRawStatisticsHandler$',
        '$deleteStatisticsDataHandler$',
        '$setStatisticsDatesToAllTimeHandler$'
      ]
    ]
  ]) {
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(controller, name);
      assert.equal(typeof descriptor.get, 'function');
      assert.equal(descriptor.set, undefined);
      assert.throws(() => {
        controller[name] = 'not a writable store';
      }, TypeError);
    }
  }
  f.db.lastItem$.next({ dataId: 17 });
  await settle();
  assert.equal(screen.$currentBookId$, 17);
  f.db.lastItem$.next(undefined);
  await settle();
  assert.equal(screen.$currentBookId$, undefined);
  for (const controller of [screen, summary, content]) controller.controller.destroy();
  await f.frame();
});

test('React summary tolerates detached DOM refs and resumes bounded full-table measurement', async () => {
  const f = fixture();
  const measured = [];
  f.mock['$lib/functions/utils'].getFullHeight = (_window, element) => {
    assert.ok(element, 'Never measure a detached ref');
    measured.push(element);
    return element.height;
  };
  const c = f.start('statistics-summary', {
    aggregratedStatistics: [f.row('One', '2024-02-28')],
    statisticsDateRangeLabel: '2024'
  });
  c.renderFullStatisticsSummaryTable = true;
  c.statisticsSummaryTableContainerElm = null;
  c.statisticsSummaryButtonContainer = null;
  c.updateRowsPerPage(false);
  await f.frame();
  assert.equal(c.rowsPerStatisticsSummaryPage, 1);
  assert.equal(measured.length, 0);
  const table = { height: 500 },
    buttons = { height: 44 };
  c.statisticsSummaryTableContainerElm = table;
  c.statisticsSummaryButtonContainer = buttons;
  c.updateRowsPerPage(false);
  await f.frame();
  assert.equal(c.rowsPerStatisticsSummaryPage, 6);
  assert.deepEqual(measured, [table, buttons]);
  c.controller.destroy();
  c.statisticsSummaryTableContainerElm = null;
  c.statisticsSummaryButtonContainer = null;
  c.updateRowsPerPage(false);
  await f.frame();
  assert.equal(measured.length, 2);
});

test('React heatmap skips measurement and keyboard navigation after its DOM ref is detached', async () => {
  const f = fixture();
  let observations = 0;
  f.mock['$lib/hooks/observe-element-width'].observeElementWidth = () => {
    observations++;
    return () => {};
  };
  const c = f.start('statistics-heatmap', {
    heatmapAggregration: f.heatmap.HeatmapDataAggregration.YEAR,
    statisticsData: [],
    readingGoals: [],
    statisticsTitleFilters: new Map(),
    today: new Date('2024-02-29T12:00:00'),
    todayKey: '2024-02-29'
  });
  assert.equal(observations, 0);
  c.heatmapElement = null;
  const activeDate = c.activeDate;
  c.handleHeatmapDayKeydown({ key: 'ArrowRight' }, c.currentHeatmapDays[0]);
  assert.equal(c.activeDate, activeDate);
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
    snapshotId: (await f.service.readStatisticsSnapshot()).snapshotId,
    bookId: 1,
    title: first.title,
    bookKey: `content:${first.contentHash}`
  };
  await assert.rejects(
    f.service.dispatchStatisticsAction({ ...action, bookKey: `content:${second.contentHash}` }),
    /history changed/
  );
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 2);
  await f.service.dispatchStatisticsAction({
    ...action,
    snapshotId: (await f.service.readStatisticsSnapshot()).snapshotId
  });
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
  const snapshot = await f.service.readStatisticsSnapshot();
  f.scopeAbort.abort();
  await assert.rejects(
    f.service.dispatchStatisticsAction({
      type: 'delete-book-history',
      snapshotId: snapshot.snapshotId,
      bookId: 1,
      title: book.title,
      bookKey: `content:${book.contentHash}`
    }),
    /account_changed|changed accounts/
  );
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 1);
  f.nativeDb.close();
});

async function nativeAction(f, book, values = {}, authority) {
  const snapshot = await f.service.readStatisticsSnapshot({ aggregation: 'none' }, authority);
  return {
    type: 'save-day',
    snapshotId: snapshot.snapshotId,
    bookId: book.id,
    bookKey: `content:${book.contentHash}`,
    title: book.title,
    date: '2024-02-28',
    mode: 'edit',
    time: 120,
    characters: 500,
    resetMinMax: false,
    ...values
  };
}
function runtimeAuthority(key = 'account-a:1') {
  const controller = new AbortController();
  return {
    controller,
    key,
    signal: controller.signal,
    assertCurrent() {
      controller.signal.throwIfAborted();
    }
  };
}

test('native manual entry creates only a proven book/day and never overwrites existing history', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'New day', 'a');
  const action = await nativeAction(f, book, { mode: 'create', time: 0, characters: 0 });
  assert.equal((await f.service.dispatchStatisticsAction(action)).saved, true);
  const stored = await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]);
  assert.equal(stored.readingTime, 0);
  assert.equal(stored.charactersRead, 0);
  assert.equal(
    (await f.nativeDb.get('lastModified', [action.bookKey, 'statistic'])).lastModifiedValue,
    stored.lastStatisticModified
  );
  const snapshot = await f.service.readStatisticsSnapshot({ aggregation: 'none' });
  assert.equal(snapshot.rows.length, 1, 'zero-time entries remain editable');
  assert.equal(snapshot.rows[0].entry.bookId, 1);
  assert.equal(snapshot.totals.days, 0);
  await assert.rejects(
    f.service.dispatchStatisticsAction({ ...action, snapshotId: snapshot.snapshotId }),
    /already has history/
  );
  assert.deepEqual(await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]), stored);
  f.nativeDb.close();
});

test('native day editing preserves completion data, updates speed bounds, and supports explicit reset', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Finished', 'a');
  const row = await f.history(book, '2024-02-28', 60);
  row.completedBook = 1;
  row.completedData = { dateKey: '2024-02-28', charactersRead: 999 };
  row.minReadingSpeed = 100;
  row.altMinReadingSpeed = 120;
  row.maxReadingSpeed = 100000;
  await f.nativeDb.put('readerStatistic', row);
  const action = await nativeAction(f, book);
  await f.service.dispatchStatisticsAction(action);
  let saved = await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]);
  assert.equal(saved.readingTime, 120);
  assert.equal(saved.charactersRead, 500);
  assert.equal(saved.lastReadingSpeed, 15000);
  assert.equal(saved.minReadingSpeed, 100);
  assert.equal(saved.maxReadingSpeed, 100000);
  assert.equal(saved.completedBook, 1);
  assert.deepEqual(saved.completedData, row.completedData);
  const reset = await nativeAction(f, book, { resetMinMax: true });
  await f.service.dispatchStatisticsAction(reset);
  saved = await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]);
  assert.equal(saved.minReadingSpeed, 15000);
  assert.equal(saved.altMinReadingSpeed, 15000);
  assert.equal(saved.maxReadingSpeed, 15000);
  assert.deepEqual(saved.completedData, row.completedData);
  f.nativeDb.close();
});

test('native stale edits and duplicate submissions never overwrite a tracker update', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Concurrent', 'a');
  const row = await f.history(book, '2024-02-28');
  const action = await nativeAction(f, book);
  const newer = { ...row, completedBook: 1, lastStatisticModified: row.lastStatisticModified + 1 };
  await f.nativeDb.put('readerStatistic', newer);
  await assert.rejects(f.service.dispatchStatisticsAction(action), /history changed/);
  await assert.rejects(f.service.dispatchStatisticsAction(action), /expired/);
  assert.deepEqual(await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]), newer);
  f.nativeDb.close();
});

test('native range deletion is inclusive, atomic across selected books, and retains other dates and same-title siblings', async () => {
  const f = await nativeFixture(),
    first = await f.book(1, 'Same', 'a'),
    second = await f.book(2, 'Same', 'b'),
    sibling = await f.book(3, 'Same', 'c');
  for (const book of [first, second, sibling]) {
    for (const date of ['2024-02-27', '2024-02-28', '2024-02-29']) await f.history(book, date);
  }
  const snapshot = await f.service.readStatisticsSnapshot();
  await f.service.dispatchStatisticsAction({
    type: 'delete-range',
    snapshotId: snapshot.snapshotId,
    bookIds: [1, 2],
    startDate: '2024-02-28',
    endDate: '2024-02-29'
  });
  const rows = await f.nativeDb.getAll('readerStatistic');
  assert.equal(rows.length, 5);
  assert.equal(rows.filter((row) => row.bookKey === `content:${sibling.contentHash}`).length, 3);
  assert.ok(
    rows
      .filter((row) => row.bookKey !== `content:${sibling.contentHash}`)
      .every((row) => row.dateKey === '2024-02-27')
  );
  f.nativeDb.close();
});

test('native range deletion refuses new rows and rolls back every selected identity', async () => {
  const f = await nativeFixture(),
    first = await f.book(1, 'One', 'a'),
    second = await f.book(2, 'Two', 'b');
  await f.history(first, '2024-02-28');
  await f.history(second, '2024-02-28');
  const snapshot = await f.service.readStatisticsSnapshot();
  await f.history(second, '2024-02-29');
  await assert.rejects(
    f.service.dispatchStatisticsAction({
      type: 'delete-range',
      snapshotId: snapshot.snapshotId,
      bookIds: [1, 2],
      startDate: '2024-02-28',
      endDate: '2024-02-29'
    }),
    /history changed/
  );
  assert.equal((await f.nativeDb.getAll('readerStatistic')).length, 3);
  assert.equal((await f.nativeDb.getAll('lastModified')).length, 0);
  f.nativeDb.close();
});

test('native same-ID title, identity, and ownership swaps reject a previously displayed edit', async () => {
  for (const change of [
    { title: 'Renamed' },
    { contentHash: 'b'.repeat(64) },
    { libraryOwner: 'other' }
  ]) {
    const f = await nativeFixture(),
      book = await f.book(1, 'Original', 'a');
    const row = await f.history(book, '2024-02-28');
    const action = await nativeAction(f, book);
    await f.nativeDb.put('data', { ...book, ...change });
    await assert.rejects(
      f.service.dispatchStatisticsAction(action),
      /changed|account|profile|ownership/
    );
    assert.deepEqual(await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]), row);
    f.nativeDb.close();
  }
});

test('native mutation refuses a foreign shared-copy claimant added after the snapshot', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Original', 'a');
  const row = await f.history(book, '2024-02-28');
  const action = await nativeAction(f, book);
  await f.book(2, 'Other copy', 'a', 'other', 'other');
  await assert.rejects(f.service.dispatchStatisticsAction(action), /account|profile|ownership/);
  assert.deepEqual(await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]), row);
  f.nativeDb.close();
});

test('native snapshot capabilities reject runtime account ABA and same-user generation replacement', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'One', 'a');
  const row = await f.history(book, '2024-02-28');
  const old = runtimeAuthority();
  const action = await nativeAction(f, book, {}, old);
  old.controller.abort();
  const returned = runtimeAuthority('account-a:3');
  await assert.rejects(
    f.service.dispatchStatisticsAction(action, returned),
    /expired|changed accounts/
  );
  const fresh = await nativeAction(f, book, {}, returned);
  await assert.rejects(
    f.service.dispatchStatisticsAction(fresh, runtimeAuthority('account-a:4')),
    /changed accounts/
  );
  assert.deepEqual(await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]), row);
  f.nativeDb.close();
});

test('native runtime abort after the final write request rolls back row and modification marker', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Rollback', 'a');
  const row = await f.history(book, '2024-02-28');
  const authority = runtimeAuthority();
  const action = await nativeAction(f, book, {}, authority);
  // Abort on the final lastModified request success, before IndexedDB commits.
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = originalPut.apply(this, args);
    if (this.name === 'lastModified')
      request.addEventListener('success', () => authority.controller.abort(), { once: true });
    return request;
  };
  try {
    await assert.rejects(f.service.dispatchStatisticsAction(action, authority));
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  assert.deepEqual(await f.nativeDb.get('readerStatistic', [action.bookKey, action.date]), row);
  assert.equal((await f.nativeDb.getAll('lastModified')).length, 0);
  f.nativeDb.close();
});

test('native mutations bound payloads and snapshots; global ownerless goals stay explicitly gated', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Bounded', 'a');
  await f.history(book, '2024-02-28');
  const action = await nativeAction(f, book);
  for (const value of [
    { time: -1 },
    { time: 86401 },
    { time: 1.5 },
    { characters: Infinity },
    { characters: 100000001 },
    { date: '2024-02-30' }
  ]) {
    await assert.rejects(
      f.service.dispatchStatisticsAction({ ...action, ...value }),
      /Invalid statistics action/
    );
  }
  for (let i = 0; i < 4; i++) {
    const snapshot = await f.service.readStatisticsSnapshot();
    assert.equal(snapshot.goals.available, false);
    assert.match(snapshot.goals.reason, /without account ownership/);
  }
  await assert.rejects(f.service.dispatchStatisticsAction(action), /expired/);
  f.nativeDb.close();
});

test('native filters distinguish all books from an explicitly empty private selection', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Visible choice', 'a');
  await f.history(book, '2024-02-28');
  const empty = await f.service.readStatisticsSnapshot({ bookSelection: 'selected', bookIds: [] });
  assert.equal(empty.books.length, 1);
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.totals.time, 0);
  assert.equal(empty.allTime, null);
  assert.equal(empty.query.bookSelection, 'selected');
  const all = await f.service.readStatisticsSnapshot({ bookSelection: 'all' });
  assert.equal(all.rows.length, 1);
  assert.equal(all.allTime.startDate, '2024-02-28');
  f.nativeDb.close();
});

test('native single-entry deletion retains a conflicting secondary-identity row on the same date', async () => {
  const f = await nativeFixture(),
    book = await f.book(1, 'Two histories', 'a');
  const primary = await f.history(book, '2024-02-28', 60);
  const secondary = { ...primary, bookKey: 'local:retained-copy', readingTime: 90 };
  await f.nativeDb.put('readerLocalIdentity', { bookId: 1, uuid: 'retained-copy' });
  await f.nativeDb.put('readerStatistic', secondary);
  await f.nativeDb.put('readerStatisticMigration', {
    title: book.title,
    state: 'assigned',
    bookKey: primary.bookKey
  });
  const snapshot = await f.service.readStatisticsSnapshot({ aggregation: 'none' });
  assert.equal(snapshot.rows.length, 2);
  assert.ok(snapshot.rows.every((row) => row.entry));
  await f.service.dispatchStatisticsAction({
    type: 'delete-day',
    snapshotId: snapshot.snapshotId,
    bookId: 1,
    title: book.title,
    bookKey: primary.bookKey,
    date: primary.dateKey
  });
  assert.equal(
    await f.nativeDb.get('readerStatistic', [primary.bookKey, primary.dateKey]),
    undefined
  );
  assert.deepEqual(
    await f.nativeDb.get('readerStatistic', [secondary.bookKey, secondary.dateKey]),
    secondary
  );
  f.nativeDb.close();
});

const plain = (value) => JSON.parse(JSON.stringify(value));
const measurementKeys = [
  'readingTime',
  'averageReadingTime',
  'averageWeightedReadingTime',
  'charactersRead',
  'averageCharactersRead',
  'averageWeightedCharactersRead',
  'lastReadingSpeed',
  'minReadingSpeed',
  'altMinReadingSpeed',
  'maxReadingSpeed'
];
function measuredRow(row) {
  return {
    ...row,
    id: `${row.bookKey ?? row.title}_${row.dateKey}`,
    averageReadingTime: row.readingTime,
    averageWeightedReadingTime: row.readingTime,
    averageCharactersRead: row.charactersRead,
    averageWeightedCharactersRead: row.charactersRead,
    averageReadingSpeed: row.lastReadingSpeed,
    averageWeightedReadingSpeed: row.lastReadingSpeed
  };
}
function originalAggregation(f) {
  return f.load(
    fileURLToPath(
      new URL('../../test/statistics/fixtures/statistics-aggregation-original.ts', import.meta.url)
    )
  ).originalAggregateStatistics;
}

test('shared aggregation is equivalent to the original for zero entries, day gaps, weights, and speed bounds', () => {
  const f = fixture();
  const aggregate = f.load('statistics-react/statistics-aggregation.ts').aggregateStatistics;
  const original = originalAggregation(f);
  const zero = measuredRow(f.row('One', '2024-01-01', 0, 'local:one'));
  const first = measuredRow({
    ...f.row('One', '2024-01-03', 60, 'local:one'),
    charactersRead: 120,
    minReadingSpeed: 10,
    altMinReadingSpeed: 20,
    maxReadingSpeed: 9000,
    lastReadingSpeed: 7200
  });
  const last = measuredRow({
    ...f.row('One', '2024-02-29', 180, 'local:one'),
    charactersRead: 540,
    minReadingSpeed: 30,
    altMinReadingSpeed: 40,
    maxReadingSpeed: 12000,
    lastReadingSpeed: 10800
  });
  const sameDay = measuredRow({ ...last, title: 'Other', bookKey: 'local:two' });
  for (const rows of [
    [],
    [zero],
    [first, last],
    [zero, first, last],
    [first, zero, last],
    [first, last, sameDay]
  ]) {
    for (const mode of Object.values(f.types.StatisticsReadingDataAggregationMode)) {
      const project = (entries) => entries.map((entry) => ({ ...entry, lastStatisticModified: 0 }));
      assert.deepEqual(plain(project(aggregate(rows, mode))), plain(project(original(rows, mode))));
    }
  }
  const [result] = aggregate([first, last], f.types.StatisticsReadingDataAggregationMode.TITLE);
  assert.equal(result.averageReadingTime, 120, 'calendar gaps add no denominator entries');
  assert.equal(result.averageWeightedReadingTime, 159);
  assert.equal(result.averageCharactersRead, 330);
  assert.equal(result.averageWeightedCharactersRead, 435);
  assert.equal(result.minReadingSpeed, 10);
  assert.equal(
    result.altMinReadingSpeed,
    0,
    'retain original grouped alternate-minimum initialization'
  );
  assert.equal(result.maxReadingSpeed, 10800, 'retain original maximum-of-daily-speed behavior');
  assert.equal(
    aggregate([first, zero, last], f.types.StatisticsReadingDataAggregationMode.TITLE)[0]
      .averageReadingTime,
    80,
    'retain original cumulative-time zero-entry counting; changing semantics is separate work'
  );
});

test('native measurement choices match the original web columns and reject malformed selectors', async () => {
  const f = await nativeFixture();
  const contract = f.load('statistics-react/native-contract.ts');
  assert.deepEqual(
    plain(contract.nativeStatisticsTimeSources),
    plain(f.types.readingTimeDataSources)
  );
  assert.deepEqual(
    plain(contract.nativeStatisticsCharactersSources),
    plain(f.types.charactersDataSources)
  );
  assert.deepEqual(
    plain(contract.nativeStatisticsSpeedSources),
    plain(f.types.readingSpeedDataSources)
  );
  for (const query of [
    null,
    false,
    [],
    'time',
    { endDate: 5 },
    { startDate: {} },
    { timeSource: 'charactersRead' },
    { timeSource: null },
    { timeSource: '__proto__' },
    { charactersSource: 'averageReadingTime' },
    { speedSource: 'averageReadingSpeed' },
    { speedSource: [] },
    { heatmapAggregation: 'all' },
    { heatmapAggregation: 1 },
    { heatmapAggregation: null },
    { sort: 'maxReadingSpeed' }
  ]) {
    assert.throws(
      () => f.service.normalizeNativeStatisticsQuery(query),
      /Invalid statistics filter/
    );
  }
  const defaults = f.service.normalizeNativeStatisticsQuery();
  assert.equal(defaults.timeSource, 'readingTime');
  assert.equal(defaults.charactersSource, 'charactersRead');
  assert.equal(defaults.speedSource, 'lastReadingSpeed');
  assert.equal(defaults.heatmapAggregation, 'year');
  f.nativeDb.close();
});

test('native measurements use the original aggregation only for proven selected identities and dates', async () => {
  const f = await nativeFixture();
  const own = await f.book(1, 'Same title', 'a');
  const sibling = await f.book(2, 'Same title', 'b');
  const foreign = await f.book(3, 'Same title', 'c', 'other', 'other');
  const rows = [];
  for (const [date, time, characters] of [
    ['2024-01-01', 0, 0],
    ['2024-01-03', 60, 120],
    ['2024-02-29', 180, 540]
  ]) {
    const row = {
      ...(await f.history(own, date, time)),
      charactersRead: characters,
      minReadingSpeed: 10,
      altMinReadingSpeed: 20,
      maxReadingSpeed: 12000,
      completedData: { private: 'completion-not-for-native' }
    };
    rows.push(row);
    await f.nativeDb.put('readerStatistic', row);
  }
  await f.history(own, '2025-01-01', 777);
  await f.history(sibling, '2024-01-03', 888);
  await f.history(foreign, '2024-01-03', 999);
  await f.nativeDb.put(
    'readerStatistic',
    f.row('Orphan', '2024-01-03', 9999, `content:${'d'.repeat(64)}`)
  );
  for (const [aggregation, mode] of [
    ['title', 'TITLE'],
    ['date', 'DATE'],
    ['none', 'NONE']
  ]) {
    const snapshot = await f.service.readStatisticsSnapshot({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      year: 2024,
      bookIds: [1],
      aggregation,
      sort: 'date',
      direction: 'asc',
      timeSource: 'averageWeightedReadingTime',
      charactersSource: 'averageCharactersRead',
      speedSource: 'maxReadingSpeed'
    });
    const expected = originalAggregation(f)(
      rows.map(measuredRow),
      f.types.StatisticsReadingDataAggregationMode[mode]
    );
    assert.equal(snapshot.rows.length, expected.length);
    for (let index = 0; index < expected.length; index++) {
      const measurements = Object.fromEntries(
        measurementKeys.map((key) => [key, expected[index][key]])
      );
      assert.deepEqual(plain(snapshot.rows[index].measurements), measurements);
    }
    assert.equal(snapshot.totals.time, 240);
    assert.equal(snapshot.totals.characters, 660);
    assert.equal(snapshot.totals.days, 2);
    assert.equal(JSON.stringify(snapshot).includes('completion-not-for-native'), false);
    assert.equal(JSON.stringify(snapshot).includes('Orphan'), false);
    assert.equal(snapshot.goals.available, false);
    if (aggregation === 'none')
      assert.equal(snapshot.rows[0].entry.bookId, 1, 'zero-time day remains editable');
  }
  const empty = await f.service.readStatisticsSnapshot({
    bookSelection: 'selected',
    bookIds: [],
    timeSource: 'averageReadingTime'
  });
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.totals.time, 0);
  f.nativeDb.close();
});

test('native sorting uses the selected measurement and direction, with numeric-title ties', async () => {
  const f = await nativeFixture();
  const rows = [];
  for (const [id, title, digit, values] of [
    [
      1,
      'Book 10',
      'a',
      [
        [60, 120, 30, 90],
        [180, 540, 20, 100]
      ]
    ],
    [2, 'Book 2', 'b', [[180, 350, 20, 100]]],
    [3, 'Book 3', 'c', [[120, 240, 40, 100]]]
  ]) {
    const book = await f.book(id, title, digit);
    for (let index = 0; index < values.length; index++) {
      const [time, charactersRead, minReadingSpeed, altMinReadingSpeed] = values[index];
      const row = {
        ...(await f.history(book, `2024-01-0${index + 1}`, time)),
        charactersRead,
        minReadingSpeed,
        altMinReadingSpeed,
        maxReadingSpeed: time * 100,
        lastReadingSpeed: Math.ceil((charactersRead * 3600) / time)
      };
      await f.nativeDb.put('readerStatistic', row);
      rows.push(row);
    }
  }
  const expected = originalAggregation(f)(
    rows.map(measuredRow),
    f.types.StatisticsReadingDataAggregationMode.TITLE
  );
  for (const key of measurementKeys) {
    const sort = key.includes('Time')
      ? 'time'
      : key.includes('Characters') || key === 'charactersRead'
        ? 'characters'
        : 'speed';
    const source =
      sort === 'time' ? 'timeSource' : sort === 'characters' ? 'charactersSource' : 'speedSource';
    for (const direction of ['asc', 'desc']) {
      const snapshot = await f.service.readStatisticsSnapshot({ [source]: key, sort, direction });
      const order = [...expected]
        .sort(
          (a, b) =>
            (a[key] - b[key]) * (direction === 'asc' ? 1 : -1) ||
            a.title.localeCompare(b.title, 'ja-JP', { numeric: true })
        )
        .map((row) => row.title);
      assert.deepEqual(plain(snapshot.rows.map((row) => row.title)), order);
    }
  }
  f.nativeDb.close();
});

test('native selected-measurement sorting happens before bounded pagination', async () => {
  const f = await nativeFixture();
  const book = await f.book(1, 'Page', 'a');
  for (let day = 1; day <= 26; day++) {
    const row = await f.history(book, `2024-01-${String(day).padStart(2, '0')}`, day * 60);
    await f.nativeDb.put('readerStatistic', { ...row, maxReadingSpeed: day * 100 });
  }
  const query = {
    aggregation: 'none',
    sort: 'speed',
    speedSource: 'maxReadingSpeed',
    direction: 'desc'
  };
  const first = await f.service.readStatisticsSnapshot(query);
  const second = await f.service.readStatisticsSnapshot({ ...query, page: 2 });
  assert.equal(first.rows.length, 25);
  assert.equal(first.rows[0].measurements.maxReadingSpeed, 2600);
  assert.equal(second.rows.length, 1);
  assert.equal(second.rows[0].measurements.maxReadingSpeed, 100);
  assert.equal(second.query.page, 2);
  assert.equal(second.pages, 2);
  f.nativeDb.close();
});

test('native all-time heatmap reuses global metrics while keeping one bounded year of owned days', async () => {
  const f = await nativeFixture();
  const own = await f.book(1, 'Owned', 'a');
  const foreign = await f.book(2, 'Foreign', 'b', 'other', 'other');
  for (const date of ['2023-12-30', '2023-12-31', '2024-01-01', '2024-02-29'])
    await f.history(own, date);
  await f.history(foreign, '2024-01-02', 999);
  const yearly = await f.service.readStatisticsSnapshot({ year: 2024 });
  const all = await f.service.readStatisticsSnapshot({
    year: 2024,
    heatmapAggregation: 'all-time'
  });
  assert.equal(yearly.longestStreak, 1);
  assert.equal(all.longestStreak, 3);
  assert.equal(all.longestStreakStartDate, '2023-12-30');
  assert.match(all.daysRead, /^4 \/ 62 days/);
  assert.equal(all.days.length, 366);
  assert.ok(all.days.every((day) => day.date.startsWith('2024-')));
  assert.deepEqual(plain(all.longestStreakDates), ['2024-01-01']);
  assert.equal(all.days.find((day) => day.date === '2024-01-02').time, 0);
  assert.equal(all.goals.available, false);
  const previous = await f.service.readStatisticsSnapshot({
    year: 2023,
    heatmapAggregation: 'all-time'
  });
  assert.equal(previous.days.length, 365);
  assert.equal(previous.longestStreak, 3);
  assert.deepEqual(plain(previous.longestStreakDates), ['2023-12-30', '2023-12-31']);
  f.nativeDb.close();
});
