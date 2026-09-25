import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStorageAccess } from '../../apps/web/src/lib/data/window/navigator/storage-access.mjs';
import {
  getOfflineStatus, inspectOfflineShell, OFFLINE_STATUS_REQUEST
} from '../../apps/web/src/lib/service-worker/offline-status.mjs';

const scope = 'https://reader.example/reader-web/';
const goodReply = {
  type: OFFLINE_STATUS_REQUEST, scope, version: 'test',
  state: 'ready', required: 3, cached: 3
};
function registration(reply = goodReply) {
  return {
    scope, waiting: null,
    active: {
      scriptURL: scope + 'service-worker.js', state: 'activated',
      postMessage(message, ports) {
        assert.deepEqual(message, { type: OFFLINE_STATUS_REQUEST });
        ports[0].postMessage(reply);
        ports[0].close();
      }
    }
  };
}
const containerFor = (value) => ({ getRegistration: async () => value });

test('storage access tolerates unsupported/partial APIs and throwing getters', async () => {
  for (const getter of [() => undefined, () => ({}), () => { throw new Error('SecurityError'); }]) {
    const access = createStorageAccess(getter);
    assert.equal(await access.persisted(), false);
    assert.equal(await access.persist(), false);
    assert.deepEqual(await access.estimate(), {});
  }
});

test('storage methods retain their native receiver', async () => {
  const manager = {
    persisted() { assert.equal(this, manager); return false; },
    persist() { assert.equal(this, manager); return true; },
    estimate() { assert.equal(this, manager); return { usage: 0, quota: 100 }; }
  };
  const access = createStorageAccess(() => manager);
  assert.equal(await access.persist(), true);
  assert.deepEqual(await access.estimate(), { usage: 0, quota: 100 });
});

test('storage promise rejections never escape to settings/import callers', async () => {
  const reject = async () => { throw new Error('Denied'); };
  const access = createStorageAccess(() => ({ persisted: reject, persist: reject, estimate: reject }));
  assert.equal(await access.persisted(), false);
  assert.equal(await access.persist(), false);
  assert.deepEqual(await access.estimate(), {});
  const separate = createStorageAccess(() => ({ persisted: async () => false, persist: reject }));
  assert.equal(await separate.persist(), false);
});

test('persistence checks existing permission and coalesces concurrent requests', async () => {
  let calls = 0;
  let finish;
  let granted = false;
  const access = createStorageAccess(() => ({
    persisted: async () => granted,
    persist: () => { calls++; return new Promise((resolve) => { finish = resolve; }); }
  }));
  const first = access.persist();
  const second = access.persist();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  granted = true;
  finish(true);
  assert.equal(await first, true);
  assert.equal(await access.persist(), true);
  assert.equal(calls, 1);
});

test('a denied persistence request does not permanently prevent a later retry', async () => {
  let calls = 0;
  const access = createStorageAccess(() => ({ persist: async () => ++calls > 1 }));
  assert.equal(await access.persist(), false);
  assert.equal(await access.persist(), true);
  assert.equal(calls, 2);
});

test('invalid or absent estimates do not produce misleading usage percentages', async () => {
  for (const value of [undefined, {}, { quota: 0, usage: 0 }, { quota: NaN, usage: 1 },
    { quota: 100, usage: -1 }, { quota: 100, usage: Infinity }, { quota: '100', usage: 1 }]) {
    assert.deepEqual(await createStorageAccess(() => ({ estimate: async () => value })).estimate(), {});
  }
});

test('readiness can inspect the active worker without a controlling worker on first visit', async () => {
  const result = await getOfflineStatus(containerFor(registration()), scope);
  assert.deepEqual(result, { state: 'ready', updateWaiting: false });
});

test('waiting updates do not replace the active version in the readiness check', async () => {
  const reg = registration();
  reg.waiting = { postMessage() { throw new Error('Must not query waiting worker'); } };
  assert.deepEqual(await getOfflineStatus(containerFor(reg), scope), {
    state: 'ready', updateWaiting: true
  });
});

test('unsupported, absent, and activating workers are not reported ready', async () => {
  assert.equal((await getOfflineStatus(undefined, scope)).state, 'unsupported');
  assert.equal((await getOfflineStatus(containerFor(undefined), scope)).state, 'preparing');
  const reg = registration();
  reg.active.state = 'activating';
  assert.equal((await getOfflineStatus(containerFor(reg), scope)).state, 'preparing');
});

test('parent scope, different script, and invalid requested scope fail closed', async () => {
  const parent = registration();
  parent.scope = 'https://reader.example/';
  assert.equal((await getOfflineStatus(containerFor(parent), scope)).state, 'unknown');
  const foreign = registration();
  foreign.active.scriptURL = scope + 'unrelated-worker.js';
  assert.equal((await getOfflineStatus(containerFor(foreign), scope)).state, 'unknown');
  assert.equal((await getOfflineStatus(containerFor(registration()), scope + '?x=1')).state, 'unknown');
});

test('malformed and contradictory protocol replies cannot report readiness', async () => {
  for (const patch of [
    { type: 'other' }, { scope: 'https://other/' }, { version: '' }, { state: 'installed' },
    { required: 0, cached: 0 }, { cached: 2 }, { cached: 4 }, { cached: -1 },
    { cached: NaN }, { required: 3.1 }, { state: 'incomplete' }
  ]) {
    const result = await getOfflineStatus(containerFor(registration({ ...goodReply, ...patch })), scope);
    assert.equal(result.state, 'unknown', JSON.stringify(patch));
  }
});

test('old workers and stalled registration discovery time out without hanging settings', async () => {
  const reg = registration();
  reg.active.postMessage = () => {};
  assert.equal((await getOfflineStatus(containerFor(reg), scope, { timeoutMs: 5 })).state, 'unknown');
  const stalled = { getRegistration: () => new Promise(() => {}) };
  assert.equal((await getOfflineStatus(stalled, scope, { timeoutMs: 5 })).state, 'unknown');
});

test('aborted requests and throwing browser operations resolve safely', async () => {
  const controller = new AbortController();
  const reg = registration();
  reg.active.postMessage = () => controller.abort();
  assert.equal((await getOfflineStatus(containerFor(reg), scope, { signal: controller.signal })).state, 'unknown');
  assert.equal((await getOfflineStatus(undefined, scope, { signal: controller.signal })).state, 'unknown');
  const throws = { getRegistration() { throw new Error('SecurityError'); } };
  assert.equal((await getOfflineStatus(throws, scope)).state, 'unavailable');
  reg.active.postMessage = () => { throw new Error('closed'); };
  assert.equal((await getOfflineStatus(containerFor(reg), scope)).state, 'unavailable');
});

test('a worker replaced while responding cannot publish stale readiness', async () => {
  const reg = registration();
  const post = reg.active.postMessage;
  reg.active.postMessage = (...args) => {
    reg.active = registration().active;
    post(...args);
  };
  assert.equal((await getOfflineStatus(containerFor(reg), scope)).state, 'unknown');
});

test('empty and missing caches are incomplete and not created by inspection', async () => {
  const storage = { keys: async () => [], open() { throw new Error('Should not create'); } };
  assert.deepEqual(await inspectOfflineShell(storage, 'shell', new Set()), {
    state: 'incomplete', required: 0, cached: 0
  });
  assert.deepEqual(await inspectOfflineShell(storage, 'shell', new Set([scope])), {
    state: 'incomplete', required: 1, cached: 0
  });
});

test('bad responses, redirects and missing entries are incomplete', async () => {
  const cache = { match: async (key) => ({
    a: new Response('good'), b: new Response(null, { status: 404 }),
    c: { status: 200, redirected: true }
  })[key] };
  const storage = { keys: async () => ['shell'], open: async () => cache };
  assert.deepEqual(await inspectOfflineShell(storage, 'shell', new Set(['a', 'b', 'c', 'missing'])), {
    state: 'incomplete', required: 4, cached: 1
  });
});
