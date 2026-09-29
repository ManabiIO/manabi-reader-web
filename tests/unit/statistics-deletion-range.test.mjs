/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import process from 'node:process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as transactions from '../../apps/web/src/lib/data/database/books-db/commit-transaction.mjs';

const clone = (value) => globalThis.structuredClone(value);
const lib = new URL('../../apps/web/src/lib/', import.meta.url);

function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, lib), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText;
  const exports = {};
  runInNewContext(
    code,
    {
      exports,
      Date,
      Error,
      IDBKeyRange: { bound },
      require(name) {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
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
    { filename: path }
  );
  return exports;
}

// Independent compound-key ordering for the string/array keys in this fixture.
// Transport only: the complete production service and commit helper run below.
function compare(left, right) {
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      const order = compare(left[index], right[index]);
      if (order) return order;
    }
    return left.length - right.length;
  }
  if (Array.isArray(left)) return 1;
  if (Array.isArray(right)) return -1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function bound(lower, upper) {
  const validKey = (key) => typeof key === 'string' || (Array.isArray(key) && key.every(validKey));
  if (!validKey(lower) || !validKey(upper)) throw new DOMException('Invalid key', 'DataError');
  if (compare(lower, upper) > 0) throw new Error('DataError: reversed key range');
  return { lower: clone(lower), upper: clone(upper) };
}

function matches(key, range) {
  return Array.isArray(range)
    ? compare(key, range) === 0
    : compare(key, range.lower) >= 0 && compare(key, range.upper) <= 0;
}

// The old method uses a serial limiter. Preserve its asynchronous admission
// when running the same tests against the pre-fix production source.
function serialLimit() {
  let running = false;
  const queue = [];
  const next = async () => {
    if (running || !queue.length) return;
    running = true;
    const { work, resolve, reject } = queue.shift();
    try {
      resolve(await work());
    } catch (error) {
      reject(error);
    } finally {
      running = false;
      globalThis.queueMicrotask(next);
    }
  };
  const limit = (work) =>
    new Promise((resolve, reject) => {
      queue.push({ work, resolve, reject });
      globalThis.queueMicrotask(next);
    });
  limit.clearQueue = () => {
    queue.length = 0;
  };
  return limit;
}

const statistics = load('functions/statistic-util.ts');
const storage = load('data/storage/storage-types.ts');
const { DatabaseService } = load('data/database/books-db/database.service.ts', {
  './commit-transaction.mjs': transactions,
  './content-hash-index': load('data/database/books-db/content-hash-index.ts'),
  './reader-statistics': { statisticRange: (key) => bound([key], [key, []]) },
  '$lib/functions/statistic-util': statistics,
  '$lib/data/storage/storage-types': storage,
  'p-limit': { __esModule: true, default: serialLimit }
});

const title = '日本語の本';
const bookKey = `content:${'a'.repeat(64)}`;
const day = (key, dateKey) => ({ key: [key, dateKey], value: { dateKey, readingTime: 60 } });
const marker = (key, value = 100) => ({
  key: [key, storage.StorageDataType.STATISTICS],
  value: { title: key, dataType: storage.StorageDataType.STATISTICS, lastModifiedValue: value }
});
const days = ['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02'];
function fixture(extra = {}, options = {}) {
  let committed = clone({
    statistic: [...days.map((date) => day(title, date)), day('Other title', '2024-02-29')],
    readerStatistic: [...days.map((date) => day(bookKey, date)), day('local:other', '2024-02-29')],
    lastModified: [marker(title), marker(bookKey), marker('Other title'), marker('local:other')],
    ...extra
  });
  const calls = [];
  let count = 0;
  const db = {
    transaction(names, mode) {
      count++;
      assert.deepEqual(Array.from(names), ['statistic', 'readerStatistic', 'lastModified']);
      assert.equal(mode, 'readwrite');
      let staged = clone(committed);
      let active = true;
      let resolveDone, rejectDone;
      const done = new Promise((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      });
      const tx = {
        done,
        abort() {
          if (!active) throw new Error('TransactionInactiveError');
          active = false;
          staged = null;
          rejectDone(new Error('AbortError'));
        },
        objectStore(name) {
          assert.ok(names.includes(name));
          const request = async (operation, argument, work) => {
            if (!active) throw new Error('TransactionInactiveError');
            calls.push({ name, operation, argument: clone(argument) });
            await Promise.resolve();
            if (options.fail?.(name, operation, argument, calls)) throw options.failure;
            const result = work();
            options.afterRequest?.(name, operation, argument);
            return clone(result);
          };
          return {
            getKey: (range) =>
              request(
                'getKey',
                range,
                () => staged[name].find((row) => matches(row.key, range))?.key
              ),
            delete: (range) =>
              request('delete', range, () => {
                staged[name] = staged[name].filter((row) => !matches(row.key, range));
              }),
            put: (value) =>
              request('put', value, () => {
                const key = [value.title, value.dataType];
                staged[name] = staged[name].filter((row) => compare(row.key, key) !== 0);
                staged[name].push({ key, value: clone(value) });
                return key;
              })
          };
        }
      };
      // Distinguish request success from the final commit, and expose rollback.
      globalThis.setImmediate(() => {
        if (!active) return;
        active = false;
        if (options.commitFailure) {
          rejectDone(options.commitFailure);
          return;
        }
        committed = staged;
        resolveDone();
      });
      return tx;
    }
  };
  return {
    db,
    calls,
    get transactions() {
      return count;
    },
    snapshot: () => clone(committed),
    remove: (...args) =>
      DatabaseService.prototype.deleteStatisticEntries.call({ db: Promise.resolve(db) }, ...args),
    dates: (store, key) =>
      committed[store].filter((row) => row.key[0] === key).map((row) => row.key[1]),
    modified: (key) =>
      committed.lastModified.find((row) => row.key[0] === key)?.value.lastModifiedValue
  };
}

for (const [label, start, end] of [
  ['reversed', '2024-03-01', '2024-02-29'],
  ['missing start', '', '2024-03-01'],
  ['missing end', '2024-03-01', ''],
  ['unparseable start', 'invalid', '2024-03-01'],
  ['unparseable end', '2024-03-01', '2024-03-invalid'],
  ['normalized February day', '2024-02-30', '2024-03-01'],
  ['non-leap century', '1900-02-29', '1900-03-01'],
  ['invalid end day', '2024-02-28', '2024-02-30'],
  ['un-padded month', '2024-2-29', '2024-03-01'],
  ['invalid month', '2024-13-01', '2025-01-01'],
  ['null bounds', null, null]
]) {
  test(`${label} cannot authorize any statistics deletion`, async () => {
    const f = fixture();
    const before = f.snapshot();
    let failure;
    try {
      await f.remove([title], false, start, end, [bookKey]);
    } catch (error) {
      failure = error;
    }
    assert.deepEqual(f.snapshot(), before, 'Invalid dates changed stored history or markers');
    assert.match(failure?.message ?? '', /invalid Arguments/);
    assert.equal(f.transactions, 0);
  });
}

test('empty target selection rejects before opening a transaction', async () => {
  const f = fixture();
  await assert.rejects(f.remove([], false), /invalid Arguments/);
  assert.equal(f.transactions, 0);
});

test('a malformed later target cannot partially delete an earlier target', async () => {
  const f = fixture();
  const before = f.snapshot();
  await assert.rejects(f.remove([title], false, '', '', [null]), /invalid Arguments/);
  assert.equal(f.transactions, 0);
  assert.deepEqual(f.snapshot(), before);
});

for (const store of ['statistic', 'readerStatistic']) {
  test(`${store}: inclusive range preserves adjacent days and other books`, async () => {
    const f = fixture();
    const key = store === 'statistic' ? title : bookKey;
    await f.remove(
      store === 'statistic' ? [key] : [],
      false,
      '2024-02-29',
      '2024-03-01',
      store === 'readerStatistic' ? [key] : []
    );
    assert.deepEqual(f.dates(store, key), ['2024-02-28', '2024-03-02']);
    assert.equal(f.modified('Other title'), 100);
    assert.equal(f.modified('local:other'), 100);
    assert.ok(f.modified(key) > 100);
  });

  test(`${store}: a checked single-day deletion advances its modification marker`, async () => {
    const f = fixture();
    const key = store === 'statistic' ? title : bookKey;
    await f.remove(
      store === 'statistic' ? [key] : [],
      true,
      '2024-02-29',
      '2024-02-29',
      store === 'readerStatistic' ? [key] : []
    );
    assert.deepEqual(f.dates(store, key), ['2024-02-28', '2024-03-01', '2024-03-02']);
    assert.ok(f.modified(key) > 100);
  });
}

test('checked empty interval preserves markers even when other dates exist', async () => {
  const f = fixture();
  const before = f.snapshot();
  await f.remove([title], true, '2024-04-01', '2024-04-02', [bookKey]);
  assert.deepEqual(f.snapshot(), before);
});

test('explicit empty bounds still delete all selected history', async () => {
  const f = fixture();
  await f.remove([title], true, '', '', [bookKey]);
  assert.deepEqual(f.dates('statistic', title), []);
  assert.deepEqual(f.dates('readerStatistic', bookKey), []);
  assert.ok(f.modified(title) > 100);
  assert.ok(f.modified(bookKey) > 100);
  assert.deepEqual(f.dates('statistic', 'Other title'), ['2024-02-29']);
});

test('unchecked deletion retains the existing absent-data marker contract', async () => {
  const f = fixture();
  await f.remove(['Missing title'], false, '2024-02-29', '2024-02-29', ['local:missing']);
  assert.ok(f.modified('Missing title') > 0);
  assert.ok(f.modified('local:missing') > 0);
});

test('checked whole-history no-op does not create a marker', async () => {
  const f = fixture();
  const before = f.snapshot();
  await f.remove(['Missing title'], true, '', '', ['local:missing']);
  assert.deepEqual(f.snapshot(), before);
});

test('targets are snapshotted before the database await', async () => {
  const f = fixture();
  let release;
  const db = new Promise((resolve) => {
    release = resolve;
  });
  const titles = [title];
  const keys = [bookKey];
  const pending = DatabaseService.prototype.deleteStatisticEntries.call(
    { db },
    titles,
    false,
    '',
    '',
    keys
  );
  titles[0] = 'Other title';
  keys[0] = 'local:other';
  release(f.db);
  await pending;
  assert.deepEqual(f.dates('statistic', title), []);
  assert.deepEqual(f.dates('readerStatistic', bookKey), []);
  assert.deepEqual(f.dates('statistic', 'Other title'), ['2024-02-29']);
  assert.deepEqual(f.dates('readerStatistic', 'local:other'), ['2024-02-29']);
});

test('a full leap year needs one range deletion per unique selected identity', async () => {
  const f = fixture();
  await f.remove([title, title], false, '2024-01-01', '2024-12-31', [bookKey, bookKey]);
  assert.equal(f.calls.filter((call) => call.operation === 'delete').length, 2);
  assert.equal(f.calls.filter((call) => call.operation === 'put').length, 2);
});

test('a timezone-skipped civil day from portable history is still included', async () => {
  const previousTZ = process.env.TZ;
  process.env.TZ = 'Pacific/Apia';
  try {
    const dates = ['2011-12-28', '2011-12-29', '2011-12-30', '2011-12-31', '2012-01-01'];
    const f = fixture({ statistic: dates.map((date) => day(title, date)) });
    await f.remove([title], false, '2011-12-29', '2011-12-31');
    assert.deepEqual(f.dates('statistic', title), ['2011-12-28', '2012-01-01']);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test('leap century and year boundary ranges keep their endpoints', async () => {
  const f = fixture({
    statistic: ['1999-12-31', '2000-01-01', '2000-02-29', '2000-03-01'].map((date) =>
      day(title, date)
    )
  });
  await f.remove([title], false, '1999-12-31', '2000-02-29');
  assert.deepEqual(f.dates('statistic', title), ['2000-03-01']);
});

for (const stage of ['getKey', 'delete', 'put', 'commit']) {
  test(`failure at ${stage} rolls back both statistics stores and markers`, async () => {
    const failure = new Error(`injected ${stage} failure`);
    const f = fixture(
      {},
      {
        failure,
        fail: (name, operation) =>
          operation === stage && (stage === 'put' || name === 'readerStatistic'),
        commitFailure: stage === 'commit' ? failure : undefined
      }
    );
    const before = f.snapshot();
    await assert.rejects(f.remove([title], true, '', '', [bookKey]), (error) => error === failure);
    assert.deepEqual(f.snapshot(), before);
  });
}

test('a deleted row is not acknowledged before transaction completion', async () => {
  const f = fixture();
  let resolved = false;
  const pending = f.remove([title], false, '2024-02-29', '2024-02-29').then(() => {
    resolved = true;
  });
  for (let count = 0; count < 20; count++) await Promise.resolve();
  assert.equal(resolved, false);
  assert.ok(f.dates('statistic', title).includes('2024-02-29'));
  await pending;
  assert.equal(resolved, true);
  assert.ok(!f.dates('statistic', title).includes('2024-02-29'));
});
