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

// Network/lock boundary for the complete production preferences module. The
// separate startup suite retains its storage-application fault coverage.
function harness() {
  const stores = storeBoundary();
  const profile = stores.writable({ id: 'a', username: 'A' });
  const account = stores.writable({ status: 'offline', session: null });
  const loads = [],
    writes = [],
    requests = [];
  const subjects = new Map(),
    timers = new Map();
  const window = new globalThis.EventTarget();
  const document = Object.assign(new globalThis.EventTarget(), { visibilityState: 'visible' });
  let clock = 10000,
    serial = 0;
  let failWrite, failLock, requestImpl;
  let locks = Promise.resolve();
  function subject(key, initial = 0) {
    if (!subjects.has(key)) {
      const store = stores.writable(initial);
      subjects.set(key, {
        getValue: () => stores.get(store),
        next: (value) => store.set(value),
        subscribe: (fn) => ({ unsubscribe: store.subscribe(fn) })
      });
    }
    return subjects.get(key);
  }
  class IntegrationError extends Error {
    constructor(code, retryAfter = 0) {
      super(code);
      this.code = code;
      this.retryAfter = retryAfter;
    }
  }
  const persistence = loadOfflineModule('apps/web/src/lib/manabi/persistence.ts', {
    modules: { idb: {} }
  }).api;
  const timer = (fn) => {
    const id = ++serial;
    timers.set(id, fn);
    return id;
  };
  const { api } = loadOfflineModule('apps/web/src/lib/manabi/preferences.ts', {
    modules: {
      'svelte/store': stores,
      '$lib/data/store': new Proxy(
        {},
        { get: (_, key) => subject(key, key === 'customThemes$' ? {} : 0) }
      ),
      '$lib/appearance/state': { appearance$: subject('appearance', 'system') },
      '$lib/data/theme-option': { availableThemes: new Map(), portableThemeName: () => undefined },
      './client': {
        account,
        localUser: profile,
        localProfileUser: () => stores.get(profile),
        currentUser: () => stores.get(account).session?.user ?? null,
        IntegrationError,
        request(path, options) {
          const call = { path, options: globalThis.structuredClone(options) };
          requests.push(call);
          if (!requestImpl) throw new Error('Unexpected offline network request');
          return requestImpl(call);
        }
      },
      './persistence': {
        ...persistence,
        metadata(key) {
          const pending = deferred();
          loads.push({ key, ...pending });
          return pending.promise;
        },
        setMetadata(key, value) {
          writes.push({ key, value: globalThis.structuredClone(value) });
          return failWrite ? Promise.reject(failWrite) : Promise.resolve();
        },
        exclusive: (_, work) => {
          const next = locks
            .catch(() => undefined)
            .then(() => {
              if (failLock) throw failLock;
              return work();
            });
          locks = next;
          return next;
        }
      },
      '$lib/library/organization': {
        organizationPreference: subject('organization', { version: 1, collections: [], books: {} }),
        reloadOrganization: async () => undefined,
        watchOrganization: () => () => undefined
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
      setTimeout: timer,
      clearTimeout: (id) => timers.delete(id),
      setInterval: timer,
      clearInterval: (id) => timers.delete(id)
    }
  });
  return {
    api,
    IntegrationError,
    profile,
    account,
    loads,
    writes,
    requests,
    subjects,
    status: () => stores.get(api.preferenceStatus),
    setRequestHandler: (handler) => {
      requestImpl = handler;
    },
    setWriteFailure: (value) => {
      failWrite = value;
    },
    setLockFailure: (value) => {
      failLock = value;
    },
    advance: () => {
      clock += 6000;
    },
    advanceBy: (milliseconds) => {
      clock += milliseconds;
    },
    online: () => window.dispatchEvent(new globalThis.Event('online')),
    visible: () => document.dispatchEvent(new globalThis.Event('visibilitychange'))
  };
}

const reply = (settings, revision = 2) => ({
  user_id: 'a',
  schema_version: 1,
  revision,
  settings
});

async function loadedHarness(value = saved()) {
  const h = harness();
  h.stop = h.api.startPreferenceSync();
  await drain();
  h.loads[0].resolve(value);
  await drain();
  h.account.set({ status: 'available', session: { user: { id: 'a', username: 'A' } } });
  return h;
}

for (const failureAt of ['GET', 'PUT']) {
  test(`initial use-local choice survives ${failureAt} failure and automatic retry`, async () => {
    const h = await loadedHarness({ ...saved(), enabled: false });
    let fail = true;
    h.setRequestHandler(({ options }) => {
      if (fail && (options.method ?? 'GET') === failureAt) {
        fail = false;
        throw new Error('temporary network failure');
      }
      return options.method === 'PUT' ? reply(options.value.settings, 3) : reply({ font_size: 12 });
    });
    try {
      h.subjects.get('fontSize$').next(31);
      await h.api.enablePreferenceSync(true, 'local');
      assert.equal(h.status().state, 'unavailable');
      h.advance();
      h.visible();
      await drain();
      assert.equal(
        h.subjects.get('fontSize$').getValue(),
        31,
        'automatic retry discarded the explicit use-local decision'
      );
      assert.equal(h.writes.at(-1).value.local.font_size, 31);
      assert.equal(h.status().state, 'synced');
    } finally {
      h.stop();
    }
  });
}

test('initial use-local choice is durable before contacting the server', async () => {
  const h = await loadedHarness({ ...saved(), enabled: false });
  h.setRequestHandler(() => {
    assert.equal(h.writes.at(-1).value.initialChoice, 'local');
    throw new Error('network unavailable');
  });
  try {
    await h.api.enablePreferenceSync(true, 'local');
    assert.equal(h.writes.at(-1).value.initialChoice, 'local');
    assert.equal(h.writes.at(-1).value.initialized, false);
  } finally {
    h.stop();
  }
});

test('concurrent recovery notifications share one network attempt and respect its backoff', async () => {
  const h = await loadedHarness({ ...saved(), initialized: true, base: { font_size: 24 } });
  const pending = deferred();
  h.setRequestHandler(() => pending.promise);
  try {
    for (let i = 0; i < 20; i++) {
      h.visible();
      h.online();
    }
    await drain();
    assert.equal(h.requests.length, 1);
    pending.reject(new Error('rate limited'));
    await drain();
    assert.equal(h.requests.length, 1, 'queued recoveries ignored the first failure/backoff');
    assert.equal(h.status().state, 'unavailable');
  } finally {
    h.stop();
  }
});

test('normal concurrent sync callers share settlement without redundant HTTP requests', async () => {
  const h = await loadedHarness({ ...saved(), initialized: true, base: { font_size: 24 } });
  const pending = deferred();
  h.setRequestHandler(() => pending.promise);
  try {
    const callers = Array.from({ length: 20 }, () => h.api.syncPreferences());
    await drain();
    assert.equal(h.requests.length, 1);
    pending.resolve(reply({ font_size: 24 }));
    await Promise.all(callers);
    assert.equal(
      h.requests.length,
      1,
      'serialized duplicate syncs still repeated the HTTP request'
    );
    assert.equal(h.status().state, 'synced');
  } finally {
    h.stop();
  }
});

test('a reopened enabled profile retains its first-sync choice until acknowledgement', async () => {
  const h = await loadedHarness({ ...saved(31), initialChoice: 'local' });
  h.setRequestHandler(({ options }) =>
    options.method === 'PUT' ? reply(options.value.settings, 3) : reply({ font_size: 12 })
  );
  try {
    h.visible();
    await drain();
    assert.equal(h.subjects.get('fontSize$').getValue(), 31);
    assert.equal(h.status().state, 'synced');
    assert.equal(h.writes.at(-1).value.initialized, true);
    assert.equal(h.writes.at(-1).value.initialChoice, undefined);
    assert.equal(
      Object.hasOwn(
        h.requests.find(({ options }) => options.method === 'PUT').options.value.settings,
        'initialChoice'
      ),
      false,
      'local intent leaked into wire preferences'
    );
  } finally {
    h.stop();
  }
});

test('legacy profiles without a choice still adopt existing remote preferences', async () => {
  const h = await loadedHarness(saved(31));
  h.setRequestHandler(({ options }) =>
    options.method === 'PUT' ? reply(options.value.settings, 3) : reply({ font_size: 12 })
  );
  try {
    await h.api.syncPreferences();
    assert.equal(h.subjects.get('fontSize$').getValue(), 12);
    assert.equal(h.status().state, 'synced');
  } finally {
    h.stop();
  }
});

test('a disabled consent save failure cannot erase use-local intent before recovery', async () => {
  const h = await loadedHarness({ ...saved(), enabled: false });
  h.setRequestHandler(({ options }) =>
    options.method === 'PUT' ? reply(options.value.settings, 3) : reply({ font_size: 12 })
  );
  try {
    h.subjects.get('fontSize$').next(31);
    h.setWriteFailure(new Error('storage unavailable'));
    await assert.rejects(h.api.enablePreferenceSync(true, 'local'), /storage unavailable/);
    assert.equal(h.requests.length, 0, 'failed consent write started HTTP');
    h.setWriteFailure(undefined);
    h.advance();
    h.visible();
    await drain();
    assert.equal(h.subjects.get('fontSize$').getValue(), 31);
    assert.equal(h.status().state, 'synced');
  } finally {
    h.stop();
  }
});

test('explicit remote choice remains available and a new enable can replace cancelled intent', async () => {
  const h = await loadedHarness({ ...saved(), enabled: false });
  h.setRequestHandler(() => {
    throw new Error('offline');
  });
  try {
    h.subjects.get('fontSize$').next(31);
    await h.api.enablePreferenceSync(true, 'local');
    await h.api.enablePreferenceSync(false);
    assert.equal(h.writes.at(-1).value.initialChoice, undefined);
    h.setRequestHandler(({ options }) =>
      options.method === 'PUT' ? reply(options.value.settings, 3) : reply({ font_size: 12 })
    );
    await h.api.enablePreferenceSync(true, 'remote');
    assert.equal(h.subjects.get('fontSize$').getValue(), 12);
    assert.equal(h.status().state, 'synced');
  } finally {
    h.stop();
  }
});

test('initialized profiles and invalid persisted choices cannot bypass three-way merge', async () => {
  for (const value of [
    { ...saved(), initialized: true, base: { font_size: 24 }, initialChoice: 'local' },
    { ...saved(), initialChoice: 'unrecognized' }
  ]) {
    const h = await loadedHarness(value);
    h.setRequestHandler(() => reply({ font_size: 12 }));
    try {
      await h.api.syncPreferences();
      assert.equal(h.subjects.get('fontSize$').getValue(), 12);
      assert.equal(h.requests.length, 1);
    } finally {
      h.stop();
    }
  }
});

test('a lost PUT acknowledgement can converge by readback without repeating the upload', async () => {
  const h = await loadedHarness({ ...saved(), enabled: false });
  let server = reply({ font_size: 12 });
  let puts = 0;
  h.setRequestHandler(({ options }) => {
    if (options.method !== 'PUT') return server;
    puts++;
    server = reply(options.value.settings, 3);
    throw new Error('response lost after server commit');
  });
  try {
    h.subjects.get('fontSize$').next(31);
    await h.api.enablePreferenceSync(true, 'local');
    h.advance();
    h.visible();
    await drain();
    assert.equal(puts, 1);
    assert.equal(h.subjects.get('fontSize$').getValue(), 31);
    assert.equal(h.status().state, 'synced');
    assert.equal(h.writes.at(-1).value.initialChoice, undefined);
  } finally {
    h.stop();
  }
});

test('coalescing keeps edits made during HTTP pending for the next pass', async () => {
  const h = await loadedHarness({ ...saved(), initialized: true, base: { font_size: 24 } });
  const pending = deferred();
  h.setRequestHandler(() => pending.promise);
  try {
    const first = h.api.syncPreferences();
    await drain();
    h.subjects.get('fontSize$').next(31);
    const joined = h.api.syncPreferences();
    pending.resolve(reply({ font_size: 24 }));
    await Promise.all([first, joined]);
    assert.equal(h.requests.length, 1);
    assert.equal(h.subjects.get('fontSize$').getValue(), 31);
    assert.equal(h.status().state, 'pending');
    h.setRequestHandler(({ options }) =>
      options.method === 'PUT' ? reply(options.value.settings, 3) : reply({ font_size: 24 })
    );
    await h.api.syncPreferences();
    assert.equal(h.requests.length, 3);
    assert.equal(h.requests[2].options.value.settings.font_size, 31);
    assert.equal(h.status().state, 'synced');
  } finally {
    h.stop();
  }
});

test('an explicit resolution is not absorbed into an older background attempt', async () => {
  const h = await loadedHarness({ ...saved(31), initialized: true, base: { font_size: 24 } });
  const pending = deferred();
  h.setRequestHandler(() => (h.requests.length === 1 ? pending.promise : reply({ font_size: 12 })));
  try {
    const background = h.api.syncPreferences();
    await drain();
    const chosen = h.api.syncPreferences('remote');
    const joined = h.api.syncPreferences();
    pending.resolve(reply({ font_size: 12 }));
    await Promise.all([background, chosen, joined]);
    assert.equal(h.requests.length, 2);
    assert.equal(h.subjects.get('fontSize$').getValue(), 12);
    assert.equal(h.status().state, 'synced');
  } finally {
    h.stop();
  }
});

test('rejected lock admission settles all joiners and does not poison a later sync', async () => {
  const h = await loadedHarness({ ...saved(), initialized: true, base: { font_size: 24 } });
  h.setLockFailure(new Error('lock denied'));
  h.setRequestHandler(() => reply({ font_size: 24 }));
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => h.api.syncPreferences())
    );
    assert.ok(results.every(({ status }) => status === 'rejected'));
    assert.equal(h.requests.length, 0);
    h.setLockFailure(undefined);
    await h.api.syncPreferences();
    assert.equal(h.requests.length, 1);
    assert.equal(h.status().state, 'synced');
  } finally {
    h.stop();
  }
});

test('old activation settlement cannot clear or join the returning profile sync', async () => {
  const h = await loadedHarness({ ...saved(), initialized: true, base: { font_size: 24 } });
  const oldResponse = deferred();
  h.setRequestHandler(() =>
    h.requests.length === 1 ? oldResponse.promise : reply({ font_size: 31 })
  );
  try {
    const old = h.api.syncPreferences();
    await drain();
    h.account.set({ status: 'available', session: { user: { id: 'b', username: 'B' } } });
    h.profile.set({ id: 'b', username: 'B' });
    await drain();
    h.loads[1].resolve({ ...saved(), enabled: false });
    await drain();
    h.account.set({ status: 'available', session: { user: { id: 'a', username: 'A' } } });
    h.profile.set({ id: 'a', username: 'A' });
    await drain();
    h.loads[2].resolve({ ...saved(31), initialized: true, base: { font_size: 31 } });
    await drain();
    const current = h.api.syncPreferences();
    oldResponse.resolve(reply({ font_size: 24 }));
    await Promise.all([old, current]);
    assert.equal(h.requests.length, 2);
    assert.equal(h.subjects.get('fontSize$').getValue(), 31);
    assert.equal(h.status().state, 'synced');
  } finally {
    oldResponse.resolve(reply({ font_size: 24 }));
    h.stop();
  }
});

test('repeating enable without a new decision retains pending first-sync intent', async () => {
  const h = await loadedHarness({ ...saved(), enabled: false });
  h.setRequestHandler(() => {
    throw new Error('offline');
  });
  try {
    h.subjects.get('fontSize$').next(31);
    await h.api.enablePreferenceSync(true, 'local');
    h.setRequestHandler(({ options }) =>
      options.method === 'PUT' ? reply(options.value.settings, 3) : reply({ font_size: 12 })
    );
    await h.api.enablePreferenceSync(true);
    assert.equal(h.subjects.get('fontSize$').getValue(), 31);
    assert.equal(h.status().state, 'synced');
  } finally {
    h.stop();
  }
});

test('successful retry clears an older server backoff for later background edits', async () => {
  const h = await loadedHarness({ ...saved(), initialized: true, base: { font_size: 24 } });
  let fail = true;
  h.setRequestHandler(() => {
    if (fail) {
      fail = false;
      throw new h.IntegrationError('rate_limited', 60);
    }
    return reply({ font_size: 24 });
  });
  try {
    await h.api.syncPreferences();
    assert.equal(h.status().state, 'rate_limited');
    await h.api.syncPreferences();
    assert.equal(h.status().state, 'synced');
    h.subjects.get('fontSize$').next(31);
    h.visible();
    await drain();
    assert.equal(h.requests.length, 4, 'successful retry left the old server backoff active');
  } finally {
    h.stop();
  }
});

test('local save recovery does not wait for a server Retry-After', async () => {
  const h = await loadedHarness({ ...saved(), initialized: true, base: { font_size: 24 } });
  h.setRequestHandler(() => {
    throw new h.IntegrationError('rate_limited', 60);
  });
  h.setWriteFailure(new Error('storage unavailable'));
  try {
    await assert.rejects(h.api.syncPreferences(), /storage unavailable/);
    const writesAfterFailure = h.writes.length;
    h.setWriteFailure(undefined);
    h.advance();
    h.visible();
    await drain();
    assert.ok(
      h.writes.length > writesAfterFailure,
      'local snapshot recovery waited for server backoff'
    );
    assert.equal(h.requests.length, 1, 'local recovery retried the rate-limited server early');
  } finally {
    h.stop();
  }
});

test('a local storage failure cannot shorten a server Retry-After', async () => {
  const h = await loadedHarness({ ...saved(), initialized: true, base: { font_size: 24 } });
  h.setRequestHandler(() => {
    throw new h.IntegrationError('rate_limited', 60);
  });
  try {
    await h.api.syncPreferences();
    h.setWriteFailure(new Error('storage unavailable'));
    h.subjects.get('fontSize$').next(31);
    await drain();
    h.setWriteFailure(undefined);
    h.advance();
    h.visible();
    await drain();
    assert.equal(h.requests.length, 1, 'storage failure shortened the server retry deadline');
    assert.ok(h.writes.length >= 3, 'local snapshot was not retried independently');
  } finally {
    h.stop();
  }
});

test('server backoff is isolated to the profile that received it', async () => {
  const h = await loadedHarness({ ...saved(), initialized: true, base: { font_size: 24 } });
  let accountId = 'a';
  h.setRequestHandler(({ options }) => {
    if (accountId === 'a') throw new h.IntegrationError('rate_limited', 60);
    const settings = options.method === 'PUT' ? options.value.settings : { font_size: 24 };
    return {
      user_id: 'b',
      schema_version: 1,
      revision: options.method === 'PUT' ? 3 : 2,
      settings
    };
  });
  try {
    await h.api.syncPreferences();
    assert.equal(h.status().state, 'rate_limited');
    accountId = 'b';
    h.account.set({ status: 'available', session: { user: { id: 'b', username: 'B' } } });
    h.profile.set({ id: 'b', username: 'B' });
    await drain();
    h.loads[1].resolve({
      enabled: true,
      initialized: true,
      revision: 2,
      base: { font_size: 24 },
      local: { font_size: 24 }
    });
    await drain();
    await drain();
    const beforeEdit = h.requests.length;
    h.subjects.get('fontSize$').next(31);
    h.visible();
    await drain();
    assert.ok(
      h.requests.length > beforeEdit,
      'a different profile inherited the previous account server backoff'
    );
  } finally {
    h.stop();
  }
});

test('returning to a rate-limited profile does not bypass its server backoff', async () => {
  const h = await loadedHarness({ ...saved(), initialized: true, base: { font_size: 24 } });
  let accountId = 'a';
  let firstA = true;
  h.setRequestHandler(({ options }) => {
    if (accountId === 'a' && firstA) {
      firstA = false;
      throw new h.IntegrationError('rate_limited', 60);
    }
    const settings = options.method === 'PUT' ? options.value.settings : { font_size: 24 };
    return { user_id: accountId, schema_version: 1, revision: 2, settings };
  });
  try {
    await h.api.syncPreferences();
    assert.equal(h.requests.length, 1);
    accountId = 'b';
    h.account.set({ status: 'available', session: { user: { id: 'b', username: 'B' } } });
    h.profile.set({ id: 'b', username: 'B' });
    await drain();
    h.loads[1].resolve({ ...saved(), enabled: false });
    await drain();
    accountId = 'a';
    h.account.set({ status: 'available', session: { user: { id: 'a', username: 'A' } } });
    h.profile.set({ id: 'a', username: 'A' });
    await drain();
    h.loads[2].resolve({ ...saved(), initialized: true, base: { font_size: 24 } });
    await drain();
    await drain();
    assert.equal(h.requests.length, 1, 'profile restoration bypassed the active Retry-After');
    h.advanceBy(60000);
    h.visible();
    await drain();
    assert.equal(h.requests.length, 2);
    assert.equal(h.status().state, 'synced');
  } finally {
    h.stop();
  }
});
