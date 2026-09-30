import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOfflineModule } from './fixtures/offline-module.mjs';

function harness() {
  let completionObserved = false;
  let persistenceCalls = 0;
  const completion = Promise.resolve();
  const done = {
    then(onFulfilled, onRejected) {
      completionObserved = true;
      return completion.then(onFulfilled, onRejected);
    }
  };
  const store = {
    async get() {
      assert.equal(
        completionObserved,
        true,
        'transaction completion was observed only after the first request started'
      );
      return undefined;
    },
    async put() {}
  };
  const tx = {
    done,
    store,
    objectStore() {
      return store;
    },
    abort() {}
  };
  const db = {
    transaction() {
      completionObserved = false;
      return tx;
    }
  };
  class SnippetError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const { api } = loadOfflineModule('apps/web/src/lib/snippets/database.ts', {
    modules: {
      '../manabi/persistence': {
        integrationDB: async () => db,
        equal: (a, b) => JSON.stringify(a) === JSON.stringify(b)
      },
      './summary': { summarize: (value) => value },
      './document': {
        canonical: (value) => JSON.stringify(value),
        retainRemoteAncestor: (value) => value,
        encodeSnippet: (value) => value,
        parseSnippet: (value) => value,
        SnippetError
      },
      '$lib/data/window/navigator/persistent-storage': {
        requestPersistentStorageOnce() {
          persistenceCalls += 1;
          return new Promise(() => {});
        }
      }
    }
  });
  return { api, persistenceCalls: () => persistenceCalls };
}

test('snippet draft transaction observes completion before its first request', async () => {
  const h = harness();
  const { api } = h;
  await api.saveDraft(
    {
      key: JSON.stringify(['owner', 'session']),
      owner: 'owner',
      id: 'document',
      session: 'session',
      base: null,
      document: { id: 'document' },
      updatedAt: 1
    },
    () => undefined
  );
  assert.equal(h.persistenceCalls(), 1, 'draft save did not request browser storage protection');
});

test('snippet document save does not wait for persistence permission', async () => {
  const h = harness();
  await h.api.saveDocument(
    'owner',
    { id: 'document', revision: '1' },
    null,
    undefined,
    () => undefined
  );
  assert.equal(h.persistenceCalls(), 1);
});

test('snippet record transaction observes completion before its first request', async () => {
  const { api } = harness();
  const owner = 'owner';
  const id = 'document';
  await api.mutateRecord(
    owner,
    id,
    () => undefined,
    () => ({
      key: JSON.stringify([owner, id]),
      owner,
      document: { id },
      locations: [],
      dirty: false,
      conflicts: []
    })
  );
});

test('snippet transfer transaction observes completion before its first request', async () => {
  const { api } = harness();
  await api.putTransfer(
    {
      key: JSON.stringify(['owner', 'move']),
      owner: 'owner',
      id: 'move',
      snippetId: 'document',
      document: { id: 'document' },
      to: {
        source: { id: 'source', owner: null, provider: 'local', root: '', name: 'Local' },
        parent: ''
      },
      phase: 'prepared'
    },
    () => undefined
  );
});
