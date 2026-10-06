/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';
import * as transactions from '../../apps/web/src/lib/data/database/books-db/commit-transaction.mjs';
const lib = new URL('../../apps/web/src/lib/', import.meta.url);
const compiled = new Map();
function load(path, dependencies = {}) {
  let code = compiled.get(path);
  if (!code) {
    code = ts.transpileModule(readFileSync(new URL(path, lib), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    compiled.set(path, code);
  }
  const exports = {};
  runInNewContext(
    code,
    {
      exports,
      AbortController,
      AbortSignal,
      DOMException,
      Error,
      File,
      Blob,
      ArrayBuffer,
      Uint8Array,
      structuredClone,
      require(name) {
        if (name in dependencies) return dependencies[name];
        return new Proxy(
          {},
          {
            get(_target, key) {
              if (key === '__esModule') return false;
              throw new Error(`Unexpected dependency use: ${name}.${String(key)}`);
            }
          }
        );
      }
    },
    { filename: path }
  );
  return exports;
}
const binary = load('data/database/books-db/book-binary.ts');
const identity = load('data/database/books-db/direct-import-identity.ts');
const index = load('data/database/books-db/content-hash-index.ts');
const cancellation = load('functions/replication/replication-error.ts');
const behavior = load('functions/replication/replication-options.ts');
const merge = load('data/merge-mode.ts');
const libraryIdentity = load('library/book-identity.ts');
const visibility = load('library/account-visibility.ts', { './book-identity.ts': libraryIdentity });
const storage = {
  StorageKey: { BROWSER: 'browser' },
  InternalStorageSources: { INTERNAL_DEFAULT: 'browser' }
};
const base = load('data/storage/handler/base-handler.ts', {
  '$lib/data/env': { ttuCompatibilityRootName: 'ttu' },
  '$lib/data/storage/storage-types': storage,
  '$lib/data/merge-mode': merge,
  '$lib/functions/replication/replication-options': behavior,
  '$lib/functions/replication/replication-progress': { replicationProgress$: { next() {} } }
});
const hash = 'a'.repeat(64);
const original = {
  id: 7,
  title: 'Established title',
  contentHash: hash,
  lastBookModified: 100,
  lastBookOpen: 90,
  elementHtml: '<p>Original</p>',
  blobs: {},
  sections: [],
  metadata: { description: 'Keep metadata' }
};
const incoming = {
  title: 'Replacement title',
  contentHash: hash,
  lastBookModified: 200,
  lastBookOpen: 0,
  elementHtml: '<p>Replacement</p>',
  blobs: {},
  sections: []
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
let serial = 0;
async function fixture(t) {
  const name = `native-catalog-final-${++serial}`;
  const db = await openDB(name, 1, {
    upgrade(db) {
      const data = db.createObjectStore('data', { keyPath: 'id', autoIncrement: true });
      data.createIndex('contentHash', 'contentHash');
      data.createIndex('title', 'title');
      db.createObjectStore('readerBookScope', { keyPath: 'bookId' });
      db.createObjectStore('bookmark', { keyPath: 'dataId' });
    }
  });
  const f = {
    profile: null,
    links: [],
    listeners: new Set(),
    writes: 0,
    stops: 0,
    linksRead: 0,
    relocations: 0,
    controller: new AbortController()
  };
  const client = {
    localProfileUser: () => (f.profile === null ? undefined : { id: f.profile }),
    localUser: {
      subscribe(notify) {
        f.listeners.add(notify);
        notify(client.localProfileUser());
        return () => {
          f.listeners.delete(notify);
          f.stops++;
        };
      }
    },
    IntegrationError: class extends Error {
      constructor(code) {
        super(code);
        this.code = code;
      }
    },
    accountScope() {
      throw new Error('No authentication required');
    }
  };
  f.setProfile = (profile) => {
    f.profile = profile;
    for (const notify of f.listeners) notify(client.localProfileUser());
  };
  const operation = load('manabi/operation-scope.ts', { './client': client });
  const { DatabaseService } = load('data/database/books-db/database.service.ts', {
    './book-binary': binary,
    './commit-transaction.mjs': transactions,
    './direct-import-identity': identity,
    './content-hash-index': index,
    '$lib/manabi/operation-scope': operation,
    '$lib/functions/replication/replication-error': cancellation,
    '$lib/functions/replication/replication-options': behavior,
    '$lib/library/account-visibility': visibility
  });
  const service = Object.create(DatabaseService.prototype);
  service.db = Promise.resolve(db);
  const browser = load('data/storage/handler/browser-handler.ts', {
    '$lib/data/database/books-db/book-binary': binary,
    '$lib/data/storage/handler/base-handler': base,
    '$lib/data/store': { database: service },
    '$lib/functions/replication/replication-options': behavior,
    '$lib/functions/replication/replication-error': cancellation,
    '$lib/library/organization': {
      bookKey: (id) => `book:${id}`,
      contentBookKey: (value) => `content:${value}`,
      relocatePresentation: async () => {
        f.relocations++;
      }
    }
  });
  const catalog = load('library/editors-pick-storage.ts', {
    '$lib/data/database/books-db/commit-transaction.mjs': transactions,
    '$lib/data/storage/handler/browser-handler': browser,
    '$lib/data/storage/storage-types': storage,
    '$lib/data/store': { database: service },
    '$lib/functions/replication/replication-error': cancellation,
    '$lib/manabi/persistence': {
      integrationDB: async () => ({
        getAll: async () => {
          f.linksRead++;
          return structuredClone(f.links);
        }
      })
    },
    './account-visibility': visibility
  });
  const handler = new catalog.EditorsPickStorageHandler({}, hash, null, f.controller.signal);
  handler.updateSettings(
    {},
    true,
    behavior.ReplicationSaveBehavior.Overwrite,
    merge.MergeMode.MERGE,
    merge.MergeMode.MERGE
  );
  handler.startContext({ title: incoming.title }, f.controller.signal);
  const put = IDBObjectStore.prototype.put,
    add = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === 'data') f.writes++;
    return put.apply(this, args);
  };
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === 'data') f.writes++;
    return add.apply(this, args);
  };
  t.after(async () => {
    IDBObjectStore.prototype.put = put;
    IDBObjectStore.prototype.add = add;
    f.controller.abort();
    db.close();
    await deleteDB(name);
  });
  return { f, db, handler, service };
}
function heldBook() {
  const began = deferred(),
    gate = deferred(),
    blob = new Blob(['Actual production binary encoding']);
  const read = blob.arrayBuffer.bind(blob);
  blob.arrayBuffer = async () => {
    began.resolve();
    await gate.promise;
    return read();
  };
  return {
    book: { ...structuredClone(incoming), blobs: { image: blob } },
    began: began.promise,
    release: () => gate.resolve()
  };
}

for (const kind of [
  'source',
  'foreign-durable',
  'foreign-reader',
  'foreign-link',
  'duplicate',
  'incomplete'
])
  test(`production catalog save rejects ${kind} arrival while real binary encoding is suspended without any write`, async (t) => {
    const { f, db, handler } = await fixture(t),
      held = heldBook();
    const pending = handler.saveBook(held.book, false);
    const rejected = assert.rejects(
      pending,
      /connected library|another account|Several local copies|incomplete/
    );
    await held.began;
    const saved = {
      ...structuredClone(original),
      ...(kind === 'source' ? { storageSource: 'local-files' } : {}),
      ...(kind === 'foreign-durable' ? { libraryOwner: 'other-profile' } : {}),
      ...(kind === 'incomplete' ? { elementHtml: '' } : {})
    };
    await db.put('data', saved);
    if (kind === 'foreign-reader')
      await db.put('readerBookScope', { bookId: 7, accountId: 'other-profile' });
    if (kind === 'foreign-link')
      f.links = [{ bookId: 7, owner: 'other-profile', contentHash: hash }];
    if (kind === 'duplicate') await db.put('data', { ...structuredClone(original), id: 8 });
    const before = await db.getAll('data'),
      writes = f.writes;
    held.release();
    await rejected;
    assert.equal(f.writes, writes, 'catalog transaction must not add or put');
    assert.deepEqual(await db.getAll('data'), before);
    assert.equal(handler.savedId, undefined);
    assert.equal(f.listeners.size, 0);
    assert.ok(f.linksRead >= 2, 'final integration links are captured after encoding');
  });

test('production catalog save reuses one allowed late copy unchanged under Overwrite and newer timestamps', async (t) => {
  const { f, db, handler } = await fixture(t),
    held = heldBook();
  const pending = handler.saveBook(held.book, false);
  await held.began;
  await db.put('data', structuredClone(original));
  await db.put('bookmark', { dataId: 7, exploredCharCount: 1234, lastBookmarkModified: 42 });
  const writes = f.writes;
  held.release();
  assert.equal(await pending, 7);
  assert.equal(handler.savedId, 7);
  assert.equal(f.writes, writes);
  assert.equal(f.relocations, 0, 'read-only catalog reuse must not relocate organization metadata');
  assert.deepEqual(await db.get('data', 7), original);
  assert.deepEqual(await db.get('bookmark', 7), {
    dataId: 7,
    exploredCharCount: 1234,
    lastBookmarkModified: 42
  });
  assert.equal(f.listeners.size, 0);
});

test('production catalog creates a genuinely new copy through original serializer and real IDB transaction', async (t) => {
  const { f, db, handler } = await fixture(t),
    held = heldBook();
  const pending = handler.saveBook(held.book, false);
  await held.began;
  held.release();
  const id = await pending;
  const saved = await db.get('data', id);
  assert.equal(saved.elementHtml, incoming.elementHtml);
  assert.equal(saved.blobs.image.format, 'reader-bytes-v1');
  assert.equal(saved.contentHash, hash);
  assert.equal(handler.savedId, id);
  assert.equal(f.relocations, 1, 'new catalog saves retain the original post-save behavior');
  assert.equal(f.writes, 1);
  assert.equal(f.listeners.size, 0);
});

for (const revoke of ['cancel', 'ABA'])
  test(`production catalog ${revoke} while binary encoding is suspended never admits a transaction write`, async (t) => {
    const { f, db, handler } = await fixture(t),
      held = heldBook();
    const pending = handler.saveBook(held.book, false);
    const rejected = assert.rejects(pending);
    await held.began;
    if (revoke === 'cancel') f.controller.abort();
    else {
      f.setProfile('other-profile');
      f.setProfile(null);
    }
    held.release();
    await rejected;
    assert.equal(f.writes, 0);
    assert.equal(await db.count('data'), 0);
    assert.equal(f.listeners.size, 0);
  });

test('ordinary import without catalog admission retains overwrite and source-context removal semantics', async (t) => {
  const { f, db, service } = await fixture(t);
  await db.put('data', { ...structuredClone(original), storageSource: 'local-files' });
  const writes = f.writes;
  const result = await service.upsertData(
    structuredClone(incoming),
    behavior.ReplicationSaveBehavior.Overwrite,
    false,
    true,
    f.controller.signal
  );
  assert.equal(result.id, 7);
  assert.equal(result.elementHtml, incoming.elementHtml);
  assert.equal(result.storageSource, undefined);
  assert.equal(f.writes, writes + 1);
});
