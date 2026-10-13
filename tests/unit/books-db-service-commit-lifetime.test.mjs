import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as transactions from '../../apps/web/src/lib/data/database/books-db/commit-transaction.mjs';
import { deferred, loadOfflineModule } from './fixtures/offline-module.mjs';

// UNRUN: composed onto current main without executing verification by user request.

const sourceURL = new URL(
  '../../apps/web/src/lib/data/database/books-db/database.service.ts',
  import.meta.url
);
const source = readFileSync(sourceURL, 'utf8');

function load(dependencies = {}) {
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  runInNewContext(
    code,
    {
      exports,
      module: { exports },
      AbortController,
      AbortSignal,
      DOMException,
      Error,
      IDBKeyRange: { bound: (lower, upper) => ({ lower, upper }) },
      structuredClone: globalThis.structuredClone,
      require(name) {
        if (name in dependencies) return dependencies[name];
        return new Proxy(
          {},
          {
            get(_target, property) {
              if (property === '__esModule') return false;
              throw new Error(`Unexpected dependency use: ${name}`);
            }
          }
        );
      }
    },
    { filename: 'database.service.ts' }
  );
  return exports;
}

test('storage-source publication waits for transaction completion observed before its first request', async () => {
  let completionObserved = false;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const observedDone = {
    then(onFulfilled, onRejected) {
      completionObserved = true;
      return done.then(onFulfilled, onRejected);
    }
  };
  const writes = [];
  let resolveFirstRequest;
  const firstRequest = new Promise((resolve) => {
    resolveFirstRequest = resolve;
  });
  const store = {
    async add(value) {
      assert.equal(completionObserved, true);
      writes.push(['add', value.name]);
      resolveFirstRequest();
    },
    async put(value) {
      assert.equal(completionObserved, true);
      writes.push(['put', value.name]);
    },
    async delete(value) {
      assert.equal(completionObserved, true);
      writes.push(['delete', value]);
    }
  };
  const tx = {
    done: observedDone,
    objectStore(name) {
      assert.equal(name, 'storageSource');
      return store;
    },
    abort() {}
  };
  const published = [];
  const defaults = [];
  const { DatabaseService } = load({
    './commit-transaction.mjs': transactions,
    '$lib/data/store': {
      syncTarget$: { next: (value) => published.push(value) },
      lastReadingGoalsModified$: { next() {} },
      readingGoal$: { next() {} }
    },
    '$lib/data/storage/storage-source-manager': {
      setStorageSourceDefault: (...args) => defaults.push(args)
    }
  });
  const service = Object.create(DatabaseService.prototype);
  service.db = Promise.resolve({ transaction: () => tx });

  const pending = service.saveStorageSource(
    { name: 'Browser backup', type: 'browser' },
    '',
    true,
    true
  );
  await firstRequest;
  assert.deepEqual(writes, [['add', 'Browser backup']]);
  assert.deepEqual(published, [], 'sync target published before transaction commit');
  assert.deepEqual(defaults, [], 'default source published before transaction commit');

  resolveDone();
  await pending;
  assert.deepEqual(published, ['Browser backup']);
  assert.deepEqual(defaults, [['Browser backup', 'browser']]);
});

test('failed storage-source commit rejects without publishing settings', async () => {
  const failure = new Error('Storage transaction aborted');
  let rejectDone;
  const done = new Promise((_resolve, reject) => {
    rejectDone = reject;
  });
  let requestFinished;
  const request = new Promise((resolve) => {
    requestFinished = resolve;
  });
  const tx = {
    done,
    objectStore() {
      return {
        async add() {
          requestFinished();
        }
      };
    },
    abort() {}
  };
  const published = [];
  const { DatabaseService } = load({
    './commit-transaction.mjs': transactions,
    '$lib/data/store': { syncTarget$: { next: (value) => published.push(value) } },
    '$lib/data/storage/storage-source-manager': {
      setStorageSourceDefault: (...args) => published.push(args)
    }
  });
  const service = Object.create(DatabaseService.prototype);
  service.db = Promise.resolve({ transaction: () => tx });
  const pending = service.saveStorageSource(
    { name: 'Browser backup', type: 'browser' },
    '',
    true,
    true
  );
  const rejected = assert.rejects(pending, (error) => error === failure);
  await request;
  rejectDone(failure);
  await rejected;
  assert.deepEqual(published, []);
});

const bookKey = 'content:' + 'a'.repeat(64);
const dateKey = '2026-10-13';
const row = { title: 'Book', dateKey, completedBook: 0, lastStatisticModified: 7 };
const goal = { goalStartDate: dateKey, goalEndDate: '', dailyGoal: 10 };
const statistics = loadOfflineModule(
  'apps/web/src/lib/data/database/books-db/reader-statistics.ts',
  { globals: { IDBKeyRange: { bound: (lower, upper) => ({ lower, upper }) } } }
).api;
const writers = [
  ['first legacy statistic', (service) => service.setFirstBookRead('Book', 0)],
  ['first content statistic', (service) => service.setFirstBookRead('Book', 0, undefined, 7)],
  ['legacy statistic batch', (service) => service.storeStatistics('Book', [row], 0, 'local', 7)],
  [
    'content statistic batch',
    (service) => service.storeStatistics('Book', [row], 0, 'local', 7, 7)
  ],
  ['statistic deletion', (service) => service.deleteStatistics([row], [])],
  ['reading-goal edit', (service) => service.updateReadingGoals([dateKey], [goal])],
  ['reading-goal replacement', (service) => service.storeReadingGoals([goal], 0, 'local', 7)],
  [
    'storage-source rename',
    (service) => service.saveStorageSource({ name: 'New', type: 'browser' }, 'Old', true, true)
  ]
];

function writerHarness(requestFailure) {
  const done = deferred();
  const started = deferred();
  const aborted = deferred();
  let observed = false;
  const writes = [];
  const published = [];
  const request = async (name, verb, value, result) => {
    assert.equal(observed, true, 'completion must be observed before the first request');
    writes.push([name, verb, value]);
    started.resolve();
    if (requestFailure) throw requestFailure;
    return result;
  };
  const tx = {
    done: {
      then(onFulfilled, onRejected) {
        observed = true;
        return done.promise.then(onFulfilled, onRejected);
      }
    },
    objectStore(name) {
      return {
        get: (key) =>
          request(
            name,
            'get',
            key,
            name === 'readerStatistic'
              ? { ...row, bookKey, completedBook: 1 }
              : name === 'lastModified'
                ? { lastModifiedValue: 11 }
                : undefined
          ),
        put: (value) => request(name, 'put', value),
        delete: (key) => request(name, 'delete', key),
        clear: () => request(name, 'clear')
      };
    },
    abort() {
      aborted.resolve();
      // Native abort may throw before its independently queued done rejection.
      throw new DOMException('Already aborted', 'InvalidStateError');
    }
  };
  const { DatabaseService } = load({
    './commit-transaction.mjs': transactions,
    './reader-statistics': { ...statistics, migrateLegacyStatistics: async () => bookKey },
    '$lib/data/storage/storage-types': { StorageDataType: { STATISTICS: 'statistics' } },
    '$lib/data/merge-mode': { MergeMode: { LOCAL: 'local', MERGE: 'merge' } },
    '$lib/functions/statistic-util': {
      getDateKey: () => dateKey,
      updateStatisticToStore: (rows, modified) => ({
        statisticsToStore: rows,
        newStatisticModified: modified
      })
    },
    '$lib/components/book-reader/book-reading-tracker/book-reading-tracker': {
      getDefaultStatistic: () => row
    },
    '$lib/data/reading-goal': {
      readingGoalSortFunction: () => 0,
      getCurrentReadingGoal: async () => {
        published.push(['read-current-goal']);
        return goal;
      }
    },
    '$lib/data/store': {
      syncTarget$: { next: (value) => published.push(['sync-target', value]) },
      lastReadingGoalsModified$: { next: (value) => published.push(['goals-modified', value]) },
      readingGoal$: { next: (value) => published.push(['current-goal', value]) }
    },
    '$lib/data/storage/storage-source-manager': {
      setStorageSourceDefault: (...args) => published.push(['default-source', ...args])
    }
  });
  const service = Object.create(DatabaseService.prototype);
  service.db = Promise.resolve({
    transaction: () => tx,
    get: async (name) => (name === 'data' ? { id: 7, title: 'Book' } : undefined)
  });
  return { service, writes, published, done, started, aborted };
}

for (const [name, write] of writers) {
  test(`${name} waits for commit before settling or publishing`, async () => {
    const h = writerHarness();
    let settled = false;
    const pending = write(h.service).then(() => {
      settled = true;
    });
    await h.started.promise;
    await setImmediate();
    assert.equal(settled, false);
    assert.deepEqual(h.published, []);
    h.done.resolve();
    await pending;
    if (name === 'statistic deletion')
      assert.ok(
        h.writes.some(
          ([store, verb, key]) =>
            store === 'lastModified' && verb === 'delete' && key[0] === 'Book'
        ),
        'delete modification records for titles supplied by the statistic rows'
      );
    if (name === 'content statistic batch') {
      assert.equal(
        h.writes.find(([store, verb]) => store === 'readerStatistic' && verb === 'put')[2]
          .completedBook,
        1
      );
      assert.equal(
        h.writes.find(([store, verb]) => store === 'lastModified' && verb === 'put')[2]
          .lastModifiedValue,
        11
      );
    }
    if (name === 'reading-goal edit') assert.equal(h.published[0][0], 'goals-modified');
    if (name === 'reading-goal replacement')
      assert.deepEqual(
        h.published.map(([event]) => event),
        ['goals-modified', 'read-current-goal', 'current-goal']
      );
    if (name === 'storage-source rename')
      assert.deepEqual(h.published, [
        ['sync-target', 'New'],
        ['default-source', 'New', 'browser']
      ]);
  });

  test(`${name} drains independent request and completion failures`, async () => {
    const failure = new DOMException('Request refused', 'UnknownError');
    const h = writerHarness(failure);
    let settled = false;
    const rejected = assert.rejects(write(h.service), (error) => error === failure).then(() => {
      settled = true;
    });
    await h.aborted.promise;
    await setImmediate();
    assert.equal(settled, false, 'request failure must wait for transaction settlement');
    h.done.reject(new DOMException('Transaction aborted', 'AbortError'));
    await rejected;
    assert.equal(h.writes.length, 1, 'do not queue more requests after a failure');
    assert.deepEqual(h.published, []);
  });

  test(`${name} rejects a commit failure after successful requests`, async () => {
    const h = writerHarness();
    const failure = new DOMException('Commit refused', 'QuotaExceededError');
    const rejected = assert.rejects(write(h.service), (error) => error === failure);
    await h.started.promise;
    await setImmediate();
    h.done.reject(failure);
    await rejected;
    assert.deepEqual(h.published, []);
  });
}
