/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import pLimit from 'p-limit';
import React, { act } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';
import * as transactions from '../../apps/web/src/lib/data/database/books-db/commit-transaction.mjs';

// Execute the production service and helpers. Unrelated constructor/UI imports
// fail on use; no database operations or commit/rollback semantics are mocked.
function load(path, dependencies = {}) {
  const source = readFileSync(new URL(`../../apps/web/src/${path}`, import.meta.url), 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    },
    fileName: path,
    reportDiagnostics: true
  });
  assert.equal(result.diagnostics.length, 0);
  const module = { exports: {} };
  compileFunction(result.outputText, ['require', 'module', 'exports'])(
    (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      return new Proxy(
        {},
        {
          get(_target, property) {
            if (property === '__esModule') return false;
            throw new Error(`Unexpected dependency use: ${name}.${String(property)}`);
          }
        }
      );
    },
    module,
    module.exports
  );
  return module.exports;
}
const base = 'lib/data/database/books-db/';
const identity = load(`${base}book-identity.ts`);
const contentHash = load(`${base}content-hash-index.ts`);
const binary = load(`${base}book-binary.ts`);
const records = load(`${base}book-records.ts`);
const admittedRead = load(`${base}admitted-book-read.ts`, {
  './book-identity': identity,
  './book-records': records,
  './commit-transaction.mjs': transactions
});
const statistics = load(`${base}reader-statistics.ts`, {
  './commit-transaction.mjs': transactions,
  './content-hash-index.ts': contentHash
});
const replicationErrors = load('lib/functions/replication/replication-error.ts');
const progress = [];
const progressSubject = {
  next(value) {
    progress.push(value);
  }
};
const errorHandler = load('lib/functions/replication/error-handler.ts', {
  '$lib/data/logger': { logger: { error() {} } },
  '$lib/functions/replication/replication-progress': { replicationProgress$: progressSubject }
});
const { DatabaseService } = load(`${base}database.service.ts`, {
  './book-identity': identity,
  './book-binary': binary,
  './admitted-book-read': admittedRead,
  './commit-transaction.mjs': transactions,
  './reader-statistics': statistics,
  './content-hash-index': contentHash,
  '$lib/data/storage/storage-types': { StorageDataType: { STATISTICS: 'statistic' } },
  '$lib/functions/replication/replication-error': replicationErrors,
  '$lib/functions/replication/error-handler': errorHandler,
  '$lib/functions/replication/replication-progress': { replicationProgress$: progressSubject },
  'p-limit': { __esModule: true, default: pLimit }
});
const hash = 'a'.repeat(64);
const target = () => ({
  bookId: 1,
  title: 'Selected book',
  contentHash: hash,
  lastBookModified: 10
});
const row = () => ({
  id: 1,
  title: 'Selected book',
  contentHash: hash,
  lastBookModified: 10,
  elementHtml: '<p>Selected content</p>',
  blobs: {}
});
const storeKeys = {
  data: 'id',
  bookmark: 'dataId',
  readerBookScope: 'bookId',
  lastItem: undefined,
  audioBook: 'title',
  subtitle: 'title',
  handle: ['title', 'filename'],
  readerSearchProjection: 'bookId',
  statistic: ['title', 'dateKey'],
  readerStatistic: ['bookKey', 'dateKey'],
  lastModified: ['title', 'dataType'],
  readerLocalIdentity: 'bookId'
};
const stores = Object.keys(storeKeys);
async function fixture(t) {
  const name = `native-book-access-${crypto.randomUUID()}`;
  const db = await openDB(name, 1, {
    upgrade(database) {
      for (const [store, keyPath] of Object.entries(storeKeys)) {
        const created = database.createObjectStore(store, keyPath ? { keyPath } : undefined);
        if (store === 'data') {
          created.createIndex('title', 'title');
          created.createIndex('contentHash', 'contentHash');
        }
      }
    }
  });
  const second = await openDB(name, 1);
  t.after(async () => {
    db.close();
    second.close();
    await deleteDB(name);
  });
  await db.put('data', row());
  await db.put('bookmark', { dataId: 1, progress: 'anchor-27' });
  await db.put('lastItem', { dataId: 1 }, 0);
  await db.put('readerSearchProjection', { bookId: 1, content: 'search' });
  for (const store of ['audioBook', 'subtitle']) await db.put(store, { title: row().title });
  await db.put('handle', { title: row().title, filename: 'audio.mp3' });
  await db.put('statistic', { title: row().title, dateKey: '2026-10-01', readingTime: 20 });
  await db.put('readerStatistic', {
    bookKey: `content:${hash}`,
    dateKey: '2026-10-01',
    readingTime: 20
  });
  await db.put('lastModified', {
    title: `content:${hash}`,
    dataType: 'statistic',
    lastModifiedValue: 1
  });
  const service = Object.create(DatabaseService.prototype);
  service.db = Promise.resolve(db);
  const notices = [];
  service.lastItemChanged$ = {
    next() {
      notices.push('lastItem');
    }
  };
  service.bookmarksChanged$ = {
    next() {
      notices.push('bookmark');
    }
  };
  const snapshot = async () => {
    const tx = db.transaction(stores);
    const entries = await Promise.all(
      stores.map(async (store) => [store, await tx.objectStore(store).getAll()])
    );
    await tx.done;
    return Object.fromEntries(entries);
  };
  return {
    db,
    second,
    service,
    notices,
    snapshot,
    remove(
      expected = new Map([[1, target()]]),
      signal = new AbortController().signal,
      assertCurrent = () => {},
      keep = false
    ) {
      return service.deleteData([1], new Map(), signal, keep, null, assertCurrent, expected);
    }
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

for (const [field, replacement] of [
  ['contentHash', 'b'.repeat(64)],
  ['title', 'Replacement title'],
  ['lastBookModified', 11]
])
  test(`delete checks changed ${field} in its real write transaction`, async (t) => {
    const f = await fixture(t);
    // Queue another connection's replacement ahead of deletion, after admission.
    const replacing = f.second.put('data', { ...row(), [field]: replacement });
    const deleting = f.remove();
    await replacing;
    const before = await f.snapshot();
    const result = await deleting;
    assert.match(result.error, /book changed/);
    assert.deepEqual(result.deleted, []);
    assert.deepEqual(await f.snapshot(), before);
    assert.deepEqual(f.notices, []);
  });

test('provided identity map fails closed for missing or mismatched IDs before deleting any row', async (t) => {
  const f = await fixture(t);
  const before = await f.snapshot();
  for (const expected of [new Map(), new Map([[1, { ...target(), bookId: 2 }]])])
    await assert.rejects(f.remove(expected), /selection changed/);
  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(f.notices, []);
});

test('caller mutation while the database opens cannot replace an admitted identity', async (t) => {
  const f = await fixture(t);
  const opening = deferred();
  f.service.db = opening.promise;
  const admitted = target();
  const expected = new Map([[1, admitted]]);
  const pending = f.remove(expected);
  const replacement = { ...row(), contentHash: 'b'.repeat(64) };
  await f.second.put('data', replacement);
  admitted.contentHash = replacement.contentHash;
  expected.set(1, { ...target(), contentHash: replacement.contentHash });
  const before = await f.snapshot();
  opening.resolve(f.db);
  assert.match((await pending).error, /book changed/);
  assert.deepEqual(await f.snapshot(), before);
});

for (const owner of ['libraryOwner', 'readerBookScope'])
  test(`delete rejects a new foreign ${owner} inside the same transaction`, async (t) => {
    const f = await fixture(t);
    if (owner === 'libraryOwner')
      await f.second.put('data', { ...row(), libraryOwner: 'other-account' });
    else await f.second.put('readerBookScope', { bookId: 1, accountId: 'other-account' });
    const before = await f.snapshot();
    assert.match((await f.remove()).error, /another account/);
    assert.deepEqual(await f.snapshot(), before);
  });

test('native abort after the final successful delete rolls back data, progress, media and statistics', async (t) => {
  const f = await fixture(t);
  const before = await f.snapshot();
  const original = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function (...args) {
    const request = original.apply(this, args);
    if (this.name === 'data')
      request.addEventListener('success', () => this.transaction.abort(), { once: true });
    return request;
  };
  t.after(() => {
    IDBObjectStore.prototype.delete = original;
  });
  const result = await f.remove();
  assert.match(result.error, /transaction was aborted/);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(f.notices, []);
});

for (const reason of ['close', 'account ABA', 'session generation'])
  test(`${reason} cancellation aborts an in-flight delete without publishing it`, async (t) => {
    const f = await fixture(t);
    const before = await f.snapshot();
    const controller = new AbortController();
    const original = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (...args) {
      const request = original.apply(this, args);
      if (this.name === 'bookmark')
        request.addEventListener('success', () => controller.abort(), { once: true });
      return request;
    };
    t.after(() => {
      IDBObjectStore.prototype.delete = original;
    });
    const result = await f.remove(new Map([[1, target()]]), controller.signal);
    assert.deepEqual(result.deleted, []);
    assert.deepEqual(await f.snapshot(), before);
    assert.deepEqual(f.notices, []);
  });

test('identity deletion commits the selected copy and preserves other copies and requested history', async (t) => {
  const f = await fixture(t);
  await f.db.put('data', { ...row(), id: 2 });
  const result = await f.remove(undefined, undefined, undefined, true);
  assert.deepEqual(result, { error: '', deleted: [1] });
  assert.equal(await f.db.get('data', 1), undefined);
  assert.equal((await f.db.get('data', 2)).id, 2);
  assert.equal((await f.db.getAll('statistic')).length, 1);
  assert.equal((await f.db.getAll('readerStatistic')).length, 1);
  assert.equal((await f.db.getAll('audioBook')).length, 1);
  assert.deepEqual(f.notices, ['lastItem', 'bookmark']);
});

for (const keepStatistics of [true, false])
  test(`canonical deletion rejects a replaced legacy UUID while keepStatistics=${keepStatistics}`, async (t) => {
    const f = await fixture(t);
    await f.db.put('data', { ...row(), contentHash: undefined });
    await f.db.put('readerLocalIdentity', {
      bookId: 1,
      uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    });
    const before = await f.snapshot();
    const result = await f.remove(
      new Map([
        [
          1,
          {
            ...target(),
            contentHash: undefined,
            readerBookKey: 'local:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
          }
        ]
      ]),
      undefined,
      undefined,
      keepStatistics
    );
    assert.match(result.error, /book changed/);
    assert.deepEqual(result.deleted, []);
    assert.deepEqual(await f.snapshot(), before);
    assert.deepEqual(f.notices, []);
  });

test('canonical legacy deletion retaining statistics admits its original UUID', async (t) => {
  const f = await fixture(t);
  const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await f.db.put('data', { ...row(), contentHash: undefined });
  await f.db.put('readerLocalIdentity', { bookId: 1, uuid });
  const result = await f.remove(
    new Map([
      [
        1,
        {
          ...target(),
          contentHash: undefined,
          readerBookKey: `local:${uuid}`
        }
      ]
    ]),
    undefined,
    undefined,
    true
  );
  assert.deepEqual(result, { error: '', deleted: [1] });
  assert.equal(await f.db.get('data', 1), undefined);
  assert.equal((await f.db.getAll('statistic')).length, 1);
});

test('legacy callers omitting admission identities retain their deletion contract', async (t) => {
  const f = await fixture(t);
  const result = await f.service.deleteData(
    [1],
    new Map(),
    new AbortController().signal,
    false,
    null
  );
  assert.deepEqual(result, { error: '', deleted: [1] });
  assert.equal(await f.db.get('data', 1), undefined);
  assert.equal((await f.db.getAll('statistic')).length, 0);
  assert.equal((await f.db.getAll('readerStatistic')).length, 0);
});

// Execute the reader's actual async load callback, obtained structurally from
// TypeScript's AST. No source-text assertions or reimplemented admission branch.
const sessionPath = new URL(
  '../../apps/web/src/reader-react/session-controller.ts',
  import.meta.url
);
const sessionSource = ts.createSourceFile(
  sessionPath.pathname,
  readFileSync(sessionPath, 'utf8'),
  ts.ScriptTarget.Latest,
  true
);
let loadCallback, ownedDialogsDeclaration, publishSessionDialogsDeclaration;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(sessionSource) === 'rawBookData$')
    loadCallback = node.initializer.arguments[0].arguments[0];
  if (ts.isVariableDeclaration(node) && node.name.getText(sessionSource) === 'ownedDialogs')
    ownedDialogsDeclaration = node.parent.parent;
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'publishSessionDialogs')
    publishSessionDialogsDeclaration = node;
  ts.forEachChild(node, visit);
}
visit(sessionSource);
assert.ok(loadCallback && ts.isArrowFunction(loadCallback));
assert.ok(ownedDialogsDeclaration && ts.isVariableStatement(ownedDialogsDeclaration));
assert.ok(publishSessionDialogsDeclaration);
const loadCode = ts.transpileModule(
  `${ownedDialogsDeclaration.getText(sessionSource)}
  ${publishSessionDialogsDeclaration.getText(sessionSource)}
  const load = ${loadCallback.getText(sessionSource)};`,
  {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }
).outputText;
const makeReaderLoad = compileFunction(
  `with (context) { ${loadCode}\n return {load, publishSessionDialogs}; }`,
  ['context']
);
const { readerAccessOwners } = load('lib/library/account-visibility.ts', {
  './book-identity.ts': load('lib/library/book-identity.ts')
});
async function readerFixture(t, expected = target()) {
  const f = await fixture(t);
  const effects = [];
  const dialogs = [];
  let currentDialogs = [];
  const lifetime = new AbortController();
  const operation = new AbortController();
  const native = new AbortController();
  let current = true;
  let getHook = async () => {};
  let account = 'alice';
  const context = {
    readerLoadGeneration: 0,
    readerLeaseLifetime: lifetime,
    readerLease: undefined,
    expectedBook: identity.snapshotBookAccessIdentity(expected),
    bookAuthority: {
      signal: native.signal,
      assertCurrent() {
        if (!current) throw new Error('Session changed');
      }
    },
    captureLibraryOperation() {
      return {
        signal: operation.signal,
        profileId: account,
        assertCurrent() {
          operation.signal.throwIfAborted();
        },
        stop() {}
      };
    },
    assertBookAccessIdentity: identity.assertBookAccessIdentity,
    acquireReaderLease: async () => {},
    __readerController: {
      changed(value) {
        return value;
      }
    },
    readerProtectedOwners: [],
    personalManagedBookId: undefined,
    showSpinner: true,
    localStorageHandler: undefined,
    externalStorageHandler: undefined,
    getStorageHandler: () => ({
      startContext() {},
      async getBook() {
        await getHook();
        return f.db.get('data', 1);
      },
      async updateLastRead() {
        effects.push('lastRead');
      }
    }),
    integrationDB: async () => ({ getAll: async () => [] }),
    database: {
      db: Promise.resolve(f.db),
      async getAdmittedData(...args) {
        await getHook();
        return f.service.getAdmittedData(...args);
      }
    },
    readerAccessOwners,
    $account: { status: 'signed-in' },
    localProfileUser: () => ({ id: account }),
    hasPersonalReadingAuthority: async () => false,
    window: {},
    document: { documentElement: { lang: 'ja' } },
    StorageKey: { BROWSER: 'browser' },
    StorageDataType: { STATISTICS: 'statistic' },
    $cacheStorageData$: false,
    $replicationSaveBehavior$: 0,
    $statisticsMergeMode$: 0,
    $readingGoalsMergeMode$: 0,
    $autoReplication$: 0,
    AutoReplicationType: { Off: 0 },
    $statisticsEnabled$: true,
    async syncDownData() {
      effects.push('sync');
    },
    async saveExternalLastRead(_external, book) {
      effects.push('externalLastRead');
      return book;
    },
    logger: { warn() {} },
    MessageDialog: 'dialog',
    dialogManager: {
      dialogs$: {
        getValue() {
          return currentDialogs;
        },
        next(value) {
          currentDialogs = value;
          dialogs.push(value);
        }
      }
    },
    syncedResolver() {}
  };
  const session = makeReaderLoad(context);
  return {
    ...f,
    effects,
    dialogs,
    context,
    ...session,
    hook(value) {
      getHook = value;
    },
    close() {
      lifetime.abort();
    },
    changeGeneration() {
      current = false;
      native.abort();
    },
    accountABA() {
      account = 'bob';
      operation.abort();
      account = 'alice';
    }
  };
}
for (const [field, replacement] of [
  ['contentHash', 'b'.repeat(64)],
  ['title', 'Replacement title'],
  ['lastBookModified', 11]
])
  test(`reader rejects changed ${field} from the actual IndexedDB content read before side effects`, async (t) => {
    const f = await readerFixture(t);
    f.hook(() => f.second.put('data', { ...row(), [field]: replacement }));
    assert.equal(await f.load(1), undefined);
    assert.deepEqual(f.effects, []);
    assert.match(f.dialogs[0][0].props.message, /book changed/);
  });
for (const action of ['close', 'changeGeneration', 'accountABA'])
  test(`reader ${action} while content read is pending prevents rendering and last-read/sync effects`, async (t) => {
    const f = await readerFixture(t);
    const gate = deferred();
    const reached = deferred();
    f.hook(async () => {
      reached.resolve();
      await gate.promise;
    });
    const reading = f.load(1);
    await reached.promise;
    f[action]();
    gate.resolve();
    assert.equal(await reading, undefined);
    assert.deepEqual(f.effects, []);
    assert.deepEqual(f.dialogs, []);
  });
test('reader rechecks foreign content ownership after exact identity admission', async (t) => {
  const f = await readerFixture(t);
  await f.db.put('data', { ...row(), libraryOwner: 'other-account' });
  assert.equal(await f.load(1), undefined);
  assert.deepEqual(f.effects, []);
});
test('reader accepts exactly admitted content and runs existing loading effects', async (t) => {
  const f = await readerFixture(t);
  const result = await f.load(1);
  assert.deepEqual(f.dialogs, []);
  assert.equal(result.elementHtml, row().elementHtml);
  assert.deepEqual(f.effects, ['lastRead', 'sync', 'externalLastRead']);
  assert.deepEqual(f.dialogs, []);
});

test('the extracted reader load keeps production dialog ownership and disposed-session fencing', async (t) => {
  const f = await readerFixture(t);
  f.hook(() => f.second.put('data', { ...row(), title: 'Replaced book' }));
  assert.equal(await f.load(1), undefined);
  assert.match(f.dialogs[0][0].props.message, /book changed/);
  const newer = [{ component: 'settings-dialog' }];
  f.context.dialogManager.dialogs$.next(newer);
  f.publishSessionDialogs([]);
  assert.equal(f.context.dialogManager.dialogs$.getValue(), newer);
  const own = [{ component: 'reader-dialog' }];
  f.publishSessionDialogs(own);
  assert.equal(f.context.dialogManager.dialogs$.getValue(), own);
  f.publishSessionDialogs([]);
  assert.deepEqual(f.context.dialogManager.dialogs$.getValue(), []);
  f.context.__readerController.disposed = true;
  f.publishSessionDialogs(own);
  assert.deepEqual(f.context.dialogManager.dialogs$.getValue(), []);
});

const legacyUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const legacyTarget = () => ({
  ...target(),
  contentHash: undefined,
  readerBookKey: `local:${legacyUuid}`
});
for (const changed of [false, true])
  test(`reader final canonical admission ${changed ? 'rejects a changed' : 'accepts the same'} legacy UUID`, async (t) => {
    const f = await readerFixture(t, legacyTarget());
    await f.db.put('data', { ...row(), contentHash: undefined });
    await f.db.put('readerLocalIdentity', {
      bookId: 1,
      uuid: changed ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : legacyUuid
    });
    const result = await f.load(1);
    if (changed) {
      assert.equal(result, undefined);
      assert.deepEqual(f.effects, []);
      assert.match(f.dialogs[0][0].props.message, /book changed/);
    } else {
      assert.equal(result.elementHtml, row().elementHtml);
      assert.deepEqual(f.effects, ['lastRead', 'sync', 'externalLastRead']);
      assert.deepEqual(f.dialogs, []);
    }
  });

for (const action of ['close', 'changeGeneration', 'accountABA'])
  test(`reader ${action} during the final canonical request prevents loading effects`, async (t) => {
    const f = await readerFixture(t, legacyTarget());
    await f.db.put('data', { ...row(), contentHash: undefined });
    await f.db.put('readerLocalIdentity', { bookId: 1, uuid: legacyUuid });
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
      const request = original.apply(this, args);
      if (this.name === 'readerLocalIdentity')
        request.addEventListener('success', () => f[action](), { once: true });
      return request;
    };
    t.after(() => {
      IDBObjectStore.prototype.get = original;
    });
    assert.equal(await f.load(1), undefined);
    assert.deepEqual(f.effects, []);
    assert.deepEqual(f.dialogs, []);
  });

test('web reader without expectedBook retains the existing local getBook path', async (t) => {
  const f = await readerFixture(t);
  f.context.expectedBook = undefined;
  f.context.database.getAdmittedData = () => {
    throw new Error('Unexpected guarded read');
  };
  assert.equal((await f.load(1)).elementHtml, row().elementHtml);
  assert.deepEqual(f.effects, ['lastRead', 'sync', 'externalLastRead']);
  assert.deepEqual(f.dialogs, []);
});

test('native reader uses a virtual reader route and remounts every new same-ID authority', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://expo.invalid/www.bundle/reader.html'
  });
  const previous = Object.fromEntries(
    ['window', 'document', 'history', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key)
    ])
  );
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    history: { configurable: true, value: dom.window.history },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true }
  });
  const root = createRoot(dom.window.document.getElementById('root'));
  t.after(async () => {
    await act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const mounts = [],
    unmounts = [],
    pages = [];
  function Session(props) {
    React.useEffect(() => {
      mounts.push(props);
      return () => unmounts.push(props);
    }, []);
    return React.createElement('div', { 'data-session': true });
  }
  const { ReaderScreen } = load('reader-react/index.tsx', {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    '../runtime/stores': {
      page: {
        set(value) {
          pages.push(value);
        }
      }
    },
    '../runtime/paths': { base: '/reader-web' },
    './session': { ReaderScreen: Session },
    './book-reader': { BookReader: () => null }
  });
  const expectedBook = target();
  const first = { signal: new AbortController().signal, assertCurrent() {} };
  await act(() =>
    root.render(
      React.createElement(ReaderScreen, { bookId: 1, expectedBook, bookAuthority: first })
    )
  );
  assert.equal(pages.at(-1).url.pathname, '/reader-web/b');
  assert.equal(pages.at(-1).url.searchParams.get('id'), '1');
  assert.equal(dom.window.location.pathname, '/www.bundle/reader.html');
  assert.equal(mounts.length, 1);
  const second = { signal: new AbortController().signal, assertCurrent() {} };
  await act(() =>
    root.render(
      React.createElement(ReaderScreen, { bookId: 1, expectedBook, bookAuthority: second })
    )
  );
  assert.equal(mounts.length, 2);
  assert.equal(unmounts.length, 1);
  assert.equal(mounts[1].bookAuthority, second);
  await act(() => root.render(React.createElement(ReaderScreen, {})));
  assert.equal(pages.at(-1).url.pathname, '/www.bundle/reader.html');
});
