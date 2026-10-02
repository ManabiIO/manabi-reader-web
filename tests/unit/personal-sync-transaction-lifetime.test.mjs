import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, loadOfflineModule, storeBoundary } from './fixtures/offline-module.mjs';
import { readFileSync } from 'node:fs';

function harness({ stalledCommit = false } = {}) {
  const { writable, get } = storeBoundary();
  const account = writable({ status: 'available' });
  let user = { id: 'alice' };
  const controller = new AbortController();
  const workReachedCommit = deferred();
  const done = deferred();
  let completionObserved = false;
  let aborts = 0;
  let requests = 0;

  const tx = {
    done: {
      then(onFulfilled, onRejected) {
        completionObserved = true;
        return (stalledCommit ? done.promise : Promise.resolve()).then(onFulfilled, onRejected);
      }
    },
    objectStore(name) {
      if (name === 'readerBookScope')
        return {
          async getAll() {
            assert.equal(completionObserved, true);
            workReachedCommit.resolve();
            return [];
          },
          async put() {
            assert.equal(completionObserved, true);
          }
        };
      return {};
    },
    abort() {
      aborts += 1;
      if (stalledCommit)
        done.reject(new DOMException('profile revoked', 'AbortError'));
    }
  };

  const db = {
    transaction() {
      return tx;
    },
    async get() {
      return undefined;
    },
    async put() {},
    async getAll() {
      return [];
    },
    async getAllFromIndex() {
      return [];
    }
  };

  class IntegrationError extends Error {
    constructor(code, status, current) {
      super(code);
      this.code = code;
      this.status = status;
      this.current = current;
    }
  }

  const { api } = loadOfflineModule('apps/web/src/lib/manabi/personal-sync.ts', {
    modules: {
      'svelte/store': { writable, get },
      '$lib/data/store': {
        database: {
          db: Promise.resolve(db),
          bookmarksChanged$: { next() {} },
          dataListChanged$: { next() {} }
        }
      },
      '$lib/data/database/books-db/content-hash-index': {
        async readIndexedBookMetadata() {
          assert.equal(completionObserved, true);
          return [];
        }
      },
      './personal-book-authority': {
        livePersonalCopies: async () => [],
        needsPersonalHydration: () => false,
        planPersonalBookClaims: () => ({
          books: [],
          blockedBookKeys: [],
          scopesToCreate: []
        }),
        tryLivePersonalCopies: async () => []
      },
      '$lib/data/storage/storage-types': {
        StorageDataType: { STATISTICS: 'statistics' }
      },
      '$lib/data/database/books-db/reader-statistics': {
        migrateLegacyStatistics: async () => undefined
      },
      '$lib/library/completion': { validCompletion: () => true },
      '$lib/reader-annotations': {
        validateImportedAnnotation: (value) => value
      },
      './completed-statistics.js': { isCompletedStatistics: () => true },
      './client': {
        account,
        currentUser: () => user,
        IntegrationError,
        async request() {
          requests += 1;
          throw new Error('stop after local ownership admission');
        }
      },
      './persistence': {
        equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        exclusive: async (_name, work) => work()
      },
      './operation-scope': {
        captureLibraryOperation() {
          return {
            profileId: 'alice',
            signal: controller.signal,
            assertCurrent() {
              if (controller.signal.aborted || user?.id !== 'alice')
                throw new IntegrationError('account_changed', 409);
            },
            stop() {}
          };
        }
      },
      './personal-merge': {
        matchesAcknowledgedFeed: () => false,
        mergePayload: (_base, local) => ({ value: local, fields: [] }),
        mergeAnnotationPayload: (_base, local) => ({ value: local, fields: [] }),
        wirePayload: (value) => value
      }
    }
  });

  return {
    api,
    workReachedCommit: workReachedCommit.promise,
    aborts: () => aborts,
    requests: () => requests,
    revoke() {
      user = { id: 'bob' };
      controller.abort();
    }
  };
}

test('personal sync observes transaction completion before the first ownership read', async () => {
  const h = harness();
  await h.api.syncPersonalState();
  assert.equal(h.requests(), 1);
});

test('profile revocation aborts a pending personal transaction before network work', async () => {
  const h = harness({ stalledCommit: true });
  const sync = h.api.syncPersonalState();
  await h.workReachedCommit;
  h.revoke();
  await sync;
  assert.equal(h.aborts(), 1);
  assert.equal(h.requests(), 0);
});

test('personal sync no longer contains raw transaction completion waits', () => {
  const source = readFileSync(
    new URL('../../apps/web/src/lib/manabi/personal-sync.ts', import.meta.url),
    'utf8'
  );
  assert.equal(
    /await\s+tx\.done/.test(source),
    false,
    'personal transactions must use the scoped commit helper'
  );
});
