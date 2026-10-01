import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOfflineModule, deferred } from './fixtures/offline-module.mjs';

test('automatic persistence request is single-flight for the whole module lifetime', async () => {
  const pending = deferred();
  let calls = 0;
  const { api } = loadOfflineModule(
    'apps/web/src/lib/data/window/navigator/persistent-storage.ts',
    {
      modules: {
        './storage-access.mjs': {
          createStorageAccess() {
            return {
              persist() {
                calls += 1;
                return pending.promise;
              }
            };
          }
        }
      }
    }
  );

  assert.equal(api.currentPersistentStorageRequest(), undefined);
  const first = api.requestPersistentStorageOnce();
  const second = api.requestPersistentStorageOnce();
  assert.equal(first, second);
  assert.equal(api.currentPersistentStorageRequest(), first);
  assert.equal(calls, 1);
  pending.resolve(false);
  assert.equal(await first, false);
  assert.equal(await api.requestPersistentStorageOnce(), false);
  assert.equal(calls, 1, 'a denied request must not prompt repeatedly in one page lifetime');
});

test('manual retry joins a pending prompt, then may retry one settled denial', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const { api } = loadOfflineModule(
    'apps/web/src/lib/data/window/navigator/persistent-storage.ts',
    {
      modules: {
        './storage-access.mjs': {
          createStorageAccess() {
            return {
              persist() {
                calls += 1;
                return calls === 1 ? first.promise : second.promise;
              }
            };
          }
        }
      }
    }
  );

  const automatic = api.requestPersistentStorageOnce();
  const joined = api.retryPersistentStorage();
  assert.equal(joined, automatic);
  assert.equal(calls, 1, 'manual retry duplicated an active browser permission request');

  first.resolve(false);
  assert.equal(await automatic, false);

  const retried = api.retryPersistentStorage();
  assert.notEqual(retried, automatic);
  assert.equal(calls, 2);
  second.resolve(true);
  assert.equal(await retried, true);

  assert.equal(await api.requestPersistentStorageOnce(), true);
  assert.equal(await api.retryPersistentStorage(), true);
  assert.equal(calls, 2, 'a granted persistence request was repeated');
});
