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
  assert.equal(api.currentPersistentStorageRequest(), undefined);
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

test('status cannot let a stale persisted false overwrite an in-flight grant', async () => {
  const persisted = deferred();
  const granted = deferred();
  const { api } = loadOfflineModule(
    'apps/web/src/lib/data/window/navigator/persistent-storage.ts',
    {
      modules: {
        './storage-access.mjs': {
          createStorageAccess() {
            return {
              persisted: () => persisted.promise,
              persist: () => granted.promise
            };
          }
        }
      }
    }
  );

  const status = api.persistentStorageStatus();
  const request = api.requestPersistentStorageOnce();
  granted.resolve(true);
  assert.equal(await request, true);
  persisted.resolve(false);
  assert.equal(
    await status,
    true,
    'an older persisted() snapshot overwrote the newer successful request'
  );
});

test('status inspection never starts a browser permission request by itself', async () => {
  let requests = 0;
  const { api } = loadOfflineModule(
    'apps/web/src/lib/data/window/navigator/persistent-storage.ts',
    {
      modules: {
        './storage-access.mjs': {
          createStorageAccess() {
            return {
              persisted: async () => false,
              persist: async () => {
                requests += 1;
                return true;
              }
            };
          }
        }
      }
    }
  );
  assert.equal(await api.persistentStorageStatus(), false);
  assert.equal(requests, 0);
});

test('later origin-level grant supersedes an earlier denied automatic attempt', async () => {
  let persisted = false;
  let persistCalls = 0;
  const { api } = loadOfflineModule(
    'apps/web/src/lib/data/window/navigator/persistent-storage.ts',
    {
      modules: {
        './storage-access.mjs': {
          createStorageAccess() {
            return {
              persisted: async () => persisted,
              persist: async () => {
                persistCalls += 1;
                return false;
              }
            };
          }
        }
      }
    }
  );

  assert.equal(await api.requestPersistentStorageOnce(), false);
  assert.equal(persistCalls, 1);
  persisted = true;
  assert.equal(await api.persistentStorageStatus(), true);
  assert.equal(await api.requestPersistentStorageOnce(), true);
  assert.equal(await api.retryPersistentStorage(), true);
  assert.equal(persistCalls, 1, 'known persistent origin requested permission again');
});

test('status waits for an existing request before reading browser persistence', async () => {
  const granted = deferred();
  let persistedCalls = 0;
  const { api } = loadOfflineModule(
    'apps/web/src/lib/data/window/navigator/persistent-storage.ts',
    {
      modules: {
        './storage-access.mjs': {
          createStorageAccess() {
            return {
              persist: () => granted.promise,
              persisted: async () => {
                persistedCalls += 1;
                return true;
              }
            };
          }
        }
      }
    }
  );
  api.requestPersistentStorageOnce();
  const status = api.persistentStorageStatus();
  await Promise.resolve();
  assert.equal(persistedCalls, 0, 'an existing grant must settle before the browser probe');
  granted.resolve(true);
  assert.equal(await status, true);
  assert.equal(persistedCalls, 1);
});

test('status joins a request started during a stale browser probe', async () => {
  const persisted = deferred();
  const granted = deferred();
  let settled = false;
  const { api } = loadOfflineModule(
    'apps/web/src/lib/data/window/navigator/persistent-storage.ts',
    {
      modules: {
        './storage-access.mjs': {
          createStorageAccess() {
            return {
              persisted: () => persisted.promise,
              persist: () => granted.promise
            };
          }
        }
      }
    }
  );
  const status = api.persistentStorageStatus().then((result) => {
    settled = true;
    return result;
  });
  api.requestPersistentStorageOnce();
  persisted.resolve(false);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false, 'status must wait for the newer active request');
  granted.resolve(true);
  assert.equal(await status, true);
});

test('denied persistence status remains false and does not repeat an automatic prompt', async () => {
  const denied = deferred();
  let persistedCalls = 0;
  let persistCalls = 0;
  const { api } = loadOfflineModule(
    'apps/web/src/lib/data/window/navigator/persistent-storage.ts',
    {
      modules: {
        './storage-access.mjs': {
          createStorageAccess() {
            return {
              persist: () => {
                persistCalls += 1;
                return denied.promise;
              },
              persisted: async () => {
                persistedCalls += 1;
                return false;
              }
            };
          }
        }
      }
    }
  );
  api.requestPersistentStorageOnce();
  const status = api.persistentStorageStatus();
  await Promise.resolve();
  assert.equal(persistedCalls, 0);
  denied.resolve(false);
  assert.equal(await status, false);
  assert.equal(await api.requestPersistentStorageOnce(), false);
  assert.equal(await api.persistentStorageStatus(), false);
  assert.equal(persistCalls, 1);
});

test('an origin-level grant discovered during a denied request remains authoritative', async () => {
  const probe = deferred();
  const denied = deferred();
  const { api } = loadOfflineModule(
    'apps/web/src/lib/data/window/navigator/persistent-storage.ts',
    {
      modules: {
        './storage-access.mjs': {
          createStorageAccess() {
            return {
              persisted: () => probe.promise,
              persist: () => denied.promise
            };
          }
        }
      }
    }
  );
  const status = api.persistentStorageStatus();
  const request = api.requestPersistentStorageOnce();
  probe.resolve(true);
  assert.equal(await status, true);
  denied.resolve(false);
  assert.equal(await request, false);
  assert.equal(await api.requestPersistentStorageOnce(), true);
  assert.equal(await api.retryPersistentStorage(), true);
});
