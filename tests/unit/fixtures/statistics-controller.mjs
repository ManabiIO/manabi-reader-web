/** @license BSD-3-Clause Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as rxjs from 'rxjs';
import pLimit from 'p-limit';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
const root = fileURLToPath(new URL('../../../apps/web/src/', import.meta.url));
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function fixture(options = {}) {
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
    '$lib/manabi/client': {
      localUser: writableSubject({ id: 'me' }),
      localProfileUser: () => ({ id: 'me' })
    },
    '$lib/appearance/state': {
      appearance$: writableSubject('system'),
      theme$: writableSubject('manabi-theme'),
      customThemes$: writableSubject({})
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
        setTimeout: options.setTimeout ?? setTimeout,
        clearTimeout,
        console,
        window,
        AbortController,
        AbortSignal,
        Blob,
        URL: options.URL ?? URL,
        requestAnimationFrame: (cb) => {
          frames.push(cb);
          return frames.length;
        },
        cancelAnimationFrame() {},
        document: options.document ?? { activeElement: null },
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

export { fixture, nativeFixture, settle, runtimeAuthority };
