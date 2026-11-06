import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { deferred, loadOfflineModule, storeBoundary } from './fixtures/offline-module.mjs';

// UNRUN: selected PR204 storage paths composed onto current main; no verification executed.
// Load complete production modules and control only storage/network boundaries.
function boundary(values = {}, requestFailure) {
  const done = deferred();
  const started = deferred();
  const aborted = deferred();
  let observed = false;
  const calls = [];
  const tx = {
    done: {
      then(onFulfilled, onRejected) {
        observed = true;
        return done.promise.then(onFulfilled, onRejected);
      }
    },
    objectStore(name) {
      const request = async (verb, args = []) => {
        assert.equal(observed, true, 'tx.done must be observed before its first request');
        calls.push([name, verb, ...args]);
        started.resolve();
        if (requestFailure) throw requestFailure;
        const value = values[`${name}.${verb}`];
        return typeof value === 'function' ? value(...args) : value;
      };
      return {
        get: (...args) => request('get', args),
        getAll: (...args) => request('getAll', args),
        put: (...args) => request('put', args),
        delete: (...args) => request('delete', args),
        count: () => request('count'),
        index: () => ({ openCursor: () => request('cursor') })
      };
    },
    abort() {
      aborted.resolve();
      throw new DOMException('Already aborted', 'InvalidStateError');
    }
  };
  tx.store = tx.objectStore('metadata');
  return { tx, done, started, aborted, calls };
}

const connection = {
  id: 'webdav-11111111-1111-4111-8111-111111111111',
  name: 'Books',
  url: 'https://dav.example/Books/',
  username: 'user',
  writable: true
};
const link = {
  id: 'book-link',
  sourceId: connection.id,
  root: connection.url,
  owner: null,
  bookId: 7,
  contentHash: 'a'.repeat(64),
  syncEnabled: false
};
function webdav(h) {
  const { api } = loadOfflineModule('apps/web/src/lib/webdav/source.ts', {
    modules: {
      '$lib/manabi/persistence': {
        integrationDB: async () => ({
          transaction: () => h.tx,
          get: async () => connection
        }),
        exclusive: async (_name, work) => work(),
        equal: (a, b) => JSON.stringify(a) === JSON.stringify(b)
      },
      '$lib/manabi/operation-scope': { withLibraryOperation: async (_owner, work) => work() },
      '$lib/library/book-download': { verifySelectedBook: (value) => value },
      './client': {
        WebDavClient: class {
          constructor(_url, _username, password, signal) {
            this.password = password;
            this.signal = signal;
          }
        },
        davRoot: (value) => new URL(value),
        davChild: (_root, value) => new URL(value),
        DavError: class extends Error {
          constructor(code, message) {
            super(message);
            this.code = code;
          }
        },
        strongEtag: () => false,
        decodeDavText: () => ''
      }
    }
  });
  return api;
}
const cloud = {
  id: '11111111-1111-4111-8111-111111111111',
  owner: 'owner',
  root: '/Books/',
  provider: 'onedrive'
};
const plan = {
  id: '22222222-2222-4222-8222-222222222222',
  root: cloud.root,
  receipts: [{ connection_id: cloud.id, root: cloud.root, item_id: 'item', name: 'Book' }]
};
function receipts(h) {
  return loadOfflineModule('apps/web/src/lib/library/cloud-series.ts', {
    modules: {
      '$lib/manabi/client': {
        currentUser: () => ({ id: 'owner' }),
        request: () => assert.fail('Receipt reconciliation must not call the provider')
      },
      '$lib/manabi/persistence': { integrationDB: async () => ({ transaction: () => h.tx }) },
      './organization': { sourceKey: () => 'source-key' }
    }
  }).api;
}
function identity(h) {
  return loadOfflineModule('apps/web/src/lib/reader-identity.ts', {
    modules: {
      '$lib/data/store': { database: { db: Promise.resolve({ transaction: () => h.tx }) } }
    },
    globals: { crypto: { randomUUID: () => 'local-uuid' } }
  }).api;
}
function recovery() {
  return loadOfflineModule('apps/web/src/lib/data/database/books-db/reader-statistics.ts', {
    modules: { './content-hash-index.ts': { readIndexedBookTitles: (store) => store.getAll() } }
  }).api;
}
const operations = [
  ['local identity', (h) => identity(h).readerBookKeyFor(7)],
  ['series receipts', (h) => receipts(h).applyCloudSeriesReceipts(cloud, plan)],
  [
    'WebDAV configuration',
    (h) => webdav(h).configureDav(connection, 'secret', { remember: false, expected: connection })
  ],
  ['WebDAV disconnect', (h) => webdav(h).disconnectDav(connection.id)],
  ['WebDAV source link', (h) => new (webdav(h).WebDavSource)(connection).persistLink(link)],
  [
    'statistics recovery',
    (h) => recovery().readStatisticsRecoverySnapshot({ transaction: () => h.tx })
  ]
];
function storageValues() {
  return {
    'metadata.get': (key) => (key.startsWith('webdav-source:') ? connection : undefined),
    'books.getAll': [],
    'data.getAll': [],
    'statistic.getAll': [],
    'readerStatistic.getAll': [],
    'readerStatisticMigration.getAll': [],
    'readerLocalIdentity.getAll': []
  };
}
for (const [name, run] of operations) {
  test(`${name} observes completion early and returns only after commit`, async () => {
    const h = boundary(storageValues());
    let settled = false;
    const pending = run(h).then((value) => {
      settled = true;
      return value;
    });
    await h.started.promise;
    await setImmediate();
    assert.equal(settled, false);
    h.done.resolve();
    const result = await pending;
    if (name === 'local identity') assert.equal(result, 'local:local-uuid');
    if (name === 'series receipts') {
      assert.equal(result, true);
      assert.ok(
        h.calls.some(([, verb, key]) => verb === 'delete' && key === 'library-catalog:source-key')
      );
    }
    if (name === 'WebDAV source link') assert.equal(result, link);
    if (name === 'statistics recovery')
      assert.equal(result.format, 'manabi-reader-statistics-recovery');
  });

  test(`${name} drains a request failure and separate completion rejection`, async () => {
    const failure = new DOMException('Request refused', 'UnknownError');
    const h = boundary(storageValues(), failure);
    let settled = false;
    const rejected = assert
      .rejects(run(h), (error) => error === failure)
      .then(() => {
        settled = true;
      });
    await h.aborted.promise;
    await setImmediate();
    assert.equal(settled, false);
    h.done.reject(new DOMException('Transaction aborted', 'AbortError'));
    await rejected;
  });

  test(`${name} rejects when successful requests fail to commit`, async () => {
    const h = boundary(storageValues());
    const failure = new DOMException('Commit refused', 'QuotaExceededError');
    const rejected = assert.rejects(run(h), (error) => error === failure);
    await h.started.promise;
    await setImmediate();
    h.done.reject(failure);
    await rejected;
  });
}

test('WebDAV configuration publishes session credentials only after durable completion', async () => {
  const h = boundary(storageValues());
  const api = webdav(h);
  const source = new api.WebDavSource(connection);
  const pending = api.configureDav(connection, 'secret', {
    remember: false,
    expected: connection
  });
  await h.started.promise;
  await setImmediate();
  await assert.rejects(source.documentClient(), /Unlock this WebDAV source/);
  h.done.resolve();
  await pending;
  assert.equal((await source.documentClient()).password, 'secret');
});

test('cancelled WebDAV configuration drains native abort and does not publish credentials', async () => {
  const h = boundary(storageValues());
  const api = webdav(h);
  const controller = new AbortController();
  const failure = new DOMException('Transaction aborted', 'AbortError');
  const rejected = assert.rejects(
    api.configureDav(connection, 'secret', {
      remember: false,
      expected: connection,
      signal: controller.signal
    }),
    (error) => error === failure
  );
  await h.started.promise;
  await setImmediate();
  controller.abort();
  await h.aborted.promise;
  h.done.reject(failure);
  await rejected;
  await assert.rejects(
    new api.WebDavSource(connection).documentClient(),
    /Unlock this WebDAV source/
  );
});

test('WebDAV source link preserves a concurrent per-book sync choice', async () => {
  const existing = { ...link, syncEnabled: true };
  const h = boundary({ ...storageValues(), 'books.get': existing });
  const pending = new (webdav(h).WebDavSource)(connection).persistLink(link);
  await h.started.promise;
  await setImmediate();
  h.done.resolve();
  assert.equal(await pending, existing);
  assert.equal(
    h.calls.some(([store, verb]) => store === 'books' && verb === 'put'),
    false
  );
});

test('repeated series receipts neither rewrite receipts nor invalidate the catalog', async () => {
  const h = boundary({ ...storageValues(), 'metadata.get': plan.receipts[0] });
  const pending = receipts(h).applyCloudSeriesReceipts(cloud, plan);
  await h.started.promise;
  await setImmediate();
  h.done.resolve();
  assert.equal(await pending, false);
  assert.deepEqual(
    h.calls.map(([, verb]) => verb),
    ['get']
  );
});

test('WebDAV disconnect removes only links for the disconnected source', async () => {
  const other = { ...link, id: 'other-book', sourceId: 'another-source' };
  const h = boundary({ ...storageValues(), 'books.getAll': [link, other] });
  const pending = webdav(h).disconnectDav(connection.id);
  await h.started.promise;
  await setImmediate();
  h.done.resolve();
  await pending;
  assert.deepEqual(
    h.calls.filter(([store, verb]) => store === 'books' && verb === 'delete'),
    [['books', 'delete', link.id]]
  );
});

for (const outcome of ['success', 'request failure', 'commit failure']) {
  test(`preview cache publication after ${outcome}`, async () => {
    const failure = new DOMException('Cache refused', 'QuotaExceededError');
    const h = boundary(
      { 'previews.count': 0, 'previews.cursor': null },
      outcome === 'request failure' ? failure : undefined
    );
    h.tx.store = h.tx.objectStore('previews');
    const finished = deferred();
    const source = { id: 'source', owner: null, root: '/Books/' };
    const { api } = loadOfflineModule('apps/web/src/lib/library/previews.ts', {
      modules: {
        idb: { openDB: async () => ({ get: async () => undefined, transaction: () => h.tx }) },
        '$lib/state/store': storeBoundary(),
        '$lib/functions/file-loaders/epub/extract-epub': {},
        '$lib/functions/file-loaders/epub/get-epub-cover-image-filename': {},
        '$lib/functions/file-loaders/epub/epub-direction': {},
        '$lib/functions/file-loaders/epub/types': {},
        '$lib/manabi/client': { currentUser: () => null },
        '$lib/manabi/sources': { sha256: async () => 'a'.repeat(64) },
        './catalog': { librarySource: async () => ({ read: async () => new Blob(['Text']) }) },
        './organization': { sourceBookKey: () => 'preview-key' },
        './direction': {},
        './book-metadata': {},
        './book-presentation': {}
      }
    });
    const published = [];
    const stop = api.previews.subscribe((value) => {
      if (value['preview-key']) {
        published.push(value['preview-key']);
        finished.resolve();
      }
    });
    const queue = new api.PreviewQueue((error) => finished.resolve(error));
    queue.add(source, { id: 'item', name: 'Book.txt', kind: 'file' }, 7);
    await h.started.promise;
    await setImmediate();
    assert.deepEqual(published, []);
    if (outcome === 'request failure') {
      await h.aborted.promise;
      h.done.reject(new DOMException('Transaction aborted', 'AbortError'));
    } else if (outcome === 'commit failure') h.done.reject(failure);
    else h.done.resolve();
    const result = await finished.promise;
    if (outcome !== 'success') {
      assert.equal(result, failure);
      assert.deepEqual(published, []);
    } else {
      assert.equal(published.length, 1);
      assert.equal(published[0].title, 'Book');
    }
    stop();
  });
}
