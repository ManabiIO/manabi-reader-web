import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { loadOfflineModule, storeBoundary, deferred } from './fixtures/offline-module.mjs';

function harness() {
  const calls = [];
  const listeners = new Map();
  const timers = new Map();
  let timerId = 0;
  const { api, context } = loadOfflineModule('apps/web/src/lib/manabi/client.ts', {
    modules: { 'svelte/store': storeBoundary() },
    globals: {
      navigator: { onLine: true },
      window: { addEventListener: (name, listener) => listeners.set(name, listener) },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      setTimeout: (fn) => {
        const id = ++timerId;
        timers.set(id, fn);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      fetch: (url, options) => {
        const done = deferred();
        calls.push({ url, options, ...done });
        return done.promise;
      }
    }
  });
  function reply(index, user = null) {
    calls[index].resolve(
      new globalThis.Response(JSON.stringify({ user, csrf_token: 'c'.repeat(64), providers: [] }), {
        headers: { 'Content-Type': 'application/json', 'X-Manabi-User': user?.id ?? '' }
      })
    );
  }
  return { api, context, calls, timers, listeners, reply };
}

// Drain promise jobs to a task boundary, never wait for wall-clock/network timing.
const drain = () => setImmediate();
function outcome(promise) {
  const state = { settled: false };
  promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error) => Object.assign(state, { settled: true, error })
  );
  return state;
}

test('forced refresh cannot cycle when an earlier waiter starts the next probe', async () => {
  const h = harness();
  const first = h.api.refreshAccount();
  let overtaking;
  // A previously registered caller gets the first settlement before the queued
  // forced callback. This used to create an indirect promise adoption cycle.
  first.then(() => {
    overtaking = h.api.refreshAccount(true);
  });
  const queued = outcome(h.api.refreshAccount(true));
  h.reply(0);
  await drain();
  assert.equal(h.calls.length, 2);
  h.reply(1);
  await overtaking;
  await drain();
  assert.equal(queued.settled, true, 'queued refresh remained pending after both probes completed');
  assert.equal(queued.error, undefined);
});

test('new recovery during the successor queues a separate follow-up', async () => {
  const h = harness();
  const first = h.api.refreshAccount();
  const followUp = h.api.refreshAccount(true);
  h.reply(0);
  await first;
  await drain();
  assert.equal(h.calls.length, 2);
  const recovery = h.api.refreshAccount(true);
  const again = h.api.refreshAccount(true);
  assert.equal(recovery, again, 'simultaneous recovery notifications must coalesce');
  h.reply(1);
  await followUp;
  await drain();
  assert.equal(h.calls.length, 3, 'new recovery intent was lost in the prior follow-up');
  h.reply(2);
  await recovery;
});

test('ordinary focus probes share one request and retain the recent-result cache', async () => {
  const h = harness();
  const first = h.api.refreshAccount();
  assert.equal(h.api.refreshAccount(), first);
  assert.equal(h.api.refreshAccount(), first);
  assert.equal(h.calls.length, 1);
  h.reply(0);
  const result = await first;
  assert.equal(await h.api.refreshAccount(), result);
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
});

test('forced bursts queue one successor without parallel probes', async () => {
  const h = harness();
  const first = h.api.refreshAccount();
  const forced = h.api.refreshAccount(true);
  for (let i = 0; i < 20; i++) assert.equal(h.api.refreshAccount(true), forced);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.keepalive, true);
  h.reply(0);
  await first;
  await drain();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].options.keepalive, false);
  const user = { id: 'alice', username: 'Alice' };
  h.reply(1, user);
  const result = await forced;
  assert.equal(result.user.id, 'alice');
  assert.equal(h.api.currentUser().id, 'alice');
  assert.equal(h.timers.size, 0);
});

test('failed in-flight network work does not swallow its queued recovery', async () => {
  const h = harness();
  const first = h.api.refreshAccount();
  const recovery = h.api.refreshAccount(true);
  h.calls[0].reject(new TypeError('offline'));
  assert.equal(await first, null);
  await drain();
  assert.equal(h.calls.length, 2);
  h.reply(1);
  assert.equal((await recovery).user, null);
  assert.equal(h.timers.size, 0);
});

test('failed successors clear their queue so another force can retry', async () => {
  const h = harness();
  const first = h.api.refreshAccount();
  const forced = h.api.refreshAccount(true);
  h.reply(0);
  await first;
  await drain();
  h.calls[1].reject(new TypeError('still offline'));
  assert.equal(await forced, null);
  const retry = h.api.refreshAccount(true);
  assert.equal(h.calls.length, 3);
  h.reply(2);
  await retry;
  assert.equal(h.timers.size, 0);
});

test('account revocation fences old responses and queued force', async () => {
  const h = harness();
  const login = h.api.refreshAccount(true);
  h.reply(0, { id: 'alice', username: 'Alice' });
  await login;
  const old = h.api.refreshAccount(true);
  const oldQueued = h.api.refreshAccount(true);
  // Exercise the real cross-tab revocation boundary, not a direct store change.
  h.listeners.get('storage')({ key: 'manabi-reader-local-profile-v1' });
  assert.equal(h.api.currentUser(), null);
  assert.equal(h.calls.length, 3, 'revocation starts a fresh authority probe');
  const current = h.api.refreshAccount();
  const newQueued = h.api.refreshAccount(true);
  h.reply(1, { id: 'alice', username: 'Alice' });
  assert.equal(await old, null);
  assert.equal(await oldQueued, null);
  assert.equal(h.api.refreshAccount(true), newQueued, 'old cleanup must not clear the new queue');
  h.reply(2);
  await current;
  await drain();
  assert.equal(h.calls.length, 4);
  h.reply(3, { id: 'bob', username: 'Bob' });
  await newQueued;
  assert.equal(h.api.currentUser().id, 'bob');
  assert.equal(h.timers.size, 0);
});

test('active principal changes invalidate earlier queued force', async () => {
  const h = harness();
  const login = h.api.refreshAccount(true);
  const queued = h.api.refreshAccount(true);
  h.reply(0, { id: 'alice', username: 'Alice' });
  assert.equal((await login).user.id, 'alice');
  assert.equal(await queued, null);
  assert.equal(h.calls.length, 1);
  assert.equal(h.api.currentUser().id, 'alice');
});

test('overtaking successors preserve newer queue ownership', async () => {
  const h = harness();
  const first = h.api.refreshAccount();
  let overtaking, secondQueued;
  first.then(() => {
    overtaking = h.api.refreshAccount(true);
    secondQueued = h.api.refreshAccount(true);
  });
  const oldQueued = outcome(h.api.refreshAccount(true));
  h.reply(0);
  await drain();
  assert.equal(h.api.refreshAccount(true), secondQueued);
  h.reply(1);
  await overtaking;
  await drain();
  assert.equal(oldQueued.settled, true);
  assert.equal(h.calls.length, 3);
  const thirdQueued = h.api.refreshAccount(true);
  assert.equal(h.api.refreshAccount(true), thirdQueued);
  h.reply(2);
  await secondQueued;
  await drain();
  assert.equal(h.calls.length, 4);
  h.reply(3);
  await thirdQueued;
  assert.equal(h.timers.size, 0);
});
