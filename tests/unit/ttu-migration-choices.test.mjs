/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { openDB, deleteDB } from 'idb';
import 'fake-indexeddb/auto';
import { loadOfflineModule, deferred } from './fixtures/offline-module.mjs';

const alice = { id: 'alice', username: 'Alice' };
const bob = { id: 'bob', username: 'Bob' };
const profileKey = 'manabi-reader-local-profile-v1';
const imported = (id, extra = {}) => ({
  id,
  title: `Book ${id}`,
  manabiTtuImport: {
    version: 1,
    sourceTitle: `Source ${id}`,
    content: 'a'.repeat(64),
    records: {}
  },
  ...extra
});
function session(user) {
  return new Response(JSON.stringify({ user, csrf_token: 'x'.repeat(64), providers: [] }), {
    headers: { 'Content-Type': 'application/json', 'X-Manabi-User': user?.id ?? '' }
  });
}

async function fixture(run, { profile = alice, books = [], scopes = [], settle = true } = {}) {
  const persisted = new Map(profile ? [[profileKey, JSON.stringify(profile)]] : []);
  const client = loadOfflineModule('apps/web/src/lib/manabi/client.ts', {
    globals: {
      navigator: { onLine: false },
      localStorage: {
        getItem: (key) => persisted.get(key) ?? null,
        setItem: (key, value) => persisted.set(key, value),
        removeItem: (key) => persisted.delete(key)
      },
      window: { addEventListener() {} },
      setTimeout,
      clearTimeout,
      fetch: async () => {
        throw new Error('Offline');
      }
    }
  });
  if (settle) await client.api.refreshAccount();
  let subscriptions = 0;
  const subscribe = client.api.localUser.subscribe;
  client.api.localUser.subscribe = (subscriber) => {
    subscriptions++;
    const stop = subscribe(subscriber);
    return () => {
      subscriptions--;
      stop();
    };
  };
  const name = `ttu-migration-choices-${randomUUID()}`;
  const db = await openDB(name, 1, {
    upgrade(database) {
      const data = database.createObjectStore('data', { keyPath: 'id' });
      data.createIndex('libraryOwner', 'libraryOwner');
      data.createIndex('title', 'title');
      database.createObjectStore('readerBookScope', { keyPath: 'bookId' });
    }
  });
  const seed = db.transaction(['data', 'readerBookScope'], 'readwrite');
  await Promise.all([
    ...books.map((book) => seed.objectStore('data').put(book)),
    ...scopes.map((scope) => seed.objectStore('readerBookScope').put(scope))
  ]);
  await seed.done;
  const dataReads = [];
  const controls = { beforeGet() {}, afterGet() {}, afterDone() {}, opened: 0 };
  const wrapped = {
    transaction(names) {
      const tx = db.transaction(names);
      return {
        get done() {
          return tx.done.then(controls.afterDone);
        },
        abort: () => tx.abort(),
        objectStore(storeName) {
          const store = tx.objectStore(storeName);
          return new Proxy(store, {
            get(target, property) {
              if (property === 'get' && storeName === 'data')
                return async (id) => {
                  dataReads.push(id);
                  controls.beforeGet(id);
                  const value = await store.get(id);
                  controls.afterGet(id);
                  return value;
                };
              const value = target[property];
              return typeof value === 'function' ? value.bind(target) : value;
            }
          });
        }
      };
    }
  };
  let databaseReady = Promise.resolve(wrapped);
  const modules = {
    // Unrelated import decoding/writing stays outside this read-only fixture.
    ...Object.fromEntries(
      [
        '$lib/data/database/books-db/book-binary',
        '$lib/data/window/navigator/persistent-storage',
        '$lib/data/reading-goal',
        '$lib/data/database/books-db/reader-statistics',
        '$lib/data/storage/storage-handler-factory',
        '$lib/data/storage/storage-types',
        '$lib/functions/file-loaders/utils/limited-archive',
        '$lib/functions/file-loaders/utils/restored-book',
        '$lib/library/organization',
        './reader-import-content',
        './persistence',
        './reader-book-identity',
        './yatsu-import',
        './yatsu-settings-format',
        './yatsu-settings',
        '$lib/reader-annotations',
        './ttu-migration-format'
      ].map((name) => [name, {}])
    ),
    '$lib/data/store': {
      database: {
        get db() {
          controls.opened++;
          return databaseReady;
        }
      }
    },
    './client': client.api
  };
  const { api } = loadOfflineModule('apps/web/src/lib/manabi/ttu-migration.ts', { modules });
  const changeAccount = (user) =>
    client.api.account.set({ status: 'available', session: { user } });
  try {
    await run({
      api,
      client,
      controls,
      dataReads,
      changeAccount,
      wrapped,
      waitForDatabase: (promise) => {
        databaseReady = promise;
      },
      readRows: async () => ({
        books: await db.getAll('data'),
        scopes: await db.getAll('readerBookScope')
      })
    });
  } finally {
    db.close();
    await deleteDB(name);
  }
  assert.equal(subscriptions, 0, 'Every account operation must release its subscription');
}

test('migration choices require both ownership records and avoid loading foreign book payloads', async () => {
  const books = [
    imported(1),
    imported(2, { libraryOwner: 'alice' }),
    imported(3, { libraryOwner: 'bob' }),
    imported(4),
    imported(5, { libraryOwner: 'alice' }),
    imported(6, { libraryOwner: 'bob' }),
    imported(7, { libraryOwner: 'alice' }),
    imported(8, { manabiTtuImport: undefined }),
    imported(9, {
      manabiTtuImport: { version: 1, sourceTitle: 'Invalid', content: 'wrong', records: {} }
    }),
    imported(10, { libraryOwner: 123 }),
    imported(11, { libraryOwner: null }),
    imported(12)
  ];
  const scopes = [
    { bookId: 4, accountId: 'alice' },
    { bookId: 5, accountId: 'bob' },
    { bookId: 6, accountId: 'alice' },
    { bookId: 7, accountId: 'alice' },
    { bookId: 12, accountId: null }
  ];
  await fixture(
    async ({ api, dataReads, readRows }) => {
      const before = await readRows();
      const choices = await api.migratedBookChoices();
      assert.deepEqual(
        Array.from(choices, ({ id }) => id),
        [1, 2, 4, 7]
      );
      assert.deepEqual(JSON.parse(JSON.stringify(choices[1])), {
        id: 2,
        title: 'Book 2',
        sourceTitle: 'Source 2'
      });
      assert.deepEqual(dataReads, [1, 2, 4, 7, 8, 9, 11]);
      assert.deepEqual(
        await readRows(),
        before,
        'Listing must not change receipt or ownership data'
      );
    },
    { books, scopes }
  );
});

for (const profile of [alice, null]) {
  test(`settled ${profile ? 'offline' : 'anonymous'} migration choices do not need a network request`, async () => {
    await fixture(
      async ({ api, client }) => {
        client.context.fetch = () => assert.fail('Settled local profile must not trigger a probe');
        const choices = await api.migratedBookChoices();
        assert.deepEqual(
          Array.from(choices, ({ id }) => id),
          profile ? [1, 2, 4] : [1]
        );
      },
      {
        profile,
        books: [
          imported(1),
          imported(2, { libraryOwner: 'alice' }),
          imported(3, { libraryOwner: 'bob' }),
          imported(4)
        ],
        scopes: [{ bookId: 4, accountId: 'alice' }]
      }
    );
  });
}

test('cold-start choice admission resolves the initial profile before opening the local database', async () => {
  await fixture(
    async ({ api, client, controls }) => {
      const login = deferred();
      client.context.navigator.onLine = true;
      client.context.fetch = () => login.promise;
      const reading = api.migratedBookChoices();
      await Promise.resolve();
      assert.equal(controls.opened, 0);
      login.resolve(session(alice));
      const choices = await reading;
      assert.deepEqual(
        Array.from(choices, ({ id }) => id),
        [1, 2]
      );
    },
    {
      settle: false,
      books: [
        imported(1),
        imported(2, { libraryOwner: 'alice' }),
        imported(3, { libraryOwner: 'bob' })
      ]
    }
  );
});

test('account switches while opening the database revoke choices even after returning to the first account', async () => {
  await fixture(
    async ({ api, controls, changeAccount, waitForDatabase, wrapped }) => {
      const opening = deferred();
      waitForDatabase(opening.promise);
      const reading = api.migratedBookChoices();
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(controls.opened, 1);
      changeAccount(bob);
      changeAccount(alice);
      opening.resolve(wrapped);
      await assert.rejects(reading, { code: 'account_changed' });
    },
    { books: [imported(1)] }
  );
});

for (const stage of ['afterGet', 'afterDone']) {
  test(`account changes ${stage === 'afterGet' ? 'during record reads' : 'at transaction completion'} never return captured names`, async () => {
    await fixture(
      async ({ api, controls, changeAccount }) => {
        controls[stage] = () => changeAccount(bob);
        await assert.rejects(api.migratedBookChoices(), { code: 'account_changed' });
      },
      { books: [imported(1, { libraryOwner: 'alice' })] }
    );
  });
}

test('explicit cancellation after a data read produces no choices and releases the account scope', async () => {
  await fixture(
    async ({ api, controls }) => {
      const abort = new AbortController();
      controls.afterGet = () => abort.abort();
      await assert.rejects(api.migratedBookChoices(abort.signal), { name: 'AbortError' });
    },
    { books: [imported(1)] }
  );
});

test('a failed choice read drains the transaction and permits a clean retry', async () => {
  await fixture(
    async ({ api, controls }) => {
      controls.beforeGet = () => {
        throw new Error('Storage unavailable');
      };
      await assert.rejects(api.migratedBookChoices(), /Storage unavailable/);
      controls.beforeGet = () => {};
      assert.equal((await api.migratedBookChoices()).length, 1);
    },
    { books: [imported(1)] }
  );
});
