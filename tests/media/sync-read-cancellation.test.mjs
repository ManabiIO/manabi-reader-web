import test from 'node:test';
import assert from 'node:assert/strict';
import { syncMedia } from '../../.cache/media-test-build/sync.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const outcome = (promise) =>
  promise.then(
    (value) => ({ ok: true, value }),
    (reason) => ({ ok: false, reason })
  );
async function prompt(promise) {
  const result = await Promise.race([promise, tick().then(() => 'stalled')]);
  assert.notEqual(result, 'stalled', 'cancelled sync remained blocked on a database read');
  return result;
}
function transport(counter) {
  return {
    userId: 'reader',
    isCurrent: () => true,
    async request(path, options) {
      counter.push({ path, options });
      return { items: [], next_cursor: 0, has_more: false };
    }
  };
}

for (const reason of [null, 0, false]) {
  test(`cursor read detaches on cancellation: ${reason}`, async () => {
    const gate = deferred();
    const requests = [];
    const controller = new AbortController();
    const store = {
      local: () => gate.promise
    };
    const pending = outcome(syncMedia(store, transport(requests), controller.signal));
    await tick();
    controller.abort(reason);
    try {
      assert.deepEqual(await prompt(pending), { ok: false, reason });
      assert.equal(requests.length, 0);
    } finally {
      gate.resolve(0);
      await pending;
    }
  });

  test(`pending-record read detaches on cancellation: ${reason}`, async () => {
    const gate = deferred();
    const entered = deferred();
    const requests = [];
    const controller = new AbortController();
    const store = {
      local: async () => 0,
      putLocal: async () => {},
      records() {
        entered.resolve();
        return gate.promise;
      }
    };
    const pending = outcome(syncMedia(store, transport(requests), controller.signal));
    await entered.promise;
    controller.abort(reason);
    try {
      assert.deepEqual(await prompt(pending), { ok: false, reason });
      assert.equal(requests.filter((request) => request.options?.method === 'POST').length, 0);
    } finally {
      gate.resolve([]);
      await pending;
    }
  });

  test(`final-record read detaches on cancellation: ${reason}`, async () => {
    const gate = deferred();
    const entered = deferred();
    const requests = [];
    const controller = new AbortController();
    let reads = 0;
    const store = {
      local: async () => 0,
      putLocal: async () => {},
      async records() {
        if (++reads === 1) return [];
        entered.resolve();
        return gate.promise;
      }
    };
    const pending = outcome(syncMedia(store, transport(requests), controller.signal));
    await entered.promise;
    controller.abort(reason);
    try {
      assert.deepEqual(await prompt(pending), { ok: false, reason });
      assert.equal(
        requests.filter((request) => request.options?.method === 'POST').length,
        0
      );
    } finally {
      gate.resolve([]);
      await pending;
    }
  });
}
