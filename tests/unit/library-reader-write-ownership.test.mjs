import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import * as transactions from '../../apps/web/src/lib/data/database/books-db/commit-transaction.mjs';

const { commitTransaction } = transactions;

function load(file, imports = {}) {
  const url = new URL('../../apps/web/src/lib/' + file, import.meta.url);
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: url.pathname,
    reportDiagnostics: true
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  compileFunction(outputText, ['require', 'module', 'exports'])(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name);
      return imports[name];
    },
    module,
    module.exports
  );
  return module.exports;
}

function memoryDB(initial, { onTransaction } = {}) {
  const tables = new Map(
    Object.entries(initial).map(([name, rows]) => [
      name,
      new Map(
        rows.map((row) => [
          name === 'lastItem' ? 0 : (row.id ?? row.dataId ?? row.annotationId ?? row.bookId),
          globalThis.structuredClone(row)
        ])
      )
    ])
  );
  const keyFor = (name, row) =>
    name === 'lastItem' ? 0 : (row.id ?? row.dataId ?? row.annotationId ?? row.bookId);
  const copy = (row) => (row === undefined ? undefined : globalThis.structuredClone(row));
  const storeFor = (name) => {
    const rows = tables.get(name);
    return {
      get: async (key) => copy(rows.get(key)),
      getAll: async () => [...rows.values()].map(copy),
      put: async (row, explicitKey) => {
        const key = explicitKey ?? keyFor(name, row);
        rows.set(key, copy(row));
        return key;
      },
      delete: async (key) => rows.delete(key),
      index: (field) => ({
        async getAllKeys(value, count) {
          const keys = [...rows.entries()]
            .filter(([, row]) => row[field] === value)
            .map(([key]) => key);
          return count === undefined ? keys : keys.slice(0, count);
        }
      }),
      openCursor: async () => {
        const values = [...rows.values()].map(copy);
        const cursor = (index) =>
          index >= values.length
            ? null
            : { value: values[index], continue: async () => cursor(index + 1) };
        return cursor(0);
      }
    };
  };
  return {
    transaction(names) {
      const selected = typeof names === 'string' ? [names] : names;
      onTransaction?.({ selected, tables });
      let aborted = false;
      const tx = {
        done: Promise.resolve(),
        abort() {
          aborted = true;
        },
        objectStore(name) {
          assert.ok(selected.includes(name), 'store not in transaction: ' + name);
          if (aborted) throw new DOMException('aborted', 'AbortError');
          return storeFor(name);
        }
      };
      if (selected.length === 1) tx.store = tx.objectStore(selected[0]);
      return tx;
    },
    async get(name, key) {
      return storeFor(name).get(key);
    },
    async getAll(name) {
      const values = [];
      for (let cursor = await storeFor(name).openCursor(); cursor; cursor = await cursor.continue())
        values.push(copy(cursor.value));
      return values;
    },
    rows(name) {
      return [...tables.get(name).values()].map(copy);
    }
  };
}

const bookRecords = load('data/database/books-db/book-records.ts', {
  './commit-transaction.mjs': { commitTransaction },
  '../../../functions/replication/replication-error.ts': {
    throwIfAborted(signal) {
      signal?.throwIfAborted();
    }
  },
  '../../../manabi/shared-title-selection.ts': { uniqueSharedCopy: () => undefined },
  '../../../library/completion.ts': {
    mergeCompletion: (before, incoming) => ({ ...before, ...incoming })
  }
});

test('last-read persistence rejects a live foreign owner without changing the timestamp', async () => {
  const db = memoryDB({
    data: [{ id: 1, title: 'Book', libraryOwner: 'bob', lastBookOpen: 10 }],
    readerBookScope: []
  });
  await assert.rejects(
    bookRecords.updateBookLastRead(db, 1, 20, 'alice', () => undefined),
    /another account/
  );
  assert.equal(db.rows('data')[0].lastBookOpen, 10);
});

test('last-read persistence accepts the current owner and never moves time backwards', async () => {
  const db = memoryDB({
    data: [{ id: 1, title: 'Book', libraryOwner: 'alice', lastBookOpen: 20 }],
    readerBookScope: []
  });
  const current = await bookRecords.updateBookLastRead(db, 1, 10, 'alice', () => undefined);
  assert.equal(current.lastBookOpen, 20);
  const advanced = await bookRecords.updateBookLastRead(db, 1, 30, 'alice', () => undefined);
  assert.equal(advanced.lastBookOpen, 30);
  assert.equal(db.rows('data')[0].lastBookOpen, 30);
});

test('personal scope hides state and preserves recency without hiding local book content', async () => {
  const db = memoryDB({
    data: [{ id: 1, title: 'Book', lastBookOpen: 10 }],
    bookmark: [{ dataId: 1, progress: 0.25, lastBookmarkModified: 1 }],
    readerBookScope: [{ bookId: 1, accountId: 'bob' }]
  });
  const summary = await bookRecords.updateBookLastRead(db, 1, 20, 'alice', () => undefined);
  assert.equal(summary.lastBookOpen, 10);
  assert.equal(await bookRecords.readOwnedBookmark(db, 1, 'alice', () => undefined), undefined);
  await assert.rejects(
    bookRecords.commitOwnedBookmark(
      db,
      { dataId: 1, progress: 0.9, lastBookmarkModified: 2 },
      'alice',
      () => undefined
    ),
    /another account/
  );
  assert.equal(db.rows('data')[0].lastBookOpen, 10);
  assert.equal(db.rows('bookmark')[0].progress, 0.25);
});

test('matching personal scope exposes and updates reading state normally', async () => {
  const db = memoryDB({
    data: [{ id: 1, title: 'Book', lastBookOpen: 10 }],
    bookmark: [{ dataId: 1, progress: 0.25, lastBookmarkModified: 1 }],
    readerBookScope: [{ bookId: 1, accountId: 'alice' }]
  });
  assert.equal(
    (await bookRecords.readOwnedBookmark(db, 1, 'alice', () => undefined)).progress,
    0.25
  );
  await bookRecords.commitOwnedBookmark(
    db,
    { dataId: 1, progress: 0.9, lastBookmarkModified: 2 },
    'alice',
    () => undefined
  );
  assert.equal(db.rows('bookmark')[0].progress, 0.9);
});

test('bookmark persistence rejects a live foreign owner before touching progress', async () => {
  const db = memoryDB({
    data: [{ id: 1, title: 'Book', libraryOwner: 'bob' }],
    bookmark: [{ dataId: 1, progress: 0.25, lastBookmarkModified: 1 }],
    readerBookScope: []
  });
  await assert.rejects(
    bookRecords.commitOwnedBookmark(
      db,
      { dataId: 1, progress: 0.9, lastBookmarkModified: 2 },
      'alice',
      () => undefined
    ),
    /another account/
  );
  assert.equal(db.rows('bookmark')[0].progress, 0.25);
});

test('bookmark persistence requires the book to still exist', async () => {
  const db = memoryDB({
    data: [],
    bookmark: [{ dataId: 1, progress: 0.25, lastBookmarkModified: 1 }],
    readerBookScope: []
  });
  await assert.rejects(
    bookRecords.commitOwnedBookmark(
      db,
      { dataId: 1, progress: 0.9, lastBookmarkModified: 2 },
      'alice',
      () => undefined
    ),
    /no longer in the library/
  );
  assert.equal(db.rows('bookmark')[0].progress, 0.25);
});

test('local open admission rejects a newly foreign library owner without detaching its source', async () => {
  const db = memoryDB({
    data: [
      {
        id: 1,
        title: 'Book',
        elementHtml: '<p>book</p>',
        storageSource: 'Legacy source',
        libraryOwner: 'bob'
      }
    ],
    readerBookScope: []
  });
  await assert.rejects(
    bookRecords.prepareBookForLocalReading(
      db,
      { id: 1, title: 'Book' },
      undefined,
      'alice',
      () => undefined
    ),
    /another account/
  );
  assert.equal(db.rows('data')[0].storageSource, 'Legacy source');
});

test('local open admission rejects a newly foreign personal scope', async () => {
  const db = memoryDB({
    data: [{ id: 1, title: 'Book', elementHtml: '<p>book</p>', storageSource: 'Legacy source' }],
    readerBookScope: [{ bookId: 1, accountId: 'bob' }]
  });
  await assert.rejects(
    bookRecords.prepareBookForLocalReading(
      db,
      { id: 1, title: 'Book' },
      undefined,
      'alice',
      () => undefined
    ),
    /another account/
  );
  assert.equal(db.rows('data')[0].storageSource, 'Legacy source');
});

test('owned local open can detach legacy source metadata after the live ownership check', async () => {
  const db = memoryDB({
    data: [
      {
        id: 1,
        title: 'Book',
        elementHtml: '<p>book</p>',
        storageSource: 'Legacy source',
        libraryOwner: 'alice'
      }
    ],
    readerBookScope: [{ bookId: 1, accountId: 'alice' }]
  });
  assert.equal(
    await bookRecords.prepareBookForLocalReading(
      db,
      { id: 1, title: 'Book' },
      undefined,
      'alice',
      () => undefined
    ),
    1
  );
  assert.equal(db.rows('data')[0].storageSource, undefined);
});

test('resume target read hides a foreign pointer without deleting it', async () => {
  const db = memoryDB({
    data: [{ id: 1, title: 'Book', libraryOwner: 'bob' }],
    readerBookScope: [],
    lastItem: [{ dataId: 1 }]
  });
  assert.equal(await bookRecords.readOwnedLastItem(db, 'alice', () => undefined), undefined);
  assert.deepEqual(db.rows('lastItem'), [{ dataId: 1 }]);

  assert.deepEqual(await bookRecords.readOwnedLastItem(db, 'bob', () => undefined), {
    dataId: 1
  });
});

test('resume target read applies personal scope and ignores stale missing targets', async () => {
  const scoped = memoryDB({
    data: [{ id: 1, title: 'Book' }],
    readerBookScope: [{ bookId: 1, accountId: 'alice' }],
    lastItem: [{ dataId: 1 }]
  });
  assert.equal(await bookRecords.readOwnedLastItem(scoped, 'bob', () => undefined), undefined);
  assert.deepEqual(await bookRecords.readOwnedLastItem(scoped, 'alice', () => undefined), {
    dataId: 1
  });

  const missing = memoryDB({
    data: [],
    readerBookScope: [],
    lastItem: [{ dataId: 999 }]
  });
  assert.equal(await bookRecords.readOwnedLastItem(missing, null, () => undefined), undefined);
  assert.deepEqual(missing.rows('lastItem'), [{ dataId: 999 }]);
});

test('resume target persistence rejects a newly foreign book and preserves the previous target', async () => {
  const db = memoryDB({
    data: [{ id: 1, title: 'Book', libraryOwner: 'bob' }],
    readerBookScope: [],
    lastItem: [{ dataId: 7 }]
  });
  await assert.rejects(
    bookRecords.commitOwnedLastItem(db, 1, 'alice', () => undefined),
    /another account/
  );
  assert.deepEqual(db.rows('lastItem'), [{ dataId: 7 }]);
});

test('resume target persistence checks personal scope and commits only the owned ID', async () => {
  const foreign = memoryDB({
    data: [{ id: 1, title: 'Book' }],
    readerBookScope: [{ bookId: 1, accountId: 'bob' }],
    lastItem: []
  });
  await assert.rejects(
    bookRecords.commitOwnedLastItem(foreign, 1, 'alice', () => undefined),
    /another account/
  );
  assert.deepEqual(foreign.rows('lastItem'), []);

  const owned = memoryDB({
    data: [{ id: 1, title: 'Book', libraryOwner: 'alice' }],
    readerBookScope: [{ bookId: 1, accountId: 'alice' }],
    lastItem: []
  });
  await bookRecords.commitOwnedLastItem(owned, 1, 'alice', () => undefined);
  assert.deepEqual(owned.rows('lastItem'), [{ dataId: 1 }]);
});

function annotationFixture({ bookOwner, scopeOwner, onTransaction } = {}) {
  const hash = 'a'.repeat(64);
  const bookKey = 'content:' + hash;
  const annotation = {
    id: '11111111-1111-1111-1111-111111111111',
    bookKey,
    kind: 'bookmark',
    targets: [
      {
        version: 1,
        bookKey,
        resource: { href: 'chapter.xhtml', spineIndex: 0, sectionId: 's1' },
        projectionVersion: 1,
        resourceDigest: 'digest',
        start: 0,
        end: 0,
        quote: '',
        prefix: '',
        suffix: ''
      }
    ],
    createdAt: '2026-09-28T00:00:00.000Z',
    modifiedAt: '2026-09-28T00:00:00.000Z',
    revision: 1
  };
  const db = memoryDB(
    {
      data: [{ id: 1, contentHash: hash, ...(bookOwner ? { libraryOwner: bookOwner } : {}) }],
      readerBookScope: [],
      readerAnnotation: [annotation],
      readerAnnotationOutbox: [],
      readerAnnotationScope: scopeOwner
        ? [{ annotationId: annotation.id, accountId: scopeOwner }]
        : [],
      readerConflict: [
        {
          id: 'import:' + annotation.id,
          bookKey,
          local: annotation,
          remote: { ...annotation, body: 'archive' }
        }
      ]
    },
    { onTransaction }
  );
  let user = { id: 'alice' };
  const operationControllers = new Set();
  const api = load('reader-annotations.ts', {
    '$lib/data/store': { database: { db: Promise.resolve(db) } },
    'svelte/store': { get: (value) => value.value },
    '$lib/manabi/client': {
      account: { value: { status: 'ready' } },
      localProfileUser: () => user
    },
    '$lib/manabi/operation-scope': {
      captureLibraryOperation: () => {
        const profileId = user?.id ?? null;
        const controller = new AbortController();
        const token = { profileId, controller };
        operationControllers.add(token);
        return {
          profileId,
          signal: controller.signal,
          assertCurrent() {
            if ((user?.id ?? null) !== profileId) {
              controller.abort();
              throw new Error('The account changed.');
            }
            controller.signal.throwIfAborted();
          },
          stop() {
            operationControllers.delete(token);
          }
        };
      }
    },
    '$lib/reader-location': { snapshotReaderLocator: (value) => globalThis.structuredClone(value) },
    '$lib/data/database/books-db/content-hash-index': {
      readIndexedBookMetadata: async (store) => {
        const books = [];
        for (let cursor = await store.openCursor(); cursor; cursor = await cursor.continue()) {
          const value = cursor.value;
          if (typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.contentHash))
            continue;
          books.push({
            id: value.id,
            title: value.title ?? '',
            contentHash: value.contentHash.toLowerCase(),
            ...(value.libraryOwner ? { libraryOwner: value.libraryOwner } : {})
          });
        }
        return books;
      }
    }
  });
  return {
    api,
    db,
    annotation,
    bookKey,
    setUser(id) {
      user = id ? { id } : null;
      for (const token of operationControllers)
        if (token.profileId !== (user?.id ?? null)) token.controller.abort();
    }
  };
}

test('deleting an unscoped annotation cannot adopt a foreign-owned book', async () => {
  const fixture = annotationFixture({ bookOwner: 'bob' });
  await assert.rejects(
    fixture.api.removeReaderAnnotation(fixture.annotation.id, 'alice'),
    /another account/
  );
  assert.equal(fixture.db.rows('readerAnnotation')[0].deletedAt, undefined);
  assert.equal(fixture.db.rows('readerAnnotationScope').length, 0);
  assert.equal(fixture.db.rows('readerAnnotationOutbox').length, 0);
});

test('archive conflict restore cannot adopt an unscoped foreign-owned annotation', async () => {
  const fixture = annotationFixture({ bookOwner: 'bob' });
  await assert.rejects(
    fixture.api.resolveAnnotationImportConflict(
      'import:' + fixture.annotation.id,
      'restore-archive',
      'alice'
    ),
    /another account/
  );
  assert.equal(fixture.db.rows('readerAnnotation')[0].body, undefined);
  assert.equal(fixture.db.rows('readerConflict').length, 1);
});

test('a stale annotation scope cannot override newer foreign book ownership', async () => {
  const fixture = annotationFixture({ bookOwner: 'bob', scopeOwner: 'alice' });
  const draft = {
    id: fixture.annotation.id,
    bookKey: fixture.bookKey,
    kind: 'bookmark',
    targets: fixture.annotation.targets
  };
  await assert.rejects(fixture.api.saveReaderAnnotation(draft, 'alice'), /another account/);
  await assert.rejects(
    fixture.api.removeReaderAnnotation(fixture.annotation.id, 'alice'),
    /another account/
  );
  await assert.rejects(
    fixture.api.resolveAnnotationImportConflict(
      'import:' + fixture.annotation.id,
      'restore-archive',
      'alice'
    ),
    /another account/
  );
  assert.equal(fixture.db.rows('readerAnnotation')[0].deletedAt, undefined);
  assert.equal(fixture.db.rows('readerAnnotation')[0].body, undefined);
  assert.equal(fixture.db.rows('readerAnnotationOutbox').length, 0);
  assert.equal(fixture.db.rows('readerConflict').length, 1);
});

test('archive import rejects a stale annotation scope when its book is foreign', async () => {
  const fixture = annotationFixture({ bookOwner: 'bob', scopeOwner: 'alice' });
  const archive = JSON.stringify({
    format: 'manabi-reader-annotations',
    version: 1,
    annotations: [fixture.annotation]
  });
  await assert.rejects(fixture.api.importReaderAnnotations(archive, 'alice'), /another account/);
  assert.equal(fixture.db.rows('readerAnnotationOutbox').length, 0);
  assert.equal(fixture.db.rows('readerConflict').length, 1);
});

test('deleting a genuinely local unscoped annotation binds its tombstone to the active profile', async () => {
  const fixture = annotationFixture();
  await fixture.api.removeReaderAnnotation(fixture.annotation.id, 'alice');
  assert.ok(fixture.db.rows('readerAnnotation')[0].deletedAt);
  assert.deepEqual(fixture.db.rows('readerAnnotationScope'), [
    { annotationId: fixture.annotation.id, accountId: 'alice' }
  ]);
  assert.equal(fixture.db.rows('readerAnnotationOutbox').length, 1);
  assert.equal(fixture.db.rows('readerAnnotationOutbox')[0].accountId, 'alice');
});

test('annotation save rechecks book ownership inside the mutation transaction', async () => {
  let changed = false;
  const fixture = annotationFixture({
    onTransaction({ selected, tables }) {
      if (changed || !selected.includes('readerAnnotation')) return;
      changed = true;
      tables.get('readerBookScope').set(1, { bookId: 1, accountId: 'bob' });
    }
  });
  const draft = {
    bookKey: fixture.bookKey,
    kind: 'bookmark',
    targets: fixture.annotation.targets
  };
  const before = fixture.db.rows('readerAnnotation');
  await assert.rejects(fixture.api.saveReaderAnnotation(draft, 'alice'), /another account/);
  assert.deepEqual(fixture.db.rows('readerAnnotation'), before);
  assert.equal(fixture.db.rows('readerAnnotationOutbox').length, 0);
  assert.equal(fixture.db.rows('readerAnnotationScope').length, 0);
});

test('annotation archive import cannot commit after book ownership changes at write admission', async () => {
  let changed = false;
  const fixture = annotationFixture({
    onTransaction({ selected, tables }) {
      if (changed || !selected.includes('readerAnnotation')) return;
      changed = true;
      tables.get('readerBookScope').set(1, { bookId: 1, accountId: 'bob' });
    }
  });
  const incoming = {
    ...fixture.annotation,
    id: '22222222-2222-2222-2222-222222222222',
    createdAt: '2026-09-28T01:00:00.000Z',
    modifiedAt: '2026-09-28T01:00:00.000Z'
  };
  const archive = JSON.stringify({
    format: 'manabi-reader-annotations',
    version: 1,
    annotations: [incoming]
  });
  const before = fixture.db.rows('readerAnnotation');
  await assert.rejects(fixture.api.importReaderAnnotations(archive, 'alice'), /another account/);
  assert.deepEqual(fixture.db.rows('readerAnnotation'), before);
  assert.equal(fixture.db.rows('readerAnnotationOutbox').length, 0);
  assert.equal(fixture.db.rows('readerConflict').length, 1);
});

test('profile change aborts a pending annotation mutation instead of acknowledging it', async () => {
  const fixture = annotationFixture();
  const draft = {
    bookKey: fixture.bookKey,
    kind: 'bookmark',
    targets: fixture.annotation.targets
  };
  // Change the active profile as soon as the annotation transaction is admitted.
  let switched = false;
  const originalTransaction = fixture.db.transaction;
  fixture.db.transaction = function transaction(names) {
    const tx = originalTransaction.call(this, names);
    const selected = typeof names === 'string' ? [names] : names;
    if (!switched && selected.includes('readerAnnotation')) {
      switched = true;
      globalThis.queueMicrotask(() => fixture.setUser('bob'));
    }
    return tx;
  };
  await assert.rejects(fixture.api.saveReaderAnnotation(draft, 'alice'), /account changed/i);
  assert.equal(fixture.db.rows('readerAnnotationOutbox').length, 0);
});
