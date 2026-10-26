/** @license BSD-3-Clause */
/* global window, document, navigator, performance */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadOfflineModule, storeBoundary, deferred } from './fixtures/offline-module.mjs';

// Production runtime, scheduler and store execute together. Only browser
// scheduling, lock arbitration, authentication and database/HTTP I/O are doubled.
const drain = async () => {
  for (let i = 0; i < 4; i++) await setImmediate();
};
const record = (id = 'book', receive = false) => ({
  id,
  revision: 'saved-v1',
  state: 'linked',
  automaticChecks: true,
  automaticReceive: receive
});
function clock() {
  let now = 0,
    serial = 0;
  const timers = new Map();
  return {
    timers,
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++serial;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    async advance(ms) {
      now += ms;
      for (const [id, task] of [...timers])
        if (task.at <= now) {
          timers.delete(id);
          task.fn();
        }
      await drain();
    }
  };
}
function lockManager() {
  const queue = [];
  let held;
  const grant = () => {
    if (held) return;
    const item = queue.shift();
    if (!item) return;
    held = item;
    item.options.signal.removeEventListener('abort', item.abort);
    Promise.resolve()
      .then(() => item.work({ name: item.name }))
      .then(item.resolve, item.reject)
      .finally(() => {
        held = undefined;
        grant();
      });
  };
  return {
    pending: () => queue.length,
    active: () => !!held,
    request(name, options, work) {
      return new Promise((resolve, reject) => {
        const item = { name, options, work, resolve, reject };
        item.abort = () => {
          const index = queue.indexOf(item);
          if (index >= 0) queue.splice(index, 1);
          reject(options.signal.reason);
        };
        if (options.signal.aborted) {
          reject(options.signal.reason);
          return;
        }
        options.signal.addEventListener('abort', item.abort, { once: true });
        queue.push(item);
        grant();
      });
    }
  };
}
function fixture({
  locks = lockManager(),
  timer = clock(),
  rows = [record()],
  observe,
  receive,
  initialStatus = 'available',
  online = true
} = {}) {
  const account = storeBoundary().writable({
    status: initialStatus,
    session: { user: { id: 'owner' } }
  });
  const onlineStore = storeBoundary().writable(online);
  const isOnline$ = {
    subscribe(fn) {
      const stop = onlineStore.subscribe(fn);
      return { unsubscribe: stop };
    }
  };
  const recovery = new EventTarget();
  const document = new EventTarget();
  document.visibilityState = 'visible';
  let generation = 0;
  const observations = [],
    receives = [],
    listings = [],
    statuses = [];
  const { api } = loadOfflineModule('apps/web/src/lib/manabi/reader-bridge-automatic.ts', {
    modules: {
      './client': { account, accountGeneration: () => generation },
      '../data/store': { isOnline$ },
      './reader-bridge-local': {
        listDriveReaderConnections: async (...args) => {
          listings.push(args);
          return rows;
        }
      },
      './reader-bridge-saved': {
        observeSavedDriveReaderConnection: async (...args) => {
          observations.push(args);
          return observe
            ? observe(...args)
            : { state: 'changed', observedAt: 'observed', observedRevision: 'cloud-v1' };
        }
      },
      './reader-bridge-automatic-receive': {
        receiveSavedDriveReaderChanges: async (...args) => {
          receives.push(args);
          return receive ? receive(...args) : { state: 'received', observedAt: 'received' };
        }
      },
      './reader-bridge-recovery': { readerBridgeRecoveryChanges: recovery }
    },
    globals: {
      navigator: { locks },
      document,
      performance: { now: timer.now },
      setTimeout: timer.setTimeout,
      clearTimeout: timer.clearTimeout
    }
  });
  const stopStatus = api.readerBridgeAutomaticStatus.subscribe((value) =>
    statuses.push(structuredClone(value))
  );
  let stopRuntime;
  return {
    api,
    timer,
    locks,
    account,
    recovery,
    observations,
    receives,
    listings,
    statuses,
    start() {
      stopRuntime = api.startReaderBridgeAutomaticChecks();
    },
    latest: () => statuses.at(-1),
    online(value) {
      onlineStore.set(value);
    },
    visible(value) {
      document.visibilityState = value ? 'visible' : 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    },
    user(id, { sameGeneration = false } = {}) {
      if (!sameGeneration) generation++;
      account.set({ status: 'available', session: { user: id ? { id } : null } });
    },
    stop() {
      stopRuntime?.();
      stopStatus();
    }
  };
}

test('startup waits one minute and only an available online account starts checks', async () => {
  const h = fixture({ initialStatus: 'loading', online: false });
  try {
    h.start();
    await drain();
    await h.timer.advance(60_000);
    assert.equal(h.listings.length, 0);
    h.user('owner');
    await drain();
    await h.timer.advance(60_000);
    assert.equal(h.listings.length, 0);
    h.online(true);
    await drain();
    await h.timer.advance(59_999);
    assert.equal(h.listings.length, 0);
    await h.timer.advance(1);
    assert.equal(h.observations.length, 1);
    await h.timer.advance(60_000);
    assert.equal(h.observations.length, 1);
    assert.equal(h.latest().records.book.state, 'changed');
  } finally {
    h.stop();
    await drain();
  }
  assert.equal(h.timer.timers.size, 0);
  assert.equal(h.locks.active(), false);
});

for (const transition of [
  'offline',
  'hidden',
  'unmount',
  'new-account',
  'same-account-generation'
]) {
  test(`${transition} cancels in-flight metadata and late results never publish`, async () => {
    const pending = deferred();
    const h = fixture({ observe: () => pending.promise });
    try {
      h.start();
      await drain();
      await h.timer.advance(60_000);
      const signal = h.observations[0][3];
      assert.equal(signal.aborted, false);
      if (transition === 'offline') h.online(false);
      if (transition === 'hidden') h.visible(false);
      if (transition === 'unmount') h.stop();
      if (transition === 'new-account') h.user('different');
      if (transition === 'same-account-generation') h.user('owner');
      assert.equal(signal.aborted, true);
      const count = h.statuses.length;
      pending.resolve({ state: 'changed', observedAt: 'retired', observedRevision: 'late' });
      await drain();
      assert.equal(h.statuses.length, count);
      assert.deepEqual(Object.keys(h.latest().records), []);
      assert.equal(h.receives.length, 0);
    } finally {
      h.stop();
      await drain();
    }
    assert.equal(h.timer.timers.size, 0);
    assert.equal(h.locks.active(), false);
  });
}

test('two visible tabs use one leader and a hidden follower leaves the lock queue', async () => {
  const locks = lockManager(),
    timer = clock();
  const a = fixture({ locks, timer }),
    b = fixture({ locks, timer });
  try {
    a.start();
    b.start();
    await drain();
    assert.equal(locks.pending(), 1);
    await timer.advance(60_000);
    assert.equal(a.observations.length, 1);
    assert.equal(b.observations.length, 0);
    b.visible(false);
    await drain();
    assert.equal(locks.pending(), 0);
    b.visible(true);
    await drain();
    assert.equal(locks.pending(), 1);
    a.visible(false);
    await drain();
    assert.equal(locks.pending(), 0);
    await timer.advance(59_999);
    assert.equal(b.observations.length, 0);
    await timer.advance(1);
    assert.equal(b.observations.length, 1);
  } finally {
    a.stop();
    b.stop();
    await drain();
  }
  assert.equal(timer.timers.size, 0);
  assert.equal(locks.active(), false);
  assert.equal(locks.pending(), 0);
});

test('no Web Locks means no automatic work', async () => {
  const h = fixture({ locks: null });
  try {
    h.start();
    await drain();
    await h.timer.advance(300_000);
    assert.equal(h.listings.length, 0);
    assert.equal(h.latest().available, false);
  } finally {
    h.stop();
    await drain();
  }
});

test('a receive announcing its own journal commit does not cancel itself or repeat immediately', async () => {
  let h;
  h = fixture({
    rows: [record('book', true)],
    receive: async (_owner, _id, _revision, signal) => {
      h.recovery.dispatchEvent(new Event('change'));
      assert.equal(signal.aborted, false);
      return { state: 'received', observedAt: 'committed' };
    }
  });
  try {
    h.start();
    await drain();
    await h.timer.advance(60_000);
    assert.equal(h.receives.length, 1);
    assert.equal(h.latest().records.book.state, 'received');
    await h.timer.advance(60_000);
    assert.equal(h.receives.length, 1);
  } finally {
    h.stop();
    await drain();
  }
});

test('an external recovery change retires the old check and the next pass uses the new revision', async () => {
  const pending = deferred(),
    rows = [record()];
  let calls = 0;
  const h = fixture({
    rows,
    observe: () =>
      ++calls === 1
        ? pending.promise
        : { state: 'unchanged', observedAt: 'new', observedRevision: 'cloud-v2' }
  });
  try {
    h.start();
    await drain();
    await h.timer.advance(60_000);
    rows[0] = { ...rows[0], revision: 'saved-v2' };
    h.recovery.dispatchEvent(new Event('change'));
    assert.equal(h.observations[0][3].aborted, true);
    pending.resolve({ state: 'changed', observedAt: 'old', observedRevision: 'cloud-v1' });
    await drain();
    await h.timer.advance(60_000);
    assert.equal(h.latest().records.book.revision, 'saved-v2');
    assert.equal(h.latest().records.book.observedAt, 'new');
  } finally {
    h.stop();
    await drain();
  }
});

test('hiding or going offline does not bypass an existing provider backoff', async () => {
  const h = fixture({
    observe: async () => {
      throw { code: 'rate_limited', retryAfter: 900 };
    }
  });
  try {
    h.start();
    await drain();
    await h.timer.advance(60_000);
    assert.equal(h.observations.length, 1);
    h.visible(false);
    await drain();
    h.visible(true);
    await drain();
    await h.timer.advance(60_000);
    assert.equal(h.observations.length, 1);
    h.online(false);
    await drain();
    h.online(true);
    await drain();
    await h.timer.advance(60_000);
    assert.equal(h.observations.length, 1);
    await h.timer.advance(780_000);
    assert.equal(h.observations.length, 2);
  } finally {
    h.stop();
    await drain();
  }
});

for (const transition of ['offline', 'hidden', 'unmount', 'new-account']) {
  test(`${transition} cancels an active receive and cannot publish its late receipt`, async () => {
    const pending = deferred();
    const h = fixture({ rows: [record('book', true)], receive: () => pending.promise });
    try {
      h.start();
      await drain();
      await h.timer.advance(60_000);
      assert.equal(h.receives.length, 1);
      const signal = h.receives[0][3];
      if (transition === 'offline') h.online(false);
      if (transition === 'hidden') h.visible(false);
      if (transition === 'unmount') h.stop();
      if (transition === 'new-account') h.user('different');
      assert.equal(signal.aborted, true);
      const count = h.statuses.length;
      pending.resolve({ state: 'received', observedAt: 'retired' });
      await drain();
      assert.equal(h.statuses.length, count);
      assert.deepEqual(Object.keys(h.latest().records), []);
    } finally {
      h.stop();
      await drain();
    }
  });
}

test('returning from a cancelled pass does not redisplay a stale checking spinner', async () => {
  const pending = deferred();
  const h = fixture({ observe: () => pending.promise });
  try {
    h.start();
    await drain();
    await h.timer.advance(60_000);
    h.visible(false);
    pending.resolve({ state: 'changed', observedAt: 'retired', observedRevision: 'old' });
    await drain();
    h.visible(true);
    await drain();
    await h.timer.advance(60_000);
    assert.equal(h.observations.length, 1, 'Resume must preserve the per-book cooldown');
    assert.deepEqual(Object.keys(h.latest().records), []);
  } finally {
    h.stop();
    await drain();
  }
});

// Run explicitly after installing both Playwright engines. This exercises native
// cross-page Web Locks; deterministic tests above cover the additional failures.
for (const engine of ['chromium', 'webkit']) {
  test(
    `native ${engine} locks transfer one automatic leader across pages`,
    {
      skip: process.env.READER_BRIDGE_NATIVE_LOCKS !== '1'
    },
    async () => {
      const root = fileURLToPath(new URL('../../', import.meta.url));
      const compiled = await build({
        stdin: {
          contents: `import { startReaderBridgeAutomaticChecks, readerBridgeAutomaticStatus } from './apps/web/src/lib/manabi/reader-bridge-automatic.ts';
        window.startRuntime=()=>{window.stopRuntime=startReaderBridgeAutomaticChecks();};
        readerBridgeAutomaticStatus.subscribe(value=>window.latestStatus=value);
        window.runtimeReady=true;`,
          resolveDir: root
        },
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        plugins: [
          {
            name: 'runtime-browser-boundaries',
            setup(builder) {
              builder.onResolve(
                {
                  filter:
                    /^(?:\.\/client|\.\.\/data\/store|\.\/reader-bridge-(?:local|saved|automatic-receive|recovery))$/
                },
                ({ path }) => ({ path, namespace: 'boundary' })
              );
              builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
                contents:
                  path === './client'
                    ? 'export const account=window.harness.account; export const accountGeneration=()=>window.harness.generation;'
                    : path === '../data/store'
                      ? 'export const isOnline$=window.harness.online;'
                      : path === './reader-bridge-local'
                        ? 'export const listDriveReaderConnections=async()=>window.harness.rows;'
                        : path === './reader-bridge-saved'
                          ? 'export const observeSavedDriveReaderConnection=async (...args)=>window.harness.observe(...args);'
                          : path === './reader-bridge-automatic-receive'
                            ? 'export const receiveSavedDriveReaderChanges=async()=>{throw new Error("Not opted in");};'
                            : 'export const readerBridgeRecoveryChanges=window.harness.recovery;'
              }));
            }
          }
        ]
      });
      const server = createServer((request, response) => {
        response.setHeader(
          'Content-Type',
          request.url === '/runtime.js' ? 'text/javascript' : 'text/html'
        );
        response.end(
          request.url === '/runtime.js'
            ? compiled.outputFiles[0].text
            : '<!doctype html><title>Native reader bridge locks</title><script src="/runtime.js"></script>'
        );
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      let browser, context;
      try {
        const playwright = await import('@playwright/test');
        browser = await playwright[engine].launch({
          args:
            engine === 'chromium' && process.platform === 'darwin'
              ? ['--disable-features=MacAppCodeSignClone']
              : []
        });
        context = await browser.newContext();
        await context.addInitScript(() => {
          function store(value, rx = false) {
            const listeners = new Set();
            return {
              subscribe(fn) {
                listeners.add(fn);
                fn(value);
                const stop = () => listeners.delete(fn);
                return rx ? { unsubscribe: stop } : stop;
              },
              set(next) {
                value = next;
                for (const fn of listeners) fn(value);
              }
            };
          }
          let time = 0,
            serial = 0,
            visibility = 'visible';
          const timers = new Map();
          window.setTimeout = (fn, ms) => {
            const id = ++serial;
            timers.set(id, { fn, at: time + ms });
            return id;
          };
          window.clearTimeout = (id) => timers.delete(id);
          Object.defineProperty(performance, 'now', { configurable: true, value: () => time });
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => visibility
          });
          window.advance = (ms) => {
            time += ms;
            for (const [id, task] of [...timers])
              if (task.at <= time) {
                timers.delete(id);
                task.fn();
              }
          };
          window.hide = () => {
            visibility = 'hidden';
            document.dispatchEvent(new Event('visibilitychange'));
          };
          window.harness = {
            account: store({ status: 'available', session: { user: { id: 'native-owner' } } }),
            online: store(true, true),
            generation: 0,
            recovery: new EventTarget(),
            observations: 0,
            rows: [
              {
                id: 'book',
                revision: '1',
                state: 'linked',
                automaticChecks: true,
                automaticReceive: false
              }
            ],
            async observe() {
              this.observations++;
              return { state: 'unchanged', observedAt: 'now', observedRevision: 'cloud' };
            }
          };
        });
        const first = await context.newPage();
        const url = `http://127.0.0.1:${server.address().port}`;
        await first.goto(url);
        await first.waitForFunction(() => window.runtimeReady);
        await first.evaluate(() => window.startRuntime());
        await first.waitForFunction(async () => (await navigator.locks.query()).held.length === 1);
        const second = await context.newPage();
        await second.goto(url);
        await second.waitForFunction(() => window.runtimeReady);
        await second.evaluate(() => window.startRuntime());
        await first.waitForFunction(
          async () => (await navigator.locks.query()).pending.length === 1
        );
        await first.evaluate(() => window.advance(60_000));
        await second.evaluate(() => window.advance(60_000));
        await first.waitForFunction(() => window.harness.observations === 1);
        assert.equal(await second.evaluate(() => window.harness.observations), 0);
        await first.evaluate(() => window.hide());
        await second.waitForFunction(
          async () => (await navigator.locks.query()).pending.length === 0
        );
        await second.evaluate(() => window.advance(60_000));
        await second.waitForFunction(() => window.harness.observations === 1);
        await first.evaluate(() => window.stopRuntime());
        await second.evaluate(() => window.stopRuntime());
        await second.waitForFunction(async () => (await navigator.locks.query()).held.length === 0);
        await second.reload();
        await second.waitForFunction(() => window.runtimeReady);
        assert.equal(await second.evaluate(() => window.harness.observations), 0);
        await second.evaluate(() => window.startRuntime());
        await second.waitForFunction(async () => (await navigator.locks.query()).held.length === 1);
        await second.evaluate(() => window.advance(60_000));
        await second.waitForFunction(() => window.harness.observations === 1);
        await second.evaluate(() => window.stopRuntime());
        await second.waitForFunction(async () => (await navigator.locks.query()).held.length === 0);
      } finally {
        try {
          await context?.close();
        } finally {
          try {
            await browser?.close();
          } finally {
            await new Promise((resolve) => server.close(resolve));
          }
        }
      }
    }
  );
}
