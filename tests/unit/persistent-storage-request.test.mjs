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

  const first = api.requestPersistentStorageOnce();
  const second = api.requestPersistentStorageOnce();
  assert.equal(first, second);
  assert.equal(calls, 1);
  pending.resolve(false);
  assert.equal(await first, false);
  assert.equal(await api.requestPersistentStorageOnce(), false);
  assert.equal(calls, 1, 'a denied request must not prompt repeatedly in one page lifetime');
});
