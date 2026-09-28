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

function memoryDB(initial) {
  const tables = new Map(
    Object.entries(initial).map(([name, rows]) => [
      name,
      new Map(
        rows.map((row) => [
          row.id ?? row.dataId ?? row.annotationId ?? row.bookId,
          globalThis.structuredClone(row)
        ])
      )
    ])
  );
  const keyFor = (row) => row.id ?? row.dataId ?? row.annotationId ?? row.bookId;
  const copy = (row) => (row === undefined ? undefined : globalThis.structuredClone(row));
  const storeFor = (name) => {
    const rows = tables.get(name);
    return {
      get: async (key) => copy(rows.get(key)),
      put: async (row) => {
        rows.set(keyFor(row), copy(row));
        return keyFor(row);
      },
      delete: async (key) => rows.delete(key),
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
    data: [{ id: 1, title: 'Book', libraryOwner: 'bob', lastBookOpen: 10 }]
  });
  await assert.rejects(
    bookRecords.updateBookLastRead(db, 1, 20, 'alice', () => undefined),
    /another account/
  );
  assert.equal(db.rows('data')[0].lastBookOpen, 10);
});

test('last-read persistence accepts the current owner and never moves time backwards', async () => {
  const db = memoryDB({
    data: [{ id: 1, title: 'Book', libraryOwner: 'alice', lastBookOpen: 20 }]
  });
  const current = await bookRecords.updateBookLastRead(db, 1, 10, 'alice', () => undefined);
  assert.equal(current.lastBookOpen, 20);
  const advanced = await bookRecords.updateBookLastRead(db, 1, 30, 'alice', () => undefined);
  assert.equal(advanced.lastBookOpen, 30);
  assert.equal(db.rows('data')[0].lastBookOpen, 30);
});

test('bookmark persistence rejects a live foreign owner before touching progress', async () => {
  const db = memoryDB({
    data: [{ id: 1, title: 'Book', libraryOwner: 'bob' }],
    bookmark: [{ dataId: 1, progress: 0.25, lastBookmarkModified: 1 }]
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
    bookmark: [{ dataId: 1, progress: 0.25, lastBookmarkModified: 1 }]
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

function annotationFixture({ bookOwner, scopeOwner } = {}) {
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
  const db = memoryDB({
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
  });
  let user = { id: 'alice' };
  const api = load('reader-annotations.ts', {
    '$lib/data/store': { database: { db: Promise.resolve(db) } },
    'svelte/store': { get: (value) => value.value },
    '$lib/manabi/client': {
      account: { value: { status: 'ready' } },
      localProfileUser: () => user
    },
    '$lib/reader-location': { snapshotReaderLocator: (value) => globalThis.structuredClone(value) }
  });
  return { api, db, annotation, bookKey, setUser: (id) => (user = id ? { id } : null) };
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
    fixture.api.resolveAnnotationImportConflict('import:' + fixture.annotation.id, 'restore-archive', 'alice'),
    /another account/
  );
  assert.equal(fixture.db.rows('readerAnnotation')[0].body, undefined);
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
