import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { loadOfflineModule, storeBoundary, deferred } from './fixtures/offline-module.mjs';

const drain = () => setImmediate();
const saved = (size = 24) => ({
  enabled: true,
  initialized: false,
  revision: 0,
  base: {},
  local: { font_size: size }
});
function harness({
  gatedBoot = false,
  gatedOrganization = false,
  gatedWrites = false,
  deferredAbort = false
} = {}) {
  const stores = storeBoundary();
  const profile = stores.writable({ id: 'a', username: 'A' });
  const account = stores.writable({ status: 'offline', session: null });
  const loads = [],
    writes = [],
    applies = [],
    subjects = new Map(),
    timers = new Map();
  let clock = 10000,
    serial = 0,
    watchers = 0,
    watchStops = 0,
    bootCount = 0;
  let failWrite, failLock;
  const setterFailures = new Map();
  const boot = deferred();
  const window = new globalThis.EventTarget();
  const document = Object.assign(new globalThis.EventTarget(), { visibilityState: 'visible' });
  function subject(key, initial = 0) {
    if (!subjects.has(key)) {
      const store = stores.writable(initial);
      subjects.set(key, {
        getValue: () => stores.get(store),
        next(value) {
          if (setterFailures.has(key)) throw setterFailures.get(key);
          store.set(value);
        },
        subscribe(fn) {
          return { unsubscribe: store.subscribe(fn) };
        }
      });
    }
    return subjects.get(key);
  }
  const reader = new Proxy(
    {},
    { get: (_, name) => subject(name, name === 'customThemes$' ? {} : 0) }
  );
  const realPersistence = loadOfflineModule('apps/web/src/lib/manabi/persistence.ts', {
    modules: { idb: {} }
  }).api;
  class IntegrationError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
      this.retryAfter = 0;
    }
  }
  const { api } = loadOfflineModule('apps/web/src/lib/manabi/preferences.ts', {
    modules: {
      '$lib/state/store': stores,
      '$lib/data/store': reader,
      '$lib/appearance/state': { appearance$: subject('appearance', 'system') },
      '$lib/data/theme-option': { availableThemes: new Map(), portableThemeName: () => undefined },
      './client': {
        account,
        localUser: profile,
        localProfileUser: () => stores.get(profile),
        currentUser: () => stores.get(account).session?.user ?? null,
        IntegrationError,
        request() {
          throw new Error('Unexpected offline network request');
        }
      },
      './persistence': {
        ...realPersistence,
        metadata(key) {
          const pending = deferred();
          loads.push({ key, ...pending });
          return pending.promise;
        },
        setMetadata(key, value) {
          const pending = deferred();
          writes.push({ key, value: globalThis.structuredClone(value), ...pending });
          return failWrite
            ? Promise.reject(failWrite)
            : gatedWrites
              ? pending.promise
              : Promise.resolve();
        },
        exclusive: async (_, work) => {
          if (failLock) throw failLock;
          return work();
        }
      },
      '$lib/library/organization': {
        organizationPreference: {
          ...subject('organization', { version: 1, collections: [], books: {} }),
          next(value, signal) {
            const pending = deferred();
            applies.push({ value, signal, ...pending });
            if (!gatedOrganization) return Promise.resolve();
            if (!deferredAbort) {
              const abort = () => pending.reject(signal.reason);
              signal?.addEventListener('abort', abort, { once: true });
            }
            return pending.promise;
          }
        },
        reloadOrganization() {
          bootCount++;
          return gatedBoot && bootCount === 1 ? boot.promise : Promise.resolve();
        },
        watchOrganization() {
          watchers++;
          return () => watchStops++;
        }
      }
    },
    globals: {
      window,
      document,
      Date: class extends Date {
        static now() {
          return clock;
        }
      },
      setTimeout: (fn) => {
        const id = ++serial;
        timers.set(id, fn);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      setInterval: (fn) => {
        const id = ++serial;
        timers.set(id, fn);
        return id;
      },
      clearInterval: (id) => timers.delete(id)
    }
  });
  return {
    api,
    profile,
    account,
    loads,
    writes,
    applies,
    subjects,
    timers,
    boot,
    status: () => stores.get(api.preferenceStatus),
    watchers: () => watchers,
    watchStops: () => watchStops,
    bootCount: () => bootCount,
    advance: () => {
      clock += 6000;
    },
    online: () => window.dispatchEvent(new globalThis.Event('online')),
    visible: () => document.dispatchEvent(new globalThis.Event('visibilitychange')),
    setSetterFailure: (key, value) => {
      if (value) setterFailures.set(key, value);
      else setterFailures.delete(key);
    },
    setWriteFailure: (value) => {
      failWrite = value;
    },
    setLockFailure: (value) => {
      failLock = value;
    }
  };
}

test('A to B to A cannot restore an obsolete pending preference snapshot', async () => {
  const h = harness();
  const stop = h.api.startPreferenceSync();
  await drain();
  h.profile.set({ id: 'b', username: 'B' });
  await drain();
  h.profile.set({ id: 'a', username: 'A' });
  await drain();
  assert.equal(h.loads.length, 3);
  h.loads[2].resolve(saved(30));
  await drain();
  h.loads[1].resolve(saved(20));
  h.loads[0].resolve(saved(12));
  await drain();
  assert.equal(
    h.subjects.get('fontSize$').getValue(),
    30,
    'old activation overwrote the newer profile'
  );
  stop();
});

test('duplicate profile notifications share a pending load', async () => {
  const h = harness();
  const stop = h.api.startPreferenceSync();
  await drain();
  for (let i = 0; i < 20; i++) h.profile.set({ id: 'a', username: 'A' });
  await drain();
  assert.equal(h.loads.length, 1);
  h.loads[0].resolve(saved());
  await drain();
  stop();
});

test('failed profile read can recover on visibility without enabling sync', async () => {
  const h = harness();
  const stop = h.api.startPreferenceSync();
  await drain();
  h.loads[0].reject(new Error('temporary IndexedDB failure'));
  await drain();
  assert.equal(h.status().state, 'unavailable');
  h.advance();
  h.visible();
  await drain();
  assert.equal(
    h.loads.length,
    2,
    'same profile was permanently considered initialized after failure'
  );
  h.loads[1].resolve({ ...saved(), enabled: false });
  await drain();
  assert.equal(h.status().enabled, false);
  assert.equal(h.subjects.get('fontSize$').getValue(), 0);
  assert.equal(h.writes.length, 0);
  stop();
});

test('closing startup while a profile read is pending revokes its application', async () => {
  const h = harness();
  const stop = h.api.startPreferenceSync();
  await drain();
  stop();
  h.loads[0].resolve(saved(40));
  await drain();
  assert.equal(h.subjects.get('fontSize$').getValue(), 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.watchStops(), 1);
  h.online();
  h.visible();
  await drain();
  assert.equal(h.loads.length, 1);
});

test('closing before organization bootstrap prevents late watchers and profile reads', async () => {
  const h = harness({ gatedBoot: true });
  const stop = h.api.startPreferenceSync();
  stop();
  h.boot.resolve();
  await drain();
  assert.equal(h.watchers(), 0);
  assert.equal(h.loads.length, 0);
  assert.equal(h.timers.size, 0);
});

test('organization bootstrap failure is handled and later recovery is single-flight', async () => {
  const h = harness({ gatedBoot: true });
  const stop = h.api.startPreferenceSync();
  h.boot.reject(new Error('transient bootstrap denial'));
  await drain();
  assert.equal(h.status().state, 'unavailable');
  assert.equal(h.loads.length, 0, 'unloaded organization must not be captured for sync');
  h.advance();
  for (let i = 0; i < 20; i++) {
    h.online();
    h.visible();
  }
  await drain();
  assert.equal(h.bootCount(), 2);
  assert.equal(h.watchers(), 1);
  assert.equal(h.loads.length, 1);
  h.loads[0].resolve({ ...saved(), enabled: false });
  await drain();
  stop();
  assert.equal(h.timers.size, 0);
  assert.equal(h.watchStops(), 1);
});

test('failed asynchronous local preference persistence reports failure without losing the edit', async () => {
  const h = harness();
  const stop = h.api.startPreferenceSync();
  await drain();
  h.loads[0].resolve(saved(24));
  await drain();
  h.setWriteFailure(new Error('disk full'));
  h.subjects.get('fontSize$').next(31);
  await drain();
  assert.equal(h.subjects.get('fontSize$').getValue(), 31);
  assert.equal(h.status().state, 'unavailable');
  assert.equal(h.status().enabled, true);
  stop();
});

test('profile changes revoke an organization apply already waiting for storage', async () => {
  const h = harness({ gatedOrganization: true });
  const stop = h.api.startPreferenceSync();
  await drain();
  h.loads[0].resolve({
    ...saved(),
    local: { library_organization: { version: 1, collections: [], books: {} } }
  });
  await drain();
  assert.equal(h.applies.length, 1);
  assert.ok(h.applies[0].signal, 'organization write has no scope cancellation');
  h.profile.set({ id: 'b', username: 'B' });
  await drain();
  assert.equal(h.applies[0].signal.aborted, true);
  h.loads[1].resolve({ ...saved(), enabled: false });
  await drain();
  assert.equal(h.status().enabled, false);
  assert.equal(h.status().state, 'off');
  stop();
});

test('disabling sync cancels pending organization restoration and keeps consent off', async () => {
  const h = harness({ gatedOrganization: true });
  h.account.set({ status: 'available', session: { user: { id: 'a', username: 'A' } } });
  const stop = h.api.startPreferenceSync();
  await drain();
  h.loads[0].resolve({
    ...saved(),
    local: { library_organization: { version: 1, collections: [], books: {} } }
  });
  await drain();
  assert.equal(h.applies.length, 1);
  assert.ok(h.applies[0].signal, 'organization write has no scope cancellation');
  await h.api.enablePreferenceSync(false);
  await drain();
  assert.equal(h.applies[0].signal.aborted, true);
  assert.equal(h.status().enabled, false);
  assert.equal(h.status().state, 'off');
  assert.equal(h.writes.at(-1).value.enabled, false);
  stop();
});

test('background lock denial is observed without changing saved consent', async () => {
  const h = harness();
  h.account.set({ status: 'available', session: { user: { id: 'a', username: 'A' } } });
  h.setLockFailure(new Error('lock permission denied'));
  const stop = h.api.startPreferenceSync();
  await drain();
  h.loads[0].resolve(saved());
  await drain();
  assert.equal(h.status().state, 'unavailable');
  assert.equal(h.status().enabled, true);
  assert.equal(h.writes.length, 0);
  stop();
});

test('an offline save failure retries the latest snapshot without contacting the server', async () => {
  const h = harness();
  const stop = h.api.startPreferenceSync();
  try {
    await drain();
    h.loads[0].resolve(saved(24));
    await drain();
    h.setWriteFailure(new Error('temporary storage failure'));
    h.subjects.get('fontSize$').next(31);
    await drain();
    assert.equal(h.writes.length, 1);
    assert.equal(h.status().state, 'unavailable');
    h.setWriteFailure(undefined);
    h.advance();
    for (let i = 0; i < 20; i++) h.visible();
    await drain();
    assert.equal(h.writes.length, 2, 'offline recovery never retried the local save');
    assert.equal(h.writes.at(-1).value.local.font_size, 31);
    assert.equal(h.status().state, 'pending');
    assert.equal(h.loads.length, 1, 'retry must not restore older disk preferences');
  } finally {
    stop();
  }
});

test('a failed disable-consent save is retried even though sync is now disabled', async () => {
  const h = harness();
  const stop = h.api.startPreferenceSync();
  try {
    await drain();
    h.loads[0].resolve(saved());
    await drain();
    h.account.set({ status: 'available', session: { user: { id: 'a', username: 'A' } } });
    h.setWriteFailure(new Error('temporary storage failure'));
    await assert.rejects(h.api.enablePreferenceSync(false), /temporary storage failure/);
    h.account.set({ status: 'offline', session: null });
    h.setWriteFailure(undefined);
    h.advance();
    h.visible();
    await drain();
    assert.equal(h.writes.length, 2, 'disabled consent remained stale on disk');
    assert.equal(h.writes.at(-1).value.enabled, false);
    assert.equal(h.status().enabled, false);
    assert.equal(h.status().state, 'off');
  } finally {
    stop();
  }
});

test('successive failed edits recover only their newest complete preference snapshot', async () => {
  const h = harness();
  const stop = h.api.startPreferenceSync();
  try {
    await drain();
    h.loads[0].resolve(saved(24));
    await drain();
    h.setWriteFailure(new Error('disk full'));
    h.subjects.get('fontSize$').next(31);
    await drain();
    h.subjects.get('fontSize$').next(37);
    await drain();
    assert.equal(h.writes.length, 2);
    h.setWriteFailure(undefined);
    h.advance();
    h.visible();
    h.online();
    await drain();
    assert.equal(h.writes.length, 3);
    assert.equal(h.writes.at(-1).value.local.font_size, 37);
    h.advance();
    h.visible();
    await drain();
    assert.equal(h.writes.length, 3, 'a committed snapshot must not be replayed');
  } finally {
    stop();
  }
});

test('returning to a profile retains its failed save rather than restoring old disk state', async () => {
  const h = harness();
  const stop = h.api.startPreferenceSync();
  try {
    await drain();
    h.loads[0].resolve(saved(24));
    await drain();
    h.setWriteFailure(new Error('disk full'));
    h.subjects.get('fontSize$').next(31);
    await drain();
    h.profile.set({ id: 'b', username: 'B' });
    await drain();
    h.loads[1].resolve({ ...saved(20), enabled: false });
    await drain();
    h.advance();
    h.visible();
    await drain();
    assert.equal(h.writes.length, 1, 'the next profile must not retry the previous profile write');
    h.profile.set({ id: 'a', username: 'A' });
    await drain();
    // A pre-fix implementation asks for the old durable snapshot again.
    h.loads[2]?.resolve(saved(24));
    await drain();
    assert.equal(h.subjects.get('fontSize$').getValue(), 31);
  } finally {
    stop();
  }
});

test('failed profile application recovers offline without discarding edits made during storage work', async () => {
  const h = harness({ gatedOrganization: true });
  const stop = h.api.startPreferenceSync();
  const organization = {
    version: 1,
    collections: [{ id: 'saved', name: 'Retained', members: [] }],
    books: {}
  };
  try {
    await drain();
    h.loads[0].resolve({
      ...saved(24),
      local: { font_size: 24, library_organization: organization }
    });
    await drain();
    h.subjects.get('fontSize$').next(31);
    await drain();
    h.applies[0].reject(new Error('temporary organization write failure'));
    await drain();
    assert.equal(h.status().state, 'unavailable');
    h.advance();
    h.visible();
    await drain();
    assert.equal(h.applies.length, 2, 'a loaded profile was incorrectly treated as fully applied');
    assert.deepEqual(
      h.applies[1].value,
      organization,
      'an unrelated edit captured old organization'
    );
    assert.equal(h.subjects.get('fontSize$').getValue(), 31);
    h.applies[1].resolve();
    await drain();
    assert.equal(h.status().state, 'pending');
    assert.equal(h.loads.length, 1, 'application retry must not reread obsolete disk state');
  } finally {
    stop();
  }
});

test('a synchronous preference failure revokes already-enrolled organization work before retry', async () => {
  const h = harness({ gatedOrganization: true });
  const stop = h.api.startPreferenceSync();
  try {
    await drain();
    h.setSetterFailure('fontSize$', new Error('font setter failed'));
    h.loads[0].resolve({
      ...saved(24),
      local: {
        font_size: 24,
        library_organization: { version: 1, collections: [], books: {} }
      }
    });
    await drain();
    assert.equal(h.applies.length, 1);
    assert.equal(
      h.applies[0].signal.aborted,
      true,
      'failed application left its organization write live'
    );
    assert.equal(h.status().state, 'unavailable');
    h.setSetterFailure('fontSize$', undefined);
    h.advance();
    h.visible();
    await drain();
    assert.equal(h.applies.length, 2);
    assert.equal(
      h.applies[1].signal.aborted,
      false,
      'one failed attempt must not poison its whole profile'
    );
    h.applies[1].resolve();
    await drain();
    assert.equal(h.subjects.get('fontSize$').getValue(), 24);
  } finally {
    stop();
  }
});

test('disabling during restoration retires that attempt and still recovers a failed consent save', async () => {
  const h = harness({ gatedOrganization: true });
  const stop = h.api.startPreferenceSync();
  try {
    await drain();
    h.loads[0].resolve({
      ...saved(),
      local: { library_organization: { version: 1, collections: [], books: {} } }
    });
    await drain();
    h.account.set({ status: 'available', session: { user: { id: 'a', username: 'A' } } });
    h.setWriteFailure(new Error('temporary save denial'));
    await assert.rejects(h.api.enablePreferenceSync(false), /temporary save denial/);
    assert.equal(h.applies[0].signal.aborted, true);
    h.account.set({ status: 'offline', session: null });
    h.setWriteFailure(undefined);
    h.advance();
    h.visible();
    await drain();
    assert.equal(h.writes.length, 2);
    assert.equal(h.writes.at(-1).value.enabled, false);
    assert.equal(h.applies.length, 1, 'a disabled restoration must never restart');
    assert.equal(h.status().state, 'off');
  } finally {
    stop();
  }
});

test('changing profile revokes a pending application retry and ignores its late failure', async () => {
  const h = harness({ gatedOrganization: true });
  const stop = h.api.startPreferenceSync();
  try {
    await drain();
    h.loads[0].resolve({
      ...saved(),
      local: { library_organization: { version: 1, collections: [], books: {} } }
    });
    await drain();
    h.applies[0].reject(new Error('first failure'));
    await drain();
    h.advance();
    for (let i = 0; i < 20; i++) h.visible();
    await drain();
    assert.equal(h.applies.length, 2, 'application recovery must coalesce repeated notifications');
    h.profile.set({ id: 'b', username: 'B' });
    await drain();
    assert.equal(h.applies[1].signal.aborted, true);
    h.loads[1].resolve({ ...saved(20), enabled: false });
    await drain();
    assert.equal(h.status().state, 'off');
    assert.equal(h.status().enabled, false);
  } finally {
    stop();
  }
});

test('application failure waits for aborted organization work to settle', async () => {
  const h = harness({ gatedOrganization: true, deferredAbort: true });
  const stop = h.api.startPreferenceSync();
  try {
    await drain();
    h.setSetterFailure('fontSize$', new Error('setter failed'));
    h.loads[0].resolve({
      ...saved(),
      local: {
        font_size: 24,
        library_organization: { version: 1, collections: [], books: {} }
      }
    });
    await drain();
    assert.equal(h.applies[0].signal.aborted, true);
    assert.equal(h.status().state, 'pending', 'failure was reported before transaction settlement');
    h.applies[0].reject(h.applies[0].signal.reason);
    await drain();
    assert.equal(h.status().state, 'unavailable');
  } finally {
    h.applies[0]?.reject(new Error('test cleanup'));
    stop();
  }
});

test('completion of an older in-flight save cannot discard a newer failed snapshot', async () => {
  const h = harness({ gatedWrites: true });
  const stop = h.api.startPreferenceSync();
  try {
    await drain();
    h.loads[0].resolve(saved());
    await drain();
    h.subjects.get('fontSize$').next(31);
    await drain();
    h.subjects.get('fontSize$').next(37);
    await drain();
    assert.equal(h.writes.length, 1, 'writes should serialize');
    h.writes[0].resolve();
    await drain();
    assert.equal(h.writes.length, 2);
    assert.equal(h.writes[1].value.local.font_size, 37);
    h.writes[1].reject(new Error('commit failed'));
    await drain();
    h.visible();
    await drain();
    assert.equal(h.writes.length, 2, 'failed storage must respect retry backoff');
    h.advance();
    h.visible();
    await drain();
    assert.equal(h.writes.length, 3);
    assert.equal(h.writes[2].value.local.font_size, 37);
    h.writes[2].resolve();
    await drain();
    assert.equal(h.status().state, 'pending');
    h.advance();
    h.visible();
    await drain();
    assert.equal(h.writes.length, 3);
  } finally {
    for (const write of h.writes) write.resolve();
    stop();
  }
});
