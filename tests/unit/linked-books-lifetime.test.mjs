/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { loadOfflineModule, storeBoundary } from './fixtures/offline-module.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const drain = async () => {
  for (let i = 0; i < 8; i++) await setImmediate();
};
function fixture() {
  const stores = storeBoundary();
  const localUser = stores.writable(null);
  const window = new EventTarget(),
    document = new EventTarget();
  const warnings = [],
    timers = new Set();
  const hash = 'a'.repeat(64);
  const link = { id: 'saved', sourceId: 'local-folder', bookId: 1, owner: null, contentHash: hash };
  let reads = 0,
    indexedReads = 0,
    migrations = 0;
  let read = async () => [link];
  let open = async () => ({
    getAll: async () => {
      reads++;
      return read();
    }
  });
  const { api } = loadOfflineModule('apps/web/src/lib/manabi/books.ts', {
    modules: {
      '$lib/webdav/source': {},
      '$lib/webdav/sync': {
        davSyncStatus: stores.writable({}),
        syncEnabledDavBooks: async () => {}
      },
      '$lib/state/store': stores,
      '$lib/data/store': { database: { db: Promise.resolve({}) } },
      '$lib/library/organization': { stabilizeOrganization: async () => migrations++ },
      '$lib/data/storage/storage-types': {},
      '$lib/data/storage/storage-view': {},
      '$lib/data/storage/storage-handler-factory': {},
      '$lib/data/database/books-db/book-binary': {},
      '$lib/data/database/books-db/library-import': {
        readIndexedBookIdentities: async () => {
          indexedReads++;
          return [{ id: 1, contentHash: hash }];
        }
      },
      '$lib/functions/file-loaders/epub/load-epub': {},
      '$lib/functions/file-loaders/txt/load-txt': {},
      '$lib/functions/file-loaders/htmlz/load-htmlz': {},
      './client': { localUser, localProfileUser: () => stores.get(localUser) },
      './persistence': { integrationDB: () => open() },
      './operation-scope': {},
      './sources': {},
      './personal-sync': {
        startPersonalSync: () => () => {},
        personalSyncStatus: stores.writable({ state: 'idle', conflicts: [], blockedBookKeys: [] })
      }
    },
    globals: {
      window,
      document,
      setInterval: (callback) => {
        timers.add(callback);
        return callback;
      },
      clearInterval: (callback) => timers.delete(callback),
      console: { warn: (...values) => warnings.push(values) }
    }
  });
  return {
    api,
    link,
    window,
    warnings,
    timers,
    read: (value) => (read = value),
    open: (value) => (open = value),
    refresh: () => localUser.set(stores.get(localUser)),
    linked: () => stores.get(api.linkedBooks),
    all: () => stores.get(api.allLinkedBooks),
    counts: () => ({ reads, indexedReads, migrations })
  };
}

test('background storage failure is handled, preserves saved links and can recover; manual callers still reject', async () => {
  const h = fixture();
  const stop = h.api.startBookSync();
  try {
    await drain();
    assert.deepEqual(h.counts(), { reads: 1, indexedReads: 1, migrations: 1 });
    assert.deepEqual(h.linked(), [h.link]);
    const unavailable = new DOMException('Indexed Database server unavailable', 'UnknownError');
    h.read(async () => {
      throw unavailable;
    });
    h.refresh();
    await drain();
    assert.deepEqual(h.linked(), [h.link]);
    assert.deepEqual(h.all(), [h.link]);
    assert.equal(h.warnings.length, 1);
    assert.equal(h.warnings[0][1], unavailable);
    await assert.rejects(h.api.refreshLinkedBooks(), (error) => error === unavailable);
    h.read(async () => []);
    h.refresh();
    await drain();
    assert.deepEqual(h.linked(), []);
    assert.deepEqual(h.all(), []);
  } finally {
    stop();
  }
  assert.equal(h.timers.size, 0);
});

test('page navigation handles a late native storage rejection, then BFCache restoration refreshes once', async () => {
  const h = fixture(),
    pending = deferred();
  h.read(() => pending.promise);
  const stop = h.api.startBookSync();
  try {
    await drain();
    assert.equal(h.counts().reads, 1);
    h.window.dispatchEvent(new Event('pagehide'));
    pending.reject(new DOMException('Page storage closed', 'UnknownError'));
    await drain();
    assert.equal(h.all(), null, 'An incomplete ownership snapshot must stay unavailable');
    assert.deepEqual(h.counts(), { reads: 1, indexedReads: 0, migrations: 0 });
    assert.deepEqual(h.warnings, []);
    h.refresh();
    await drain();
    assert.equal(h.counts().reads, 1, 'A suspended document must not launch another read');
    h.read(async () => [h.link]);
    h.window.dispatchEvent(new Event('pageshow'));
    h.window.dispatchEvent(new Event('pageshow'));
    await drain();
    assert.deepEqual(h.linked(), [h.link]);
    assert.equal(h.counts().reads, 2);
  } finally {
    stop();
  }
});

test('stopped runtime cannot start a delayed storage read or publish a completed predecessor', async () => {
  for (const phase of ['open', 'read']) {
    const h = fixture(),
      pending = deferred();
    if (phase === 'open') h.open(() => pending.promise);
    else h.read(() => pending.promise);
    const stop = h.api.startBookSync();
    await drain();
    stop();
    pending.resolve(phase === 'open' ? { getAll: () => assert.fail('Read after stop') } : [h.link]);
    await drain();
    h.window.dispatchEvent(new Event('pageshow'));
    h.refresh();
    await drain();
    assert.equal(h.all(), null);
    assert.equal(h.counts().indexedReads, 0);
    assert.equal(h.counts().migrations, 0);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.warnings, []);
  }
});
