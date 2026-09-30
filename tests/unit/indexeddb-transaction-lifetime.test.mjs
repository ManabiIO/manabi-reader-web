import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOfflineModule } from './fixtures/offline-module.mjs';

function transaction(stores = {}) {
  let observed = false;
  const done = {
    then(onFulfilled, onRejected) {
      observed = true;
      return Promise.resolve().then(onFulfilled, onRejected);
    }
  };
  const fallback = {
    async get() {
      assert.equal(observed, true, 'tx.done was not observed before the first request');
      return undefined;
    },
    async put() {
      assert.equal(observed, true, 'tx.done was not observed before the first request');
    },
    async delete() {
      assert.equal(observed, true, 'tx.done was not observed before the first request');
    },
    async getAll() {
      assert.equal(observed, true, 'tx.done was not observed before the first request');
      return [];
    }
  };
  const tx = {
    done,
    store: stores.default ?? fallback,
    objectStore(name) {
      return stores[name] ?? fallback;
    },
    abort() {}
  };
  return tx;
}

test('reader local identity observes transaction completion before its first read', async () => {
  const tx = transaction({
    readerLocalIdentity: {
      async get(bookId) {
        // The assertion lives in the default wrapper below; return an existing identity.
        assert.equal(bookId, 7);
        return { bookId, uuid: '11111111-1111-4111-8111-111111111111' };
      }
    }
  });
  // Preserve early-observation evidence for the custom store too.
  let observed = false;
  tx.done = {
    then(onFulfilled, onRejected) {
      observed = true;
      return Promise.resolve().then(onFulfilled, onRejected);
    }
  };
  tx.objectStore = () => ({
    async get(bookId) {
      assert.equal(observed, true);
      return { bookId, uuid: '11111111-1111-4111-8111-111111111111' };
    },
    async put() {
      assert.equal(observed, true);
    }
  });
  const { api } = loadOfflineModule('apps/web/src/lib/reader-identity.ts', {
    modules: { '$lib/data/store': { database: { db: Promise.resolve({ transaction: () => tx }) } } }
  });
  assert.equal(await api.readerBookKeyFor(7), 'local:11111111-1111-4111-8111-111111111111');
});

test('imported-note edit observes transaction completion before reading the record', async () => {
  const expected = {
    id: '11111111-1111-4111-8111-111111111111',
    bookId: 7,
    bookKey: 'local:22222222-2222-4222-8222-222222222222',
    accountId: null,
    part: 'notes',
    source: {},
    sourceCanonical: '{}',
    status: 'book-note',
    label: 'Before',
    body: 'Body',
    quote: '',
    importedBody: '',
    importedLabel: '',
    createdAt: '2026-09-30T00:00:00.000Z',
    modifiedAt: '2026-09-30T00:00:00.000Z'
  };
  let observed = false;
  const tx = {
    done: {
      then(onFulfilled, onRejected) {
        observed = true;
        return Promise.resolve().then(onFulfilled, onRejected);
      }
    },
    store: {
      async get() {
        assert.equal(observed, true);
        return expected;
      },
      async put() {
        assert.equal(observed, true);
      }
    },
    abort() {}
  };
  class MigrationConflict extends Error {}
  const { api } = loadOfflineModule('apps/web/src/lib/manabi/imported-notes.ts', {
    modules: {
      '$lib/data/store': { database: { db: Promise.resolve({ transaction: () => tx }) } },
      './client': { localProfileUser: () => null },
      './ttu-migration-format': {
        canonical: (value) => JSON.stringify(value),
        MigrationConflict
      }
    }
  });
  await api.editImportedNote(expected, 'After', 'Edited');
});

test('cloud-series receipts observe transaction completion before receipt lookup', async () => {
  let observed = false;
  const store = {
    async get() {
      assert.equal(observed, true);
      return undefined;
    },
    async put() {
      assert.equal(observed, true);
    },
    async delete() {
      assert.equal(observed, true);
    }
  };
  const tx = {
    done: {
      then(onFulfilled, onRejected) {
        observed = true;
        return Promise.resolve().then(onFulfilled, onRejected);
      }
    },
    store,
    abort() {}
  };
  const { api } = loadOfflineModule('apps/web/src/lib/library/cloud-series.ts', {
    modules: {
      '$lib/manabi/client': {
        currentUser: () => ({ id: 'owner' }),
        request: () => assert.fail('No network request expected')
      },
      '$lib/manabi/persistence': {
        integrationDB: async () => ({ transaction: () => tx }),
        metadata: async () => undefined,
        setMetadata: async () => undefined
      },
      './organization': { sourceKey: () => 'source-key' }
    }
  });
  const source = {
    id: '11111111-1111-4111-8111-111111111111',
    owner: 'owner',
    root: '/Books/',
    provider: 'onedrive',
    name: 'Cloud'
  };
  const changed = await api.applyCloudSeriesReceipts(source, {
    id: '22222222-2222-4222-8222-222222222222',
    root: '/Books/',
    operation: 'move_books',
    revision: 1,
    status: 'complete',
    issue: '',
    expires_at: '2026-10-01T00:00:00Z',
    preview: {
      folder_name: null,
      name: null,
      book_names: [],
      parent_id: null,
      destination_id: null
    },
    steps: [],
    receipts: [
      {
        connection_id: source.id,
        root: source.root,
        item_id: 'item',
        name: 'Book'
      }
    ]
  });
  assert.equal(changed, true);
});

test('WebDAV disconnect observes transaction completion before deleting authority', async () => {
  let observed = false;
  const metadata = {
    async delete() {
      assert.equal(observed, true);
    }
  };
  const books = {
    async getAll() {
      assert.equal(observed, true);
      return [];
    },
    async delete() {
      assert.equal(observed, true);
    }
  };
  const tx = {
    done: {
      then(onFulfilled, onRejected) {
        observed = true;
        return Promise.resolve().then(onFulfilled, onRejected);
      }
    },
    objectStore(name) {
      return name === 'metadata' ? metadata : books;
    },
    abort() {}
  };
  class DavError extends Error {}
  const { api } = loadOfflineModule('apps/web/src/lib/webdav/source.ts', {
    modules: {
      '$lib/manabi/persistence': {
        integrationDB: async () => ({ transaction: () => tx }),
        exclusive: async (_name, work) => work(),
        equal: (a, b) => JSON.stringify(a) === JSON.stringify(b)
      },
      '$lib/manabi/sources': {},
      '$lib/manabi/operation-scope': { withLibraryOperation: async (_owner, work) => work() },
      '$lib/library/book-download': { verifySelectedBook: (value) => value },
      './client': {
        WebDavClient: class {},
        davRoot: (value) => new URL(value),
        davChild: (_root, value) => new URL(value),
        DavError,
        strongEtag: () => false,
        decodeDavText: () => ''
      }
    }
  });
  await api.disconnectDav('webdav-test');
});
