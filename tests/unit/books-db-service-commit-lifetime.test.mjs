import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as transactions from '../../apps/web/src/lib/data/database/books-db/commit-transaction.mjs';

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
      IDBKeyRange: globalThis.IDBKeyRange,
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

test('browser database service has no request-before-tx.done write paths left', () => {
  assert.equal(
    /await\s+tx\.done/.test(source),
    false,
    'new database-service writes must use commitTransaction so completion is observed up front'
  );
});

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
