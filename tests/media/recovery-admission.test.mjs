/** Production queue/store; explicit deterministic transaction and lock doubles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { MOSS } from '../../.cache/media-test-build/model-cache.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';
const scope = 'guest',
  key = 'content:' + 'c'.repeat(64);
const tick = () => new Promise((r) => setTimeout(r, 0));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function until(fn) {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await tick();
  }
  throw Error('Expected state not reached');
}
class LocksDouble {
  held = false;
  waiting = [];
  request(name, options, callback) {
    if (options.ifAvailable && this.held) return Promise.resolve(callback(null));
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    return new Promise((resolve, reject) => {
      const entry = {
        callback,
        resolve,
        reject,
        options,
        abort: () => {
          this.waiting = this.waiting.filter((x) => x !== entry);
          reject(options.signal.reason);
        }
      };
      options.signal?.addEventListener('abort', entry.abort, { once: true });
      this.waiting.push(entry);
      this.pump();
    });
  }
  pump() {
    if (this.held || !this.waiting.length) return;
    const entry = this.waiting.shift();
    this.held = true;
    entry.options.signal?.removeEventListener('abort', entry.abort);
    Promise.resolve()
      .then(() => entry.callback({ name: 'manabi-moss-inference' }))
      .then(entry.resolve, entry.reject)
      .finally(() => {
        this.held = false;
        this.pump();
      });
  }
}
async function harness(body, locked = true) {
  const oldRange = globalThis.IDBKeyRange,
    oldLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  globalThis.IDBKeyRange = RangeDouble;
  const locks = new LocksDouble();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locked ? locks : undefined
  });
  const store = new MediaStore(new TransactionFactory(), 'recovery-admission'),
    queues = [];
  let preparations = 0;
  const create = () => {
    const q = new TranscriptionQueue(
      store,
      scope,
      {
        async prepare() {
          preparations++;
        },
        async transcribe() {
          return '[0][S01]Test.[1]';
        },
        dispose() {}
      },
      async () => new Float32Array(16000).fill(0.1)
    );
    queues.push(q);
    return q;
  };
  try {
    await body({ store, locks, create, preparations: () => preparations });
  } finally {
    await Promise.all(queues.map((q) => q.dispose()));
    await store.close();
    if (oldRange === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = oldRange;
    if (oldLocks) Object.defineProperty(navigator, 'locks', oldLocks);
    else delete navigator.locks;
  }
}
const queued = () => ({
  version: 1,
  id: crypto.randomUUID(),
  mediaKey: key,
  language: 'en',
  audioTrack: '1',
  duration: 2,
  status: 'queued',
  nextWindow: 0,
  cues: [],
  createdAt: 1,
  modelSha256: MOSS.sha256,
  engineRevision: MOSS.engineRevision
});
for (const locked of [true, false])
  test(`startup preserves queued work without starting it (${locked ? 'Web Locks double' : 'no locks'})`, () =>
    harness(async ({ store, create, preparations }) => {
      const draft = queued();
      await store.putLocal(scope, 'jobs', draft.id, draft);
      const q = create();
      await q.recover();
      assert.deepEqual(await store.local(scope, 'jobs', draft.id), draft);
      assert.equal(preparations(), 0);
      await q.resume(draft.id);
      await until(async () => (await store.local(scope, 'jobs', draft.id)).status === 'complete');
      assert.equal(preparations(), 1);
    }, locked));
test('startup recovery cannot pause a Generate admitted while its job scan waits', () =>
  harness(async ({ store, locks, create }) => {
    const scan = deferred(),
      started = deferred(),
      original = store.listLocal.bind(store);
    let first = true;
    store.listLocal = async (...args) => {
      if (first && args[1] === 'jobs') {
        first = false;
        started.resolve();
        await scan.promise;
      }
      return original(...args);
    };
    const newcomer = create(),
      owner = create();
    const recovery = newcomer.recover();
    await started.promise;
    try {
      const job = await owner.enqueue(key, 'en', '1', 2);
      await until(() => locks.waiting.length > 0);
      scan.resolve();
      await recovery;
      await until(async () => (await store.local(scope, 'jobs', job.id)).status === 'complete');
    } finally {
      scan.resolve();
      await recovery;
    }
  }));
test('expired running work is still recovered without changing completed or paused work', () =>
  harness(async ({ store, create }) => {
    const running = { ...queued(), status: 'running', ownerId: crypto.randomUUID(), leaseUntil: 1 };
    const paused = { ...queued(), status: 'paused' },
      live = {
        ...queued(),
        status: 'running',
        ownerId: crypto.randomUUID(),
        leaseUntil: Date.now() + 90000
      };
    for (const job of [running, paused, live]) await store.putLocal(scope, 'jobs', job.id, job);
    await create().recover();
    assert.equal((await store.local(scope, 'jobs', running.id)).status, 'paused');
    assert.deepEqual(await store.local(scope, 'jobs', paused.id), paused);
    assert.deepEqual(await store.local(scope, 'jobs', live.id), live);
  }, false));
test('queue shutdown failure still waits for the active job checkpoint', async () => {
  const old = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'shutdown-failure'),
    started = deferred(),
    paused = deferred(),
    release = deferred();
  const update = store.updateLocal.bind(store);
  let settled = false,
    stops = 0;
  store.updateLocal = async (...args) => {
    const result = await update(...args);
    if (result?.status === 'paused') {
      paused.resolve();
      await release.promise;
    }
    return result;
  };
  const queue = new TranscriptionQueue(
    store,
    'guest',
    {
      prepare(signal) {
        started.resolve();
        return new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        );
      },
      dispose() {
        if (++stops === 1) throw Error('runtime cleanup failed');
      }
    },
    async () => new Float32Array(16000).fill(0.1)
  );
  let closing;
  try {
    await queue.enqueue(key, 'en', '1', 2);
    await started.promise;
    closing = queue.dispose().then(
      () => {
        settled = true;
        return null;
      },
      (error) => {
        settled = true;
        return error;
      }
    );
    await paused.promise;
    await tick();
    assert.equal(settled, false, 'cleanup failure must not short-circuit the checkpoint drain');
    release.resolve();
    const error = await closing;
    assert.ok(error);
    assert.match(error.message, /cleanup|shutdown/i);
  } finally {
    release.resolve();
    await closing;
    await queue.task;
    await store.close();
    if (old === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = old;
  }
});
