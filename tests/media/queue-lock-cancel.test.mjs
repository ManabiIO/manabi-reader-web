import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';

const key = (digit) => 'content:' + digit.repeat(64);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(read) {
  for (let n = 0; n < 500; n++) {
    const value = await read();
    if (value) return value;
    await tick();
  }
  assert.fail('Expected queue/lock state was not reached');
}

class LockQueue {
  blocked = true;
  pending = [];
  grants = 0;

  request(name, options, callback) {
    assert.equal(name, 'manabi-moss-inference');
    return new Promise((resolve, reject) => {
      const entry = { options, callback, resolve, reject };
      const abort = () => {
        const index = this.pending.indexOf(entry);
        if (index >= 0) this.pending.splice(index, 1);
        reject(options.signal.reason);
      };
      entry.abort = abort;
      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener('abort', abort, { once: true });
      this.pending.push(entry);
      this.pump();
    });
  }

  releaseBlocker() {
    this.blocked = false;
    this.pump();
  }

  pump() {
    if (this.blocked || !this.pending.length) return;
    const entry = this.pending.shift();
    entry.options.signal?.removeEventListener('abort', entry.abort);
    this.blocked = true;
    this.grants++;
    Promise.resolve()
      .then(() => entry.callback({ name: 'manabi-moss-inference' }))
      .then(
        (value) => entry.resolve(value),
        (error) => entry.reject(error)
      )
      .finally(() => {
        this.blocked = false;
        this.pump();
      });
  }
}

async function harness(name, body) {
  const previousRange = globalThis.IDBKeyRange;
  const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  globalThis.IDBKeyRange = RangeDouble;
  const locks = new LockQueue();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
  const store = new MediaStore(new TransactionFactory(), name + crypto.randomUUID());
  const counters = { decode: 0, prepare: 0, transcribe: 0, dispose: 0 };
  const queue = new TranscriptionQueue(
    store,
    'guest',
    {
      async prepare() {
        counters.prepare++;
      },
      async transcribe() {
        counters.transcribe++;
        return '[0][S01]字幕です。[1]';
      },
      dispose() {
        counters.dispose++;
      }
    },
    async (_job, start, end) => {
      counters.decode++;
      return new Float32Array(Math.ceil((end - start) * 16000)).fill(0.1);
    }
  );
  try {
    await body({ store, queue, locks, counters });
  } finally {
    locks.releaseBlocker();
    await queue.dispose();
    await store.close();
    if (previousRange === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = previousRange;
    if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
    else delete navigator.locks;
  }
}

test('cancelling the only queued job withdraws this tab from the pending origin lock', () =>
  harness('cancel-lock-only-', async ({ store, queue, locks, counters }) => {
    const job = await queue.enqueue(key('1'), 'ja', '1', 2);
    await until(() => locks.pending.length === 1);
    await queue.cancel(job.id);
    await until(() => locks.pending.length === 0 && queue.running === false);

    const saved = await store.local('guest', 'jobs', job.id);
    assert.equal(saved.status, 'paused');
    assert.equal(saved.pauseReason, 'user');
    assert.equal(locks.grants, 0);
    assert.deepEqual(counters, { decode: 0, prepare: 0, transcribe: 0, dispose: 0 });

    locks.releaseBlocker();
    await tick();
    assert.equal(locks.grants, 0, 'cancelled tab reacquired the lock after its blocker left');
  }));

test('cancelling one queued job keeps the lock request for another local admission', () =>
  harness('cancel-lock-sibling-', async ({ store, queue, locks, counters }) => {
    const cancelled = await queue.enqueue(key('2'), 'ja', '1', 2);
    const survivor = await queue.enqueue(key('3'), 'ja', '1', 2);
    await until(() => locks.pending.length === 1);

    await queue.cancel(cancelled.id);
    assert.equal(locks.pending.length, 1, 'sibling admission lost the shared batch lock request');
    locks.releaseBlocker();

    await until(
      async () => (await store.local('guest', 'jobs', survivor.id))?.status === 'complete'
    );
    const first = await store.local('guest', 'jobs', cancelled.id);
    assert.equal(first.status, 'paused');
    assert.equal(first.pauseReason, 'user');
    assert.equal(locks.grants, 1);
    assert.equal(counters.decode, 1);
    assert.equal(counters.transcribe, 1);
    assert.equal((await store.tracks('guest', key('2'))).length, 0);
    assert.equal((await store.tracks('guest', key('3'))).length, 1);
  }));


test('stale Generate admission can persist a queued job but cannot make it runnable', () =>
  harness('stale-enqueue-admission-', async ({ store, queue, locks, counters }) => {
    const original = store.enqueueJob.bind(store);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let entered = false;
    store.enqueueJob = async (...args) => {
      entered = true;
      await gate;
      return original(...args);
    };

    let current = true;
    const pending = queue.enqueue(key('4'), 'ja', '1', 2, 0, false, undefined, () => current);
    await until(() => entered);
    current = false;
    release();
    const job = await pending;
    await tick();

    const saved = await store.local('guest', 'jobs', job.id);
    assert.equal(saved.status, 'queued');
    assert.equal(locks.pending.length, 0);
    assert.equal(locks.grants, 0);
    assert.deepEqual(counters, { decode: 0, prepare: 0, transcribe: 0, dispose: 0 });
  }));
