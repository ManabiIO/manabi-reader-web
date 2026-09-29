import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import * as transactions from '../../apps/web/src/lib/data/database/books-db/commit-transaction.mjs';

const { commitTransaction } = transactions;

// Run complete production modules, substituting only their platform/I/O imports.
// This is component coverage, not a replacement for the built-app browser journeys.
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
const download = load('library/book-download.ts');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const original = new TextEncoder().encode('original');
const changed = new TextEncoder().encode('replaced');
const entry = () => ({
  id: 'book.txt',
  kind: 'file',
  name: 'book.txt',
  size: original.length,
  expectedContentHash: hash(original)
});
function profile() {
  let user = { id: 'alice' },
    generation = 0;
  const listeners = new Set();
  class IntegrationError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  const client = {
    IntegrationError,
    localProfileUser: () => user,
    currentUser: () => user,
    accountScope: () => ({ userId: user?.id, generation }),
    localUser: {
      subscribe(fn) {
        listeners.add(fn);
        fn(user);
        return () => listeners.delete(fn);
      }
    }
  };
  return {
    client,
    scope: load('manabi/operation-scope.ts', { './client': client }),
    change(id) {
      user = id === null ? null : { id };
      generation++;
      for (const fn of listeners) fn(user);
    },
    advanceSession() {
      generation++;
    },
    listeners
  };
}
function store(value) {
  return {
    value,
    set(next) {
      this.value = next;
    }
  };
}
function sources(owner, request, db = {}, exclusive = (_, work) => work()) {
  return load('manabi/sources.ts', {
    '$lib/library/series-metadata': {},
    './client': { ...owner.client, request },
    '../library/book-download.ts': download,
    '../data/database/books-db/commit-transaction.mjs': { commitTransaction },
    './operation-scope': owner.scope,
    './auth-contract': { maxManagedStateBytes: 4 * 1024 * 1024 },
    './persistence': { integrationDB: async () => db, exclusive }
  });
}
function cloud(owner, read) {
  const { CloudLibrary } = sources(owner, read);
  return new CloudLibrary('00000000-0000-0000-0000-000000000001', 'alice', 'root');
}
function local(owner, read, permission = async () => 'granted') {
  const library = {
    id: 'local-fixture',
    writable: false,
    handle: { queryPermission: permission, getFileHandle: async () => ({ getFile: read }) }
  };
  const db = {
    get: async (name, id) => (name === 'localLibraries' && id === library.id ? library : undefined)
  };
  const { LocalLibrarySource } = sources(owner, undefined, db);
  return new LocalLibrarySource(library);
}
function dav(owner, read) {
  const configuration = { id: 'webdav-fixture', url: 'https://example.test/', username: '' };
  class WebDavClient {
    get(...args) {
      return read(...args);
    }
  }
  const { WebDavSource } = load('webdav/source.ts', {
    '$lib/manabi/persistence': { integrationDB: async () => ({ get: async () => configuration }) },
    '$lib/manabi/operation-scope': owner.scope,
    '$lib/library/book-download': download,
    './client': {
      WebDavClient,
      davRoot: (url) => new URL(url),
      strongEtag: () => false
    }
  });
  return new WebDavSource(configuration);
}
for (const kind of ['cloud', 'local', 'webdav']) {
  function reader(owner, bytes) {
    if (kind === 'cloud') return cloud(owner, async () => bytes.buffer);
    if (kind === 'local') return local(owner, async () => new File([bytes], 'book.txt'));
    return dav(owner, async () => ({ status: 200, bytes }));
  }
  test(`${kind} metadata reads reject a same-length replacement without calling the importer`, async () => {
    const owner = profile();
    await assert.rejects(reader(owner, changed).read(entry()), /source book changed/);
    assert.equal(owner.listeners.size, 0);
  });
  test(`${kind} metadata reads preserve an unchanged copy and allow unknown preview hashes`, async () => {
    const owner = profile();
    const selected = entry();
    selected.expectedContentHash = selected.expectedContentHash.toUpperCase();
    assert.equal(await (await reader(owner, original).read(selected)).text(), 'original');
    delete selected.expectedContentHash;
    assert.equal(await (await reader(owner, changed).read(selected)).text(), 'replaced');
    assert.equal(owner.listeners.size, 0);
  });
  test(`${kind} reads reject malformed identity evidence rather than treating it as absent`, async () => {
    const owner = profile();
    await assert.rejects(
      reader(owner, original).read({ ...entry(), expectedContentHash: 'bad' }),
      /invalid content identity/
    );
    assert.equal(owner.listeners.size, 0);
  });
}
test('verification does not reread bytes when discovery supplied no hash', async () => {
  const file = {
    arrayBuffer() {
      throw new Error('not needed');
    }
  };
  assert.equal(await download.verifySelectedBook(file, undefined), file);
});
test('cloud selection fields cannot change while the response is pending', async () => {
  const owner = profile(),
    held = deferred();
  const selected = entry();
  const result = cloud(owner, () => held.promise).read(selected);
  selected.name = 'different.htmlz';
  selected.size = changed.length;
  selected.expectedContentHash = hash(changed);
  const rejected = assert.rejects(result, /source book changed/);
  held.resolve(changed.buffer);
  await rejected;
});
test('local selection cannot change during its permission query', async () => {
  const owner = profile(),
    held = deferred();
  const selected = entry();
  const result = local(
    owner,
    async () => new File([changed], 'book.txt'),
    () => held.promise
  ).read(selected);
  selected.expectedContentHash = hash(changed);
  const rejected = assert.rejects(result, /source book changed/);
  held.resolve('granted');
  await rejected;
});
test('WebDAV selection retains its hash through the download await', async () => {
  const owner = profile(),
    held = deferred();
  const selected = entry();
  const result = dav(owner, () => held.promise).read(selected);
  selected.expectedContentHash = hash(changed);
  const rejected = assert.rejects(result, /source book changed/);
  held.resolve({ status: 200, bytes: changed });
  await rejected;
});
test('a cloud source read is not restored by logging back into the same account', async () => {
  const owner = profile(),
    held = deferred();
  const result = cloud(owner, () => held.promise).read(entry());
  const rejected = assert.rejects(result, /account_changed/);
  owner.change('bob');
  owner.change('alice');
  held.resolve(original.buffer);
  await rejected;
  assert.equal(owner.listeners.size, 0);
});
test('cloud scope also checks session generation when the profile ID is unchanged', async () => {
  const owner = profile();
  const scope = owner.scope.captureLibraryOperation('alice');
  owner.advanceSession();
  assert.throws(scope.assertCurrent, /account_changed/);
  scope.stop();
  assert.equal(owner.listeners.size, 0);
});
test('local operations work without authentication but remain bound to the offline profile', () => {
  const owner = profile();
  owner.client.accountScope = () => {
    throw new Error('offline');
  };
  const scope = owner.scope.captureLibraryOperation();
  scope.assertCurrent();
  owner.change(null);
  owner.change('alice');
  assert.throws(scope.assertCurrent, /account_changed/);
  scope.stop();
});

// A controlled IDB transport: request and commit failures remain separate, and
// writes publish only at tx.done. The production command/transaction code is real.
function memoryDB(initial, options = {}) {
  const tables = new Map(
    Object.entries(initial).map(([name, rows]) => [
      name,
      new Map(rows.map((row) => [row.id ?? row.dataId, row]))
    ])
  );
  let transactions = 0;
  const copy = (name, row) => {
    if (row === undefined) return undefined;
    return name === 'localLibraries' ? { ...row } : globalThis.structuredClone(row);
  };
  const db = {
    async get(name, key) {
      return copy(name, tables.get(name)?.get(key));
    },
    transaction(names) {
      transactions++;
      const selected = typeof names === 'string' ? [names] : names;
      const working = new Map(
        selected.map((name) => [
          name,
          new Map([...tables.get(name)].map(([key, row]) => [key, copy(name, row)]))
        ])
      );
      const completion = deferred();
      let ended = false;
      const tx = {
        done: completion.promise,
        abort() {
          if (ended) return;
          ended = true;
          completion.reject(new DOMException('aborted', 'AbortError'));
        },
        objectStore(name) {
          const rows = working.get(name);
          const request = async (op, key, work) => {
            if (ended) throw new DOMException('inactive', 'TransactionInactiveError');
            options.request?.(name, op, key, tx);
            if (ended) throw new DOMException('aborted', 'AbortError');
            return work();
          };
          return {
            get: (key) => request('get', key, () => copy(name, rows.get(key))),
            getAll: () =>
              request('getAll', null, () => [...rows.values()].map((row) => copy(name, row))),
            put: (row) =>
              request('put', row.id ?? row.dataId, () =>
                rows.set(row.id ?? row.dataId, copy(name, row))
              ),
            delete: (key) => request('delete', key, () => rows.delete(key))
          };
        }
      };
      if (selected.length === 1) tx.store = tx.objectStore(selected[0]);
      setImmediate(() => {
        if (ended) return;
        ended = true;
        if (options.commitError) completion.reject(options.commitError);
        else {
          for (const [name, rows] of working) tables.set(name, rows);
          completion.resolve();
        }
      });
      return tx;
    },
    async put(name, row) {
      const tx = db.transaction(name);
      await tx.store.put(row);
      await tx.done;
    },
    rows: (name) => [...tables.get(name).values()],
    get transactions() {
      return transactions;
    }
  };
  return db;
}
function completionFixture(options = {}) {
  const owner = profile();
  const db = memoryDB(
    {
      data: [{ id: 1, libraryOwner: options.bookOwner ?? 'alice' }],
      bookmark: [{ dataId: 1, progress: 0.4, lastBookmarkModified: 50 }],
      readerBookScope: []
    },
    options
  );
  let publications = 0;
  const database = {
    db: options.open ?? Promise.resolve(db),
    bookmarksChanged$: {
      next() {
        publications++;
      }
    }
  };
  const { setCompletion } = load('library/commands.ts', {
    '$lib/data/store': { database },
    './completion': { calendarDay: () => '2026-09-28', validDay: (day) => day === '2026-09-28' },
    '$lib/manabi/operation-scope': owner.scope,
    '$lib/data/database/books-db/commit-transaction.mjs': { commitTransaction }
  });
  return {
    owner,
    db,
    setCompletion,
    get publications() {
      return publications;
    }
  };
}
test('completion rejects a cached book belonging to a different account', async () => {
  const fixture = completionFixture({ bookOwner: 'bob' });
  const before = globalThis.structuredClone(fixture.db.rows('bookmark'));
  await assert.rejects(fixture.setCompletion(1, 'finished'), /another account/);
  assert.deepEqual(fixture.db.rows('bookmark'), before);
  assert.equal(fixture.publications, 0);
  assert.equal(fixture.owner.listeners.size, 0);
});
test('completion owns the selected bookmark before asynchronous database opening', async () => {
  const held = deferred();
  const fixture = completionFixture({ open: held.promise });
  const bookmark = { dataId: 1, progress: 0.2, lastBookmarkModified: 60 };
  const operation = fixture.setCompletion(1, 'finished', '2026-09-28', bookmark);
  bookmark.dataId = 2;
  bookmark.progress = 0.9;
  held.resolve(fixture.db);
  await operation;
  assert.deepEqual(
    fixture.db.rows('bookmark').map((row) => [row.dataId, row.progress]),
    [[1, 0.2]]
  );
  assert.equal(fixture.publications, 1);
});
test('an account change before database opening cannot start a completion transaction', async () => {
  const held = deferred();
  const fixture = completionFixture({ open: held.promise });
  const rejected = assert.rejects(fixture.setCompletion(1, 'finished'), /account_changed/);
  fixture.owner.change('bob');
  fixture.owner.change('alice');
  held.resolve(fixture.db);
  await rejected;
  assert.equal(fixture.db.transactions, 0);
  assert.equal(fixture.owner.listeners.size, 0);
});
test('an account change during a completion request aborts its write', async () => {
  let fixture;
  fixture = completionFixture({
    request(name, op) {
      if (name === 'bookmark' && op === 'put') fixture.owner.change('bob');
    }
  });
  const before = globalThis.structuredClone(fixture.db.rows('bookmark'));
  await assert.rejects(fixture.setCompletion(1, 'finished'));
  assert.deepEqual(fixture.db.rows('bookmark'), before);
  assert.equal(fixture.publications, 0);
  assert.equal(fixture.owner.listeners.size, 0);
});
test('completion commit failure preserves progress and is not reported as success', async () => {
  const failure = new DOMException('full', 'QuotaExceededError');
  const fixture = completionFixture({ commitError: failure });
  await assert.rejects(fixture.setCompletion(1, 'finished'), (error) => error === failure);
  assert.equal(fixture.db.rows('bookmark')[0].completion, undefined);
  assert.equal(fixture.publications, 0);
  assert.equal(fixture.owner.listeners.size, 0);
});
test('completion still preserves position when marking an accessible book finished and reading', async () => {
  const fixture = completionFixture();
  await fixture.setCompletion(1, 'finished');
  const first = fixture.db.rows('bookmark')[0];
  assert.equal(first.progress, 0.4);
  assert.equal(first.completion.state, 'finished');
  await fixture.setCompletion(1, 'reading');
  const second = fixture.db.rows('bookmark')[0];
  assert.equal(second.progress, 0.4);
  assert.equal(second.completion.state, 'reading');
  assert.ok(second.completion.modifiedAt > first.completion.modifiedAt);
  assert.equal(fixture.owner.listeners.size, 0);
});
function permissionFixture(current, options = {}) {
  const grant = deferred();
  const library = {
    id: 'local-fixture',
    name: 'Old name',
    writable: false,
    handle: { requestPermission: () => grant.promise }
  };
  const db = memoryDB(
    {
      localLibraries: [{ ...library, ...current }],
      books: [
        { id: 'our-link', sourceId: library.id },
        { id: 'other-link', sourceId: 'other' }
      ]
    },
    options
  );
  return { library, db, grant, api: sources(profile(), undefined, db) };
}
test('a late permission grant cannot resurrect a disconnected source', async () => {
  const fixture = permissionFixture();
  const operation = fixture.api.reconnectLocalLibrary(fixture.library, true);
  const rejected = assert.rejects(operation, /not_found/);
  await fixture.api.removeLocalLibrary(fixture.library.id);
  fixture.grant.resolve('granted');
  await rejected;
  assert.deepEqual(fixture.db.rows('localLibraries'), []);
  assert.deepEqual(
    fixture.db.rows('books').map((row) => row.id),
    ['other-link']
  );
  assert.equal(fixture.library.writable, false);
});
test('a stale read-only reconnect preserves newer name and write consent', async () => {
  const fixture = permissionFixture({ name: 'New name', writable: true });
  const operation = fixture.api.reconnectLocalLibrary(fixture.library);
  fixture.grant.resolve('granted');
  await operation;
  assert.equal(fixture.db.rows('localLibraries')[0].name, 'New name');
  assert.equal(fixture.db.rows('localLibraries')[0].writable, true);
  assert.equal(fixture.library.writable, true);
});

test('a permission grant cannot transfer to a different directory handle reusing the source ID', async () => {
  const replacementHandle = {
    requestPermission: async () => 'granted',
    queryPermission: async () => 'granted',
    isSameEntry: async () => false
  };
  const fixture = permissionFixture({ handle: replacementHandle });
  fixture.library.handle.isSameEntry = async () => false;
  const rejected = assert.rejects(
    fixture.api.reconnectLocalLibrary(fixture.library, true),
    /not_found/
  );
  fixture.grant.resolve('granted');
  await rejected;
  assert.equal(fixture.db.rows('localLibraries')[0].handle, replacementHandle);
  assert.equal(fixture.db.rows('localLibraries')[0].writable, false);
  assert.equal(fixture.library.writable, false);
});
test('failed permission persistence does not authorize the caller snapshot', async () => {
  const failure = new DOMException('full', 'QuotaExceededError');
  const fixture = permissionFixture({}, { commitError: failure });
  const rejected = assert.rejects(
    fixture.api.reconnectLocalLibrary(fixture.library, true),
    (error) => error === failure
  );
  fixture.grant.resolve('granted');
  await rejected;
  assert.equal(fixture.library.writable, false);
  assert.equal(fixture.db.rows('localLibraries')[0].writable, false);
});
test('permission denial leaves the source and caller unchanged without starting storage', async () => {
  const fixture = permissionFixture();
  const rejected = assert.rejects(
    fixture.api.reconnectLocalLibrary(fixture.library, true),
    /permission_required/
  );
  fixture.grant.resolve('denied');
  await rejected;
  assert.equal(fixture.db.transactions, 0);
  assert.equal(fixture.library.writable, false);
});

function serializedExclusive() {
  const tails = new Map();
  return async (name, work) => {
    const previous = tails.get(name) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    tails.set(name, run);
    try {
      return await run;
    } finally {
      if (tails.get(name) === run) tails.delete(name);
    }
  };
}

test('a retained local source object cannot read after its integration row is disconnected', async () => {
  const owner = profile();
  let fileReads = 0;
  const library = {
    id: 'local-retained',
    name: 'Folder',
    writable: false,
    handle: {
      queryPermission: async () => 'granted',
      getFileHandle: async () => ({
        getFile: async () => {
          fileReads++;
          return new File([original], 'book.txt');
        }
      })
    }
  };
  const db = memoryDB({ localLibraries: [library], books: [] });
  const api = sources(owner, undefined, db);
  const source = new api.LocalLibrarySource(library);
  await api.removeLocalLibrary(library.id);
  await assert.rejects(source.read(entry()), /not_found/);
  assert.equal(fileReads, 0);
});

test('disconnect waits for an admitted local read and prevents later retained-handle reads', async () => {
  const owner = profile();
  const held = deferred();
  const library = {
    id: 'local-serialized',
    name: 'Folder',
    writable: false,
    handle: {
      queryPermission: async () => 'granted',
      getFileHandle: async () => ({
        getFile: () => held.promise
      })
    }
  };
  const db = memoryDB({ localLibraries: [library], books: [] });
  const api = sources(owner, undefined, db, serializedExclusive());
  const source = new api.LocalLibrarySource(library);
  const reading = source.read(entry());
  await new Promise((resolve) => setImmediate(resolve));
  const removing = api.removeLocalLibrary(library.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    db.rows('localLibraries').length,
    1,
    'disconnect must wait for admitted source work'
  );
  held.resolve(new File([original], 'book.txt'));
  assert.equal(await (await reading).text(), 'original');
  await removing;
  assert.equal(db.rows('localLibraries').length, 0);
  await assert.rejects(source.read(entry()), /not_found/);
});

const accountVisibility = load('library/account-visibility.ts');

function linkFixture(records, links) {
  const owner = profile();
  let migrated;
  const api = load('manabi/books.ts', {
    '$lib/webdav/source': {},
    '$lib/webdav/sync': {},
    'svelte/store': { writable: store },
    '$lib/data/store': { database: { db: Promise.resolve({}) } },
    '$lib/library/organization': {
      stabilizeOrganization: async (all) => {
        migrated = all;
      }
    },
    '$lib/library/account-visibility': accountVisibility,
    '$lib/data/storage/storage-types': {},
    '$lib/data/storage/storage-view': {},
    '$lib/data/storage/storage-handler-factory': {},
    '$lib/data/database/books-db/book-binary': {},
    '$lib/data/database/books-db/commit-transaction.mjs': { commitTransaction },
    '$lib/data/database/books-db/library-import': {
      readIndexedBookIdentities: async () => records
    },
    '$lib/library/book-identity': {
      normalizedContentHash: (value) =>
        typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined
    },
    '$lib/functions/file-loaders/epub/load-epub': {},
    '$lib/functions/file-loaders/txt/load-txt': {},
    '$lib/functions/file-loaders/htmlz/load-htmlz': {},
    './client': owner.client,
    './persistence': { integrationDB: async () => ({ getAll: async () => links }) },
    './operation-scope': owner.scope,
    './sources': {},
    './personal-sync': {}
  });
  return {
    api,
    get migrated() {
      return migrated;
    }
  };
}
test('refresh excludes stale content claims from usable links without erasing their evidence', async () => {
  const digest = hash(original);
  const valid = { id: 'good', bookId: 1, owner: 'alice', contentHash: digest };
  const stale = { ...valid, id: '0000-stale', contentHash: hash(changed) };
  const fixture = linkFixture(
    [{ id: 1, contentHash: digest, libraryOwner: 'alice' }],
    [stale, valid]
  );
  await fixture.api.refreshLinkedBooks();
  assert.deepEqual(fixture.api.linkedBooks.value, [valid]);
  assert.deepEqual(fixture.api.allLinkedBooks.value, [stale, valid]);
  assert.deepEqual(fixture.migrated, [stale, valid], 'migration must still see conflicting claims');
});
test('refresh excludes removed records, invalid hashes and inconsistent ownership', async () => {
  const digest = hash(original);
  const fixture = linkFixture(
    [{ id: 1, contentHash: digest, libraryOwner: 'bob' }, { id: 2 }],
    [
      { id: 'wrong-owner', bookId: 1, owner: 'alice', contentHash: digest },
      { id: 'hashless', bookId: 2, owner: null },
      { id: 'deleted', bookId: 3, owner: 'alice', contentHash: digest }
    ]
  );
  await fixture.api.refreshLinkedBooks();
  assert.deepEqual(fixture.api.linkedBooks.value, []);
  assert.equal(fixture.api.allLinkedBooks.value.length, 3);
});
test('refresh keeps legacy multi-account links historical but unusable', async () => {
  const digest = hash(original);
  const links = [
    { id: 'alice', bookId: 1, owner: 'alice', contentHash: digest },
    { id: 'bob', bookId: 1, owner: 'bob', contentHash: digest }
  ];
  const fixture = linkFixture([{ id: 1, contentHash: digest }], links);
  await fixture.api.refreshLinkedBooks();
  assert.deepEqual(fixture.api.linkedBooks.value, []);
  assert.deepEqual(fixture.api.allLinkedBooks.value, links);
  assert.deepEqual(fixture.migrated, []);
});

test('refresh retains all valid copies and their per-link sync choices', async () => {
  const digest = hash(original);
  const links = [
    { id: 'copy-a', bookId: 1, owner: null, contentHash: digest.toUpperCase(), syncEnabled: true },
    { id: 'copy-b', bookId: 1, owner: null, contentHash: digest, syncEnabled: false }
  ];
  const fixture = linkFixture([{ id: 1, contentHash: digest }], links);
  await fixture.api.refreshLinkedBooks();
  assert.deepEqual(fixture.api.linkedBooks.value, links);
});
