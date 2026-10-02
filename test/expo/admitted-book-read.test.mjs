/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';
import * as transactions from '../../apps/web/src/lib/data/database/books-db/commit-transaction.mjs';

// Load production modules, with unrelated UI/constructor dependencies failing
// on use. All book reads, binary decoding and transaction semantics are real.
function load(name, dependencies = {}) {
  const source = readFileSync(
    new URL(`../../apps/web/src/lib/data/database/books-db/${name}.ts`, import.meta.url),
    'utf8'
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: `${name}.ts`,
    reportDiagnostics: true
  });
  assert.equal(compiled.diagnostics.length, 0);
  const module = { exports: {} };
  compileFunction(compiled.outputText, ['require', 'module', 'exports'])(
    (dependency) => {
      if (Object.hasOwn(dependencies, dependency)) return dependencies[dependency];
      return new Proxy(
        {},
        {
          get(_target, property) {
            if (property === '__esModule') return false;
            throw new Error(`Unexpected dependency use: ${dependency}.${String(property)}`);
          }
        }
      );
    },
    module,
    module.exports
  );
  return module.exports;
}
const identity = load('book-identity');
const binary = load('book-binary');
const records = load('book-records');
const admittedRead = load('admitted-book-read', {
  './book-identity': identity,
  './book-records': records,
  './commit-transaction.mjs': transactions
});
const { DatabaseService } = load('database.service', {
  './book-identity': identity,
  './book-binary': binary,
  './admitted-book-read': admittedRead
});
const uuid = '12345678-1234-4234-8234-123456789abc';
const replacementUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const hash = 'ab'.repeat(32);
const row = (contentHash) => ({
  id: 1,
  title: 'Selected legacy book',
  lastBookModified: 42,
  contentHash,
  elementHtml: '<p>The admitted original text</p>',
  blobs: {
    'image.png': {
      format: 'reader-bytes-v1',
      type: 'image/png',
      bytes: new Uint8Array([1, 2, 3]).buffer
    }
  }
});
const expected = (contentHash) => ({
  bookId: 1,
  title: 'Selected legacy book',
  lastBookModified: 42,
  contentHash,
  readerBookKey: `local:${uuid}`
});
function deferred() {
  let resolve;
  const promise = new Promise((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}
async function fixture(t, contentHash) {
  const name = `admitted-book-read-${crypto.randomUUID()}`;
  const db = await openDB(name, 1, {
    upgrade(database) {
      database.createObjectStore('data', { keyPath: 'id' });
      database.createObjectStore('readerBookScope', { keyPath: 'bookId' });
      database.createObjectStore('readerLocalIdentity', { keyPath: 'bookId' });
    }
  });
  const second = await openDB(name, 1);
  t.after(async () => {
    db.close();
    second.close();
    await deleteDB(name);
  });
  await db.put('data', row(contentHash));
  await db.put('readerLocalIdentity', { bookId: 1, uuid });
  const service = Object.create(DatabaseService.prototype);
  service.db = Promise.resolve(db);
  const controller = new AbortController();
  const authority = {
    signal: controller.signal,
    profileId: 'alice',
    assertCurrent() {
      controller.signal.throwIfAborted();
    }
  };
  return {
    db,
    second,
    service,
    controller,
    authority,
    read: (snapshot = expected(contentHash), scope = authority) =>
      service.getAdmittedData(1, snapshot, scope)
  };
}
function onFinalRequest(t, callback) {
  const original = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (...args) {
    const request = original.apply(this, args);
    if (this.name === 'readerLocalIdentity')
      request.addEventListener('success', () => callback(this.transaction), { once: true });
    return request;
  };
  t.after(() => {
    IDBObjectStore.prototype.get = original;
  });
}

test('same ID/title/hash/mtime with a different legacy UUID is rejected', async (t) => {
  const f = await fixture(t);
  // A second connection replaces bytes and UUID but reuses the entire old tuple.
  const replacement = f.second.transaction(['data', 'readerLocalIdentity'], 'readwrite');
  const replacing = Promise.all([
    replacement.objectStore('data').put({ ...row(), elementHtml: '<p>Wrong replacement text</p>' }),
    replacement.objectStore('readerLocalIdentity').put({ bookId: 1, uuid: replacementUuid }),
    replacement.done
  ]);
  const reading = f.read();
  await replacing;
  await assert.rejects(reading, /book changed/);
  assert.equal((await f.db.get('readerLocalIdentity', 1)).uuid, replacementUuid);
});

test('same canonical legacy identity reads and decodes the exact admitted record in one readonly transaction', async (t) => {
  const f = await fixture(t);
  const observed = [];
  const original = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (...args) {
    observed.push({ store: this.name, tx: this.transaction });
    return original.apply(this, args);
  };
  t.after(() => {
    IDBObjectStore.prototype.get = original;
  });
  const result = await f.read();
  assert.equal(result.elementHtml, row().elementHtml);
  assert.ok(result.blobs['image.png'] instanceof Blob);
  assert.deepEqual([...new Uint8Array(await result.blobs['image.png'].arrayBuffer())], [1, 2, 3]);
  assert.deepEqual(
    observed.map(({ store }) => store),
    ['data', 'readerBookScope', 'readerLocalIdentity']
  );
  assert.equal(new Set(observed.map(({ tx }) => tx)).size, 1);
  assert.equal(observed[0].tx.mode, 'readonly');
  assert.deepEqual(
    [...observed[0].tx.objectStoreNames],
    ['data', 'readerBookScope', 'readerLocalIdentity']
  );
});

test('the service returns admitted bytes rather than reading an unchecked replacement after commit', async (t) => {
  const f = await fixture(t);
  let replacing;
  onFinalRequest(t, () => {
    replacing = f.second.put('data', { ...row(), elementHtml: '<p>Later replacement</p>' });
  });
  const result = await f.read();
  await replacing;
  assert.equal(result.elementHtml, row().elementHtml);
  assert.equal((await f.db.get('data', 1)).elementHtml, '<p>Later replacement</p>');
});

test('missing legacy identity fails closed without manufacturing or writing a UUID', async (t) => {
  const f = await fixture(t);
  await f.db.delete('readerLocalIdentity', 1);
  await assert.rejects(f.read(), /book changed/);
  assert.equal(await f.db.get('readerLocalIdentity', 1), undefined);
});

for (const source of ['libraryOwner', 'readerBookScope'])
  test(`foreign ${source} queued by another connection is rejected in the admitted read`, async (t) => {
    const f = await fixture(t);
    const writing =
      source === 'libraryOwner'
        ? f.second.put('data', { ...row(), libraryOwner: 'bob' })
        : f.second.put('readerBookScope', { bookId: 1, accountId: 'bob' });
    const reading = f.read();
    await writing;
    await assert.rejects(reading, /another account/);
  });

for (const reason of ['account ABA', 'reader lifetime', 'native authority'])
  test(`${reason} revocation during the final identity request cannot publish a book`, async (t) => {
    const f = await fixture(t);
    const revocation = new AbortController();
    const authority = {
      ...f.authority,
      signal: AbortSignal.any([f.controller.signal, revocation.signal])
    };
    onFinalRequest(t, () => revocation.abort(new Error(reason)));
    await assert.rejects(f.read(expected(), authority));
    assert.equal((await f.db.get('data', 1)).elementHtml, row().elementHtml);
  });

for (const reason of ['profile changed', 'newer reader generation'])
  test(`assertCurrent catches ${reason} during the final request even without an abort event`, async (t) => {
    const f = await fixture(t);
    let current = true;
    onFinalRequest(t, () => {
      current = false;
    });
    await assert.rejects(
      f.read(expected(), {
        ...f.authority,
        assertCurrent() {
          if (!current) throw new Error(reason);
        }
      }),
      new RegExp(reason)
    );
  });

test('a native abort after the final successful request is drained and never returns bytes', async (t) => {
  const f = await fixture(t);
  onFinalRequest(t, (tx) => tx.abort());
  await assert.rejects(f.read(), { name: 'AbortError' });
});

test('revocation at transaction completion still prevents publication', async (t) => {
  const f = await fixture(t);
  onFinalRequest(t, (tx) => {
    tx.addEventListener('complete', () => f.controller.abort(), { once: true });
  });
  await assert.rejects(f.read());
});

for (const [storedHash, expectedHash] of [
  [hash.toUpperCase(), hash],
  [hash, hash.toUpperCase()]
])
  test(`valid content hashes normalize lowercase from ${storedHash === hash ? 'expected' : 'stored'} identity`, async (t) => {
    const f = await fixture(t, storedHash);
    await f.db.delete('readerLocalIdentity', 1);
    const snapshot = { ...expected(expectedHash), readerBookKey: `content:${hash}` };
    const result = await f.read(snapshot);
    assert.equal(result.elementHtml, row().elementHtml);
    assert.equal(identity.snapshotBookAccessIdentity(snapshot).contentHash, hash);
    assert.equal(await f.db.get('readerLocalIdentity', 1), undefined);
  });

test('legacy invalid hashes keep their exact tuple spelling while using the stored local key', async (t) => {
  const f = await fixture(t, 'legacy-hash');
  assert.equal((await f.read()).elementHtml, row().elementHtml);
  await assert.rejects(f.read(expected('LEGACY-HASH')), /book changed/);
});

test('caller mutation while the database opens cannot replace canonical admission', async (t) => {
  const f = await fixture(t);
  const opening = deferred();
  f.service.db = opening.promise;
  const snapshot = expected();
  const reading = f.read(snapshot);
  await f.second.put('readerLocalIdentity', { bookId: 1, uuid: replacementUuid });
  snapshot.readerBookKey = `local:${replacementUuid}`;
  opening.resolve(f.db);
  await assert.rejects(reading, /book changed/);
});

test('the direct transaction helper snapshots canonical admission before its first request', async (t) => {
  const f = await fixture(t);
  const snapshot = expected();
  const reading = admittedRead.readAdmittedBook(f.db, snapshot, f.authority);
  snapshot.readerBookKey = `local:${replacementUuid}`;
  snapshot.title = 'Mutated caller';
  assert.equal((await reading).elementHtml, row().elementHtml);
});

test('identity snapshots freeze canonical fields and reject malformed or inconsistent keys', () => {
  const snapshot = identity.snapshotBookAccessIdentity(expected());
  assert.ok(Object.isFrozen(snapshot));
  assert.throws(() => {
    snapshot.readerBookKey = `local:${replacementUuid}`;
  }, TypeError);
  for (const readerBookKey of [
    '',
    'local:',
    'local:undefined',
    1,
    {},
    `content:${hash.toUpperCase()}`,
    `content:${hash}`
  ])
    assert.throws(
      () => identity.snapshotBookAccessIdentity({ ...expected(), readerBookKey }),
      /identity is invalid/
    );
  assert.throws(
    () =>
      identity.snapshotBookAccessIdentity({ ...expected(hash), readerBookKey: `local:${uuid}` }),
    /identity is invalid/
  );
  assert.throws(
    () =>
      identity.snapshotBookAccessIdentity({
        ...expected(hash),
        readerBookKey: `content:${'c'.repeat(64)}`
      }),
    /identity is invalid/
  );
});

test('a mismatched route ID fails before opening the database', async (t) => {
  const f = await fixture(t);
  let opened = false;
  f.service.db = {
    then() {
      opened = true;
      throw new Error('Must not open');
    }
  };
  await assert.rejects(f.service.getAdmittedData(2, expected(), f.authority), /selection changed/);
  assert.equal(opened, false);
});

test('legacy tuple admissions without a canonical key retain their read contract', async (t) => {
  const f = await fixture(t);
  await f.db.delete('readerLocalIdentity', 1);
  const snapshot = expected();
  delete snapshot.readerBookKey;
  assert.equal((await f.read(snapshot)).elementHtml, row().elementHtml);
});
