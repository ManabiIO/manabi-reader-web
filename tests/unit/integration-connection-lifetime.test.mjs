import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { loadOfflineModule, deferred } from './fixtures/offline-module.mjs';

function harness() {
  const opens = [];
  const { api } = loadOfflineModule('apps/web/src/lib/manabi/persistence.ts', {
    modules: {
      idb: {
        openDB(name, version, callbacks) {
          const opening = deferred();
          const connection = {
            closed: 0,
            close() {
              this.closed++;
            }
          };
          opens.push({ name, version, callbacks, connection, ...opening });
          return opening.promise;
        }
      }
    }
  });
  return { api, opens };
}

test('integration database shares an in-flight and healthy open', async () => {
  const h = harness();
  const opening = h.api.integrationDB();
  assert.equal(h.api.integrationDB(), opening);
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].name, 'manabi-reader-integrations');
  assert.equal(h.opens[0].version, 3);
  h.opens[0].resolve(h.opens[0].connection);
  await opening;
  assert.equal(h.api.integrationDB(), opening);
});

test('failed integration open is not cached permanently', async () => {
  const h = harness();
  const first = h.api.integrationDB();
  const failure = new globalThis.DOMException('temporary denial', 'UnknownError');
  const rejected = assert.rejects(first, (error) => error === failure);
  h.opens[0].reject(failure);
  await rejected;
  const second = h.api.integrationDB();
  assert.notEqual(second, first, 'a recoverable open failure poisoned all later callers');
  h.opens[1].resolve(h.opens[1].connection);
  assert.equal(await second, h.opens[1].connection);
});

test('abnormally terminated connection is replaced on the next access only', async () => {
  const h = harness();
  const first = h.api.integrationDB();
  h.opens[0].resolve(h.opens[0].connection);
  await first;
  assert.equal(typeof h.opens[0].callbacks.terminated, 'function');
  h.opens[0].callbacks.terminated();
  assert.equal(h.opens.length, 1, 'termination must not start background database work');
  const next = h.api.integrationDB();
  assert.equal(h.opens.length, 2);
  h.opens[1].resolve(h.opens[1].connection);
  assert.equal(await next, h.opens[1].connection);
});

test('versionchange releases the old connection without closing its replacement', async () => {
  const h = harness();
  const first = h.api.integrationDB();
  h.opens[0].resolve(h.opens[0].connection);
  await first;
  assert.equal(typeof h.opens[0].callbacks.blocking, 'function');
  h.opens[0].callbacks.blocking();
  const next = h.api.integrationDB();
  h.opens[1].resolve(h.opens[1].connection);
  await next;
  await setImmediate();
  assert.equal(h.opens[0].connection.closed, 1);
  assert.equal(h.opens[1].connection.closed, 0);
  // A late event on a retired connection cannot evict the new one.
  h.opens[0].callbacks.terminated();
  assert.equal(h.api.integrationDB(), next);
  assert.equal(h.opens.length, 2);
});

test('metadata writer observes transaction completion before issuing its first request', async () => {
  let completionObserved = false;
  const completion = Promise.resolve();
  const done = {
    then(onFulfilled, onRejected) {
      completionObserved = true;
      return completion.then(onFulfilled, onRejected);
    },
    catch(onRejected) {
      completionObserved = true;
      return completion.catch(onRejected);
    }
  };
  const tx = {
    done,
    store: {
      async put() {
        assert.equal(
          completionObserved,
          true,
          'transaction completion was observed only after the request had already started'
        );
        return 'key';
      }
    },
    abort() {}
  };
  const { api } = loadOfflineModule('apps/web/src/lib/manabi/persistence.ts', {
    modules: {
      idb: {
        openDB: async () => ({
          transaction() {
            return tx;
          }
        })
      }
    }
  });
  assert.equal(await api.setMetadata('preference', { value: 1 }), 'key');
});
