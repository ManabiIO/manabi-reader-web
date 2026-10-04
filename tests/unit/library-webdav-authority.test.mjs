import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import * as transactions from '../../apps/web/src/lib/data/database/books-db/commit-transaction.mjs';

const clone = (value) => globalThis.structuredClone(value);
const range = { bound: (lower, upper) => ({ lower, upper }) };
function load(file, imports = {}) {
  const url = new URL('../../apps/web/src/lib/' + file, import.meta.url);
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(url, 'utf8'), {
    fileName: url.pathname,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  compileFunction(outputText, ['require', 'module', 'exports', 'IDBKeyRange'])(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name);
      return imports[name];
    },
    module,
    module.exports,
    range
  );
  return module.exports;
}
const persistence = load('manabi/persistence.ts', {
  idb: {},
  '$lib/data/database/books-db/commit-transaction.mjs': transactions,
  '../snippets/summary': {
    summarize: () => {
      throw new Error('Snippet summaries are outside the WebDAV book fixture.');
    }
  }
});
const statistics = load('data/database/books-db/reader-statistics.ts', {
  './commit-transaction.mjs': transactions,
  './content-hash-index.ts': load('data/database/books-db/content-hash-index.ts')
});
function writable(value) {
  const listeners = new Set();
  return {
    value,
    listeners,
    subscribe(fn) {
      listeners.add(fn);
      fn(this.value);
      return () => listeners.delete(fn);
    },
    set(next) {
      this.value = next;
      for (const fn of listeners) fn(next);
    },
    update(fn) {
      this.set(fn(this.value));
    }
  };
}
function profile(initial = 'alice', authenticated = initial) {
  let auth = authenticated,
    generation = 0;
  const localUser = writable(initial === null ? null : { id: initial });
  class IntegrationError extends Error {}
  const client = {
    IntegrationError,
    currentUser: () => (auth === null ? null : { id: auth }),
    localProfileUser: () => localUser.value,
    localUser,
    accountScope: () => {
      if (auth === null) throw new IntegrationError('sign_in_required');
      return { userId: auth, generation };
    }
  };
  return {
    client,
    operation: load('manabi/operation-scope.ts', { './client': client }),
    change(id) {
      auth = id;
      generation++;
      localUser.set(id === null ? null : { id });
    },
    advanceSession() {
      generation++;
    }
  };
}
const keyOf = (name, value) => {
  if (name === 'bookmark') return value.dataId;
  if (name === 'readerBookScope' || name === 'readerLocalIdentity') return value.bookId;
  if (name === 'readerAnnotationScope') return value.annotationId;
  if (name === 'readerStatistic') return [value.bookKey, value.dateKey];
  if (name === 'statistic') return [value.title, value.dateKey];
  if (name === 'readerStatisticMigration') return value.title;
  if (name === 'lastModified') return [value.title, value.dataType];
  return value.id;
};
const encoded = (key) => JSON.stringify(key);
const inRange = (key, query) =>
  query === undefined ||
  (query && typeof query === 'object' && 'lower' in query
    ? Array.isArray(key) && key[0] === query.lower[0]
    : encoded(key) === encoded(query));

// Controlled IDB transport with independent request/commit failure and rollback.
// The sync, account scope, merge and statistics migration are production code;
// native IDB scheduling and real HTTP are covered separately in browser CI.
function memoryDB(initial = {}) {
  const saved = new Map();
  const api = {
    beforeTransaction: undefined,
    onRequest: undefined,
    beforeCommit: undefined,
    seed(name, row, key = keyOf(name, row)) {
      if (!saved.has(name)) saved.set(name, new Map());
      saved.get(name).set(encoded(key), clone(row));
    },
    rows: (name) => clone([...(saved.get(name)?.values() ?? [])]),
    async get(name, key) {
      return clone(saved.get(name)?.get(encoded(key)));
    },
    async getAll(name) {
      return this.rows(name);
    },
    transaction(names) {
      names = typeof names === 'string' ? [names] : names;
      api.beforeTransaction?.(names);
      const draft = new Map(names.map((name) => [name, clone(saved.get(name) ?? new Map())]));
      const dirty = new Set();
      let state = 'active',
        pending = 0,
        resolve,
        reject;
      const done = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const tx = {
        names,
        dirty,
        done,
        abort() {
          if (state !== 'active') throw new Error('Transaction is settled.');
          state = 'aborted';
          reject(new Error('Transaction aborted.'));
        },
        objectStore(name) {
          assert.ok(draft.has(name), 'Store absent from transaction: ' + name);
          const rows = draft.get(name);
          const request = async (verb, key, work, value) => {
            pending++;
            try {
              await Promise.resolve();
              if (state !== 'active') throw new Error('Inactive transaction.');
              const result = work();
              api.onRequest?.({ name, verb, key, value, tx });
              if (state !== 'active') throw new Error('Transaction aborted.');
              return clone(result);
            } finally {
              pending--;
              settle();
            }
          };
          const all = (query) =>
            [...rows].filter(([key]) => inRange(JSON.parse(key), query)).map(([, value]) => value);
          return {
            get: (key) => request('get', key, () => rows.get(encoded(key))),
            getAll: (query) => request('getAll', query, () => all(query)),
            put: (row, key = keyOf(name, row)) =>
              request(
                'put',
                key,
                () => {
                  dirty.add(name);
                  rows.set(encoded(key), clone(row));
                  return key;
                },
                row
              ),
            delete: (key) =>
              request('delete', key, () => {
                dirty.add(name);
                rows.delete(encoded(key));
              }),
            index: (field) => {
              const entries = [...rows.values()]
                .filter((row) => row[field] !== undefined)
                .map((row) => ({ key: row[field], primaryKey: keyOf(name, row) }));
              const cursor = async (position) => {
                const entry = await request('index-key-cursor', field, () => entries[position]);
                return entry ? { ...entry, continue: () => cursor(position + 1) } : null;
              };
              return {
                getAll: (value) =>
                  request('index', value, () =>
                    [...rows.values()].filter((row) => row[field] === value)
                  ),
                openKeyCursor: () => cursor(0)
              };
            },
            async openCursor() {
              const values = await request('cursor', undefined, () => [...rows.values()]);
              const cursor = (index) =>
                index < values.length
                  ? { value: values[index], continue: async () => cursor(index + 1) }
                  : null;
              return cursor(0);
            }
          };
        }
      };
      function settle() {
        setImmediate(() => {
          if (pending || state !== 'active') return;
          try {
            api.beforeCommit?.(tx);
            if (state !== 'active') return;
            for (const name of dirty) saved.set(name, draft.get(name));
            state = 'committed';
            resolve();
          } catch (error) {
            state = 'aborted';
            reject(error);
          }
        });
      }
      settle();
      return tx;
    }
  };
  for (const [name, rows] of Object.entries(initial)) for (const row of rows) api.seed(name, row);
  return api;
}
const hash = 'a'.repeat(64);
const book = (changes = {}) => ({ id: 1, title: 'Book', contentHash: hash, ...changes });
const link = (changes = {}) => ({
  id: 'dav-link',
  sourceId: 'webdav-fixture',
  owner: null,
  root: 'https://dav.test/Books/',
  fileId: 'https://dav.test/Books/Book.epub',
  name: 'Book.epub',
  contentHash: hash,
  bookId: 1,
  title: 'Book',
  syncEnabled: true,
  davAccountId: 'alice',
  ...changes
});
function fixture(options = {}) {
  const profileId = options.profile === undefined ? 'alice' : options.profile;
  const owner = profile(profileId, options.auth === undefined ? profileId : options.auth);
  const db = memoryDB({
    data: [book(options.book)],
    bookmark: [{ dataId: 1, progress: 0.2, lastBookmarkModified: 10 }]
  });
  const integration = memoryDB({ books: [link(options.link)] });
  const configuration = { id: 'webdav-fixture', writable: true };
  integration.seed('metadata', configuration, 'webdav-source:webdav-fixture');
  const calls = { reads: 0, uploads: [], migrations: 0, notifications: 0 };
  const hooks = {};
  const source = {
    root: link().root,
    configuration,
    async state() {
      calls.reads++;
      await hooks.remote?.();
      return { value: clone(hooks.remoteValue ?? null), revision: 'missing' };
    },
    async write(key, value) {
      calls.uploads.push(clone({ key, value }));
      await hooks.upload?.();
      return { value, revision: 'next' };
    }
  };
  class DavError extends Error {}
  const sync = load('webdav/sync.ts', {
    '$lib/state/store': { writable, get: (store) => store.value },
    '$lib/data/store': {
      database: {
        db: Promise.resolve(db),
        bookmarksChanged$: { next: () => calls.notifications++ },
        dataListChanged$: { next: () => calls.notifications++ }
      }
    },
    '$lib/data/database/books-db/reader-statistics': {
      ...statistics,
      async migrateLegacyStatistics(...args) {
        calls.migrations++;
        return statistics.migrateLegacyStatistics(...args);
      }
    },
    '$lib/data/database/books-db/commit-transaction.mjs': transactions,
    '$lib/manabi/client': owner.client,
    '$lib/manabi/operation-scope': owner.operation,
    '$lib/manabi/imported-notes': { unlocatedImportRecord: (row) => row },
    '$lib/manabi/persistence': {
      ...persistence,
      integrationDB: async () => integration,
      exclusive: async (_, work) => {
        await hooks.admission?.();
        return work();
      }
    },
    './sync-codec': {
      documentFor: (bookKey, records) => ({ bookKey, records }),
      wireCopy: clone,
      validateDavDocument: clone
    },
    './source': {
      davSource: async () => source,
      withDavSourceLock: async (_, work) => {
        await hooks.sourceLock?.();
        return work();
      }
    },
    './reader-lock': {
      withWebDavApplyLease: async (work) => {
        await hooks.readerLease?.();
        return work();
      }
    },
    './client': { DavError }
  });
  return {
    owner,
    db,
    integration,
    calls,
    hooks,
    sync,
    status: () => sync.davSyncStatus.value['dav-link'],
    async run() {
      await sync.syncDavBook('dav-link');
    },
    unchanged(before) {
      assert.deepEqual(db.rows('bookmark'), before);
      assert.deepEqual(db.rows('readerExternalSync'), []);
      assert.equal(calls.notifications, 0);
      assert.equal(owner.client.localUser.listeners.size, 0);
    }
  };
}

for (const field of ['libraryOwner', 'readerBookScope']) {
  test(`WebDAV rejects foreign ${field} before consent and personal-state access`, async () => {
    const f = fixture(field === 'libraryOwner' ? { book: { libraryOwner: 'bob' } } : {});
    if (field === 'readerBookScope') f.db.seed(field, { bookId: 1, accountId: 'bob' });
    const before = f.db.rows('bookmark');
    await assert.rejects(f.sync.setDavBookSync('dav-link', true), /active account|another account/);
    await f.run();
    assert.equal(f.status().state, 'error');
    assert.equal(f.calls.reads, 0);
    assert.equal(f.calls.migrations, 0);
    assert.equal(f.calls.uploads.length, 0);
    f.unchanged(before);
  });
}
for (const changes of [{ contentHash: 'b'.repeat(64) }, { id: 2 }]) {
  test(`invalid book cannot enable sync: ${JSON.stringify(changes)}`, async () => {
    const f = fixture({ book: changes });
    await assert.rejects(f.sync.setDavBookSync('dav-link', true));
    await f.run();
    assert.equal(f.calls.migrations, 0);
    assert.equal(f.calls.reads, 0);
    assert.equal(f.calls.uploads.length, 0);
  });
}
for (const scope of ['libraryOwner', 'readerBookScope']) {
  test(`a foreign same-byte sibling blocks shared content-state access (${scope})`, async () => {
    const f = fixture();
    f.db.seed(
      'data',
      book({ id: 2, ...(scope === 'libraryOwner' ? { libraryOwner: 'bob' } : {}) })
    );
    if (scope === 'readerBookScope') f.db.seed(scope, { bookId: 2, accountId: 'bob' });
    const before = f.db.rows('bookmark');
    await f.run();
    assert.equal(f.status().state, 'error');
    assert.equal(f.calls.reads, 0);
    assert.equal(f.calls.uploads.length, 0);
    f.unchanged(before);
  });
}
test('same-account copies keep the selected numeric history and sync normally', async () => {
  const f = fixture({ book: { libraryOwner: 'alice' } });
  f.db.seed('data', book({ id: 2, libraryOwner: 'alice' }));
  f.db.seed('readerBookScope', { bookId: 1, accountId: 'alice' });
  f.db.seed('readerBookScope', { bookId: 2, accountId: 'alice' });
  f.db.seed('bookmark', { dataId: 2, progress: 0.9, lastBookmarkModified: 90 });
  await f.run();
  assert.equal(f.status().state, 'synced');
  assert.equal(f.calls.uploads[0].value.records.resume.progress, 0.2);
  assert.equal(f.db.rows('bookmark').find((row) => row.dataId === 2).progress, 0.9);
  assert.equal(f.db.rows('readerExternalSync')[0].bookId, 1);
  assert.equal(f.owner.client.localUser.listeners.size, 0);
});
test('offline account consent cannot become anonymous', async () => {
  const f = fixture({ profile: 'alice', auth: null });
  await f.sync.setDavBookSync('dav-link', true);
  assert.equal((await f.integration.get('books', 'dav-link')).davAccountId, 'alice');
  await f.run();
  assert.equal(f.status().state, 'synced');
});
test('anonymous local WebDAV sync continues to work', async () => {
  const f = fixture({ profile: null, auth: null, link: { davAccountId: null } });
  await f.run();
  assert.equal(f.status().state, 'synced');
});
for (const stage of ['admission', 'sourceLock', 'readerLease', 'remote']) {
  test(`an account round trip while awaiting ${stage} permanently revokes the sync`, async () => {
    const f = fixture();
    const before = f.db.rows('bookmark');
    f.hooks[stage] = () => {
      f.owner.change('bob');
      f.owner.change('alice');
    };
    await f.run();
    assert.equal(f.status().state, 'error');
    assert.equal(f.calls.uploads.length, 0);
    f.unchanged(before);
  });
}
test('same-user authenticated generation changes revoke queued sync', async () => {
  const f = fixture();
  f.hooks.admission = () => f.owner.advanceSession();
  await f.run();
  assert.equal(f.status().state, 'error');
  assert.equal(f.calls.reads, 0);
});
for (const property of ['bookId', 'sourceId', 'fileId']) {
  for (const stage of ['sourceLock', 'remote']) {
    test(`${property} replacement during ${stage} cannot retarget sync`, async () => {
      const f = fixture();
      f.db.seed('data', book({ id: 2 }));
      const before = f.db.rows('bookmark');
      f.hooks[stage] = () =>
        f.integration.seed(
          'books',
          link({ [property]: property === 'bookId' ? 2 : 'replacement' })
        );
      await f.run();
      assert.equal(f.status().state, 'error');
      assert.equal(f.calls.uploads.length, 0);
      f.unchanged(before);
    });
  }
}
test('an owner change during GET blocks uploading captured state', async () => {
  const f = fixture();
  const before = f.db.rows('bookmark');
  f.hooks.remote = () => f.db.seed('data', book({ libraryOwner: 'bob' }));
  await f.run();
  assert.equal(f.status().state, 'error');
  assert.equal(f.calls.uploads.length, 0);
  f.unchanged(before);
});
test('revocation during the final IDB write rolls back state and acknowledgement', async () => {
  const f = fixture();
  const before = f.db.rows('bookmark');
  f.db.onRequest = ({ name, verb }) => {
    if (name === 'readerExternalSync' && verb === 'put') f.owner.change('bob');
  };
  await f.run();
  assert.equal(f.status().state, 'error');
  assert.equal(f.calls.uploads.length, 1, 'an already dispatched remote write is not rolled back');
  f.unchanged(before);
});
test('commit failure never reports successful sync or publishes a checkpoint', async () => {
  const f = fixture();
  const before = f.db.rows('bookmark');
  f.db.beforeCommit = (tx) => {
    if (tx.dirty.has('readerExternalSync')) throw new Error('quota commit failure');
  };
  await f.run();
  assert.match(f.status().message, /quota commit failure/);
  f.unchanged(before);
});
test('disabling stale foreign links does not touch book data', async () => {
  const f = fixture({ book: { libraryOwner: 'bob' } });
  const before = f.db.rows('bookmark');
  await f.sync.setDavBookSync('dav-link', false);
  assert.equal((await f.integration.get('books', 'dav-link')).syncEnabled, false);
  assert.equal(f.calls.reads, 0);
  f.unchanged(before);
});
test('a sync batch stops rather than adopting the next account after a change', async () => {
  const f = fixture();
  f.integration.seed('books', link({ id: 'bob-link', davAccountId: 'bob' }));
  f.hooks.remote = () => f.owner.change('bob');
  await assert.rejects(f.sync.syncEnabledDavBooks());
  assert.equal(f.calls.reads, 1);
  assert.equal(f.calls.uploads.length, 0);
  assert.equal(f.owner.client.localUser.listeners.size, 0);
});
test('migration revalidates persistent ownership before any legacy history is moved', async () => {
  const f = fixture();
  f.db.seed('statistic', { title: 'Book', dateKey: 1, lastStatisticModified: 1 });
  f.db.beforeTransaction = (names) => {
    if (names.includes('statistic')) f.db.seed('data', book({ libraryOwner: 'bob' }));
  };
  await f.run();
  assert.equal(f.status().state, 'error');
  assert.deepEqual(f.db.rows('readerStatistic'), []);
  assert.deepEqual(f.db.rows('readerStatisticMigration'), []);
  assert.equal(f.calls.reads, 0);
});
test('profile revocation rolls back the legacy statistics migration itself', async () => {
  const f = fixture();
  f.db.seed('statistic', { title: 'Book', dateKey: 1, lastStatisticModified: 1 });
  f.db.onRequest = ({ name, verb }) => {
    if (name === 'readerStatistic' && verb === 'put') {
      f.owner.change('bob');
      f.owner.change('alice');
    }
  };
  await f.run();
  assert.equal(f.status().state, 'error');
  assert.deepEqual(f.db.rows('readerStatistic'), []);
  assert.deepEqual(f.db.rows('readerStatisticMigration'), []);
  assert.equal(f.db.rows('statistic').length, 1);
  assert.equal(f.calls.reads, 0);
});
test('valid sync and unguarded callers preserve statistics migration', async () => {
  const f = fixture();
  const row = { title: 'Book', dateKey: 1, lastStatisticModified: 1 };
  f.db.seed('statistic', row);
  await f.run();
  assert.equal(f.status().state, 'synced');
  assert.deepEqual(f.db.rows('readerStatistic'), [{ ...row, bookKey: `content:${hash}` }]);
  const db = memoryDB({ data: [book()], statistic: [row] });
  await statistics.migrateLegacyStatistics(db, book());
  assert.deepEqual(db.rows('readerStatistic'), f.db.rows('readerStatistic'));
});

test('a foreign copy arriving before migration blocks shared-history assignment', async () => {
  const f = fixture();
  f.db.seed('statistic', { title: 'Book', dateKey: 1, lastStatisticModified: 1 });
  f.db.beforeTransaction = (names) => {
    if (names.includes('statistic'))
      f.db.seed('data', book({ id: 2, title: 'Other title', libraryOwner: 'bob' }));
  };
  await f.run();
  assert.equal(f.status().state, 'error');
  assert.deepEqual(f.db.rows('readerStatistic'), []);
  assert.deepEqual(f.db.rows('readerStatisticMigration'), []);
  assert.equal(f.calls.reads, 0);
});
test('an account round trip during the final IDB request cannot publish a checkpoint', async () => {
  const f = fixture();
  const before = f.db.rows('bookmark');
  f.db.onRequest = ({ name, verb }) => {
    if (name === 'readerExternalSync' && verb === 'put') {
      f.owner.change('bob');
      f.owner.change('alice');
    }
  };
  await f.run();
  assert.equal(f.status().state, 'error');
  f.unchanged(before);
});
