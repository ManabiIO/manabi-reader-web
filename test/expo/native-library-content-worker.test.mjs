/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';

// Real existing module worker + existing IndexedDB schema, with only the worker host replaced.
const { outputFiles } = await build({
  entryPoints: ['apps/web/src/lib/library/library-content-search-worker.ts'],
  bundle: true,
  format: 'iife',
  write: false,
  tsconfig: 'apps/web/tsconfig.json'
});
function worker() {
  const messages = [],
    waiting = new Map();
  const self = {
    onmessage: undefined,
    postMessage(message) {
      messages.push(structuredClone(message));
      if (message.type === 'done' || message.type === 'error')
        waiting.get(message.requestId)?.(message);
    }
  };
  const idb = Object.fromEntries(
    [
      'indexedDB',
      'IDBKeyRange',
      'IDBRequest',
      'IDBDatabase',
      'IDBTransaction',
      'IDBObjectStore',
      'IDBIndex',
      'IDBCursor',
      'IDBCursorWithValue'
    ].map((name) => [name, globalThis[name]])
  );
  runInNewContext(outputFiles[0].text, {
    ...idb,
    self,
    Intl,
    setTimeout,
    TextEncoder,
    crypto: webcrypto
  });
  return {
    messages,
    send: (data) => self.onmessage({ data }),
    search(requestId, books, query = '本', owner = 'synthetic-profile') {
      const done = new Promise((resolve) => waiting.set(requestId, resolve));
      self.onmessage({ data: { type: 'search', requestId, books, query, owner } });
      return done;
    }
  };
}
async function database(t) {
  await deleteDB('books');
  const db = await openDB('books', 1, {
    upgrade(db) {
      db.createObjectStore('data', { keyPath: 'id' });
      for (const name of ['readerBookScope', 'readerLocalIdentity', 'readerSearchProjection'])
        db.createObjectStore(name, { keyPath: 'bookId' });
    }
  });
  t.after(async () => {
    db.close();
    await deleteDB('books');
  });
  return db;
}
const hash = 'a'.repeat(64);
const source = (id, extra = {}) => ({
  id,
  title: `Fixture ${id}`,
  contentHash: hash,
  elementHtml: '<section><p>私は本を読む 😀 ＡＢＣ</p></section>',
  ...extra
});
const descriptor = (id, key = `content:${hash}`) => ({ id, key });
const hits = (search) =>
  search.messages.filter((message) => message.type === 'batch').flatMap((message) => message.hits);

test('native passage worker reuses exact ownership, content and local UUID gates at its actual database read', async (t) => {
  const db = await database(t);
  for (let id = 1; id <= 5; id++) await db.put('data', source(id));
  await db.put('readerBookScope', { bookId: 1, accountId: 'synthetic-profile' });
  await db.put('readerBookScope', { bookId: 2, accountId: 'different-profile' });
  await db.put('data', source(3, { libraryOwner: 'different-profile' }));
  await db.put('data', source(4, { contentHash: 'b'.repeat(64) }));
  await db.put('data', source(5, { contentHash: undefined }));
  await db.put('readerLocalIdentity', { bookId: 5, uuid: 'synthetic-legacy-key' });
  await db.put('data', source(6, { contentHash: undefined }));
  await db.put('readerLocalIdentity', { bookId: 6, uuid: 'replacement-local-key' });
  const search = worker();
  const done = await search.search(1, [
    descriptor(1),
    descriptor(2),
    descriptor(3),
    descriptor(4),
    descriptor(5, 'local:synthetic-legacy-key'),
    descriptor(6, 'local:previous-local-key')
  ]);
  assert.equal(done.type, 'done');
  assert.deepEqual(
    hits(search).map((hit) => hit.bookId),
    [1, 5]
  );
  assert.equal(hits(search)[1].locator.bookKey, 'local:synthetic-legacy-key');
  assert.equal(hits(search)[0].locator.quote, '本');
  const projection = await db.get('readerSearchProjection', 1);
  assert.ok(projection.source && projection.digest && projection.resources.length);
});

test('shared cached projection is integrity checked and rebuilt without a second database', async (t) => {
  const db = await database(t);
  await db.put('data', source(1));
  const initial = worker();
  await initial.search(1, [descriptor(1)]);
  const projection = await db.get('readerSearchProjection', 1);
  projection.resources[0].text = 'forged private text';
  await db.put('readerSearchProjection', projection);
  const repaired = worker();
  await repaired.search(2, [descriptor(1)], 'abc');
  assert.equal(hits(repaired)[0].locator.quote, 'ＡＢＣ');
  assert.ok(!(await db.get('readerSearchProjection', 1)).resources[0].text.includes('forged'));
  assert.equal((await indexedDB.databases()).length, 1);
});

test('worker cancellation interrupts a long query and never publishes its stale hits', async (t) => {
  const db = await database(t);
  await db.put('data', source(1, { elementHtml: `<section>${'x'.repeat(100000)}本</section>` }));
  await db.put('data', source(2));
  const search = worker();
  void search.search(1, [descriptor(1)]);
  search.send({ type: 'cancel', requestId: 2 });
  const done = await search.search(3, [descriptor(2)]);
  await delay(10);
  assert.equal(done.type, 'done');
  assert.deepEqual(
    hits(search).map((hit) => hit.bookId),
    [2]
  );
  assert.ok(search.messages.every((message) => message.requestId === 3));
});
