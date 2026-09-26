/** Production queue/store with explicit transaction, timer and recognizer doubles.
 * These held operations verify teardown ordering, not native disk latency or ASR.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { abortable, inAbortScope } from '../../.cache/media-test-build/abort.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';

const key = 'content:' + 'd'.repeat(64);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function harness(body) {
  const range = globalThis.IDBKeyRange;
  const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  globalThis.IDBKeyRange = RangeDouble;
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  const store = new MediaStore(new TransactionFactory(), 'lifecycle-closeout');
  const queues = [];
  const make = (engine) => {
    const q = new TranscriptionQueue(store, 'guest', engine, async () =>
      new Float32Array(16000).fill(0.1)
    );
    queues.push(q);
    return q;
  };
  try {
    await body({ store, make });
  } finally {
    await Promise.allSettled(queues.map((q) => q.dispose()));
    await store.close();
    if (range === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = range;
    if (locks) Object.defineProperty(navigator, 'locks', locks);
    else delete navigator.locks;
  }
}
function preparing(started, dispose = () => {}) {
  return {
    prepare(signal) {
      started.resolve();
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      );
    },
    dispose
  };
}
function contains(error, expected) {
  return (
    error === expected ||
    (error instanceof AggregateError && error.errors.some((e) => contains(e, expected)))
  );
}

test('Close reports the draining batch retirement failure and retires the engine once', () =>
  harness(async ({ make }) => {
    const started = deferred(),
      failure = Error('runtime retirement failed');
    let stops = 0;
    const q = make(
      preparing(started, () => {
        stops++;
        throw failure;
      })
    );
    await q.enqueue(key, 'en', '1', 2);
    await started.promise;
    await assert.rejects(q.dispose(), (error) => contains(error, failure));
    assert.equal(stops, 1, 'the draining batch is the sole runtime-retirement owner');
  }));

test('Close reports a failed pause transaction even though the active signal is aborted', () =>
  harness(async ({ make, store }) => {
    const started = deferred(),
      failure = Error('pause checkpoint disk failure');
    const original = store.updateLocal.bind(store);
    store.updateLocal = (scope, kind, id, change) =>
      original(scope, kind, id, (old) => {
        const next = change(old);
        if (next?.status === 'paused') throw failure;
        return next;
      });
    const q = make(preparing(started));
    await q.enqueue(key, 'en', '1', 2);
    await started.promise;
    await assert.rejects(q.dispose(), (error) => contains(error, failure));
  }));

test('Close drains an admitted heartbeat operation and fences its delayed renewal', () =>
  harness(async ({ make, store }) => {
    const started = deferred(),
      renewal = deferred();
    const set = globalThis.setInterval,
      clear = globalThis.clearInterval;
    let heartbeat,
      ticking = false,
      cleared = false,
      done = false;
    globalThis.setInterval = (fn, ms) => {
      assert.equal(ms, 15000);
      heartbeat = fn;
      return 1;
    };
    globalThis.clearInterval = () => {
      cleared = true;
    };
    const original = store.updateLocal.bind(store);
    store.updateLocal = (...args) =>
      ticking ? renewal.promise.then(() => original(...args)) : original(...args);
    const q = make(preparing(started));
    let closing;
    try {
      const job = await q.enqueue(key, 'en', '1', 2);
      await started.promise;
      ticking = true;
      heartbeat();
      ticking = false;
      closing = q.dispose().then(() => {
        done = true;
      });
      // Drain all immediately available transaction tasks without resolving the held renewal.
      for (let i = 0; i < 15; i++) await tick();
      assert.equal(cleared, true);
      assert.equal(done, false, 'queue close must not outlive its admitted heartbeat');
      renewal.resolve();
      await closing;
      const saved = await store.local('guest', 'jobs', job.id);
      assert.equal(saved.status, 'paused');
      assert.equal(saved.ownerId, undefined);
      assert.equal(saved.leaseUntil, undefined);
    } finally {
      renewal.resolve();
      await closing;
      globalThis.setInterval = set;
      globalThis.clearInterval = clear;
    }
  }));

test('Close waits for initial recovery and prevents a delayed scan from mutating jobs', () =>
  harness(async ({ make, store }) => {
    const scan = deferred(),
      entered = deferred();
    const original = store.listLocal.bind(store);
    let updates = 0,
      done = false;
    const update = store.updateLocal.bind(store);
    store.updateLocal = (...args) => {
      updates++;
      return update(...args);
    };
    store.listLocal = async (...args) => {
      entered.resolve();
      await scan.promise;
      return original(...args);
    };
    const q = make({ dispose() {} });
    let closing;
    const recovery = q.recover();
    try {
      await entered.promise;
      closing = q.dispose().then(() => {
        done = true;
      });
      for (let i = 0; i < 5; i++) await tick();
      assert.equal(done, false);
      scan.resolve();
      await Promise.all([closing, recovery]);
      assert.equal(updates, 0);
    } finally {
      scan.resolve();
      await Promise.allSettled([closing, recovery]);
    }
  }));

for (const reason of [null, 0, false, 'cancelled by caller']) {
  test(`abort helpers preserve the exact explicit reason ${JSON.stringify(reason)}`, async () => {
    const controller = new AbortController();
    const result = abortable(controller.signal, () => new Promise(() => {}));
    const joined = inAbortScope([controller.signal], () => new Promise(() => {}));
    const results = Promise.allSettled([result, joined]);
    controller.abort(reason);
    for (const value of await results) {
      assert.equal(value.status, 'rejected');
      assert.equal(value.reason, reason);
    }
  });
}
