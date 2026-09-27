/** Production queue/client contracts with explicit event/worker/transaction doubles.
 * Native freeze and native Web Locks have a separate Chromium runner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindTranscriptionPageLifecycle } from '../../.cache/media-test-build/transcription-page-lifecycle.js';
import { MossClient } from '../../.cache/media-test-build/moss-client.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { MOSS } from '../../.cache/media-test-build/model-cache.js';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(check) {
  for (let i = 0; i < 300; i++) {
    if (await check()) return;
    await tick();
  }
  assert.fail('Expected lifecycle state was not reached');
}
class Page extends EventTarget {
  visibilityState = 'visible';
}
class Locks {
  held = false;
  pending = [];
  request(_name, options, fn) {
    if (options.ifAvailable && this.held) return Promise.resolve(fn(null));
    return new Promise((resolve, reject) => {
      const task = { options, fn, resolve, reject };
      task.abort = () => {
        this.pending = this.pending.filter((item) => item !== task);
        reject(options.signal.reason);
      };
      if (options.signal?.aborted) {
        task.abort();
        return;
      }
      options.signal?.addEventListener('abort', task.abort, { once: true });
      this.pending.push(task);
      this.pump();
    });
  }
  pump() {
    if (this.held || !this.pending.length) return;
    const task = this.pending.shift();
    task.options.signal?.removeEventListener('abort', task.abort);
    this.held = true;
    const finish = (result, failed) => {
      this.held = false;
      if (failed) task.reject(result);
      else task.resolve(result);
      this.pump();
    };
    Promise.resolve()
      .then(() => task.fn({}))
      .then(
        (v) => finish(v, false),
        (e) => finish(e, true)
      );
  }
}
async function harness(run) {
  const previous = new Map(
    ['document', 'window', 'IDBKeyRange'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key)
    ])
  );
  const oldLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  const page = new Page(),
    host = new EventTarget(),
    locks = new Locks(),
    errors = [];
  for (const [key, value] of [
    ['document', page],
    ['window', host],
    ['IDBKeyRange', RangeDouble]
  ])
    Object.defineProperty(globalThis, key, { configurable: true, value });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
  const store = new MediaStore(new TransactionFactory(), 'lifecycle-' + crypto.randomUUID());
  const queues = [];
  const queue = (engine) => {
    const q = new TranscriptionQueue(
      store,
      'guest',
      engine,
      async (_job, a, b) => new Float32Array(Math.ceil((b - a) * 16000)).fill(0.1),
      () => {},
      (error) => errors.push(error)
    );
    queues.push(q);
    return q;
  };
  const enqueue = (q) => q.enqueue('content:' + 'a'.repeat(64), 'ja', '1', 2);
  try {
    await run({ page, host, locks, store, queue, enqueue, errors });
  } finally {
    await Promise.all(queues.map((q) => q.dispose()));
    await store.close();
    for (const [key, descriptor] of previous)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    if (oldLocks) Object.defineProperty(navigator, 'locks', oldLocks);
    else delete navigator.locks;
  }
}
function engine() {
  const answer = deferred(),
    stop = deferred();
  const e = {
    started: false,
    stopping: false,
    interrupted: 0,
    async prepare() {},
    async transcribe() {
      e.started = true;
      await answer.promise;
      return '[0][S01]テスト[1]';
    },
    async dispose() {
      e.stopping = true;
      await stop.promise;
    },
    interrupt() {
      e.interrupted++;
      answer.resolve();
      stop.resolve();
    },
    finish() {
      answer.resolve();
      stop.resolve();
    },
    answer,
    stop
  };
  return e;
}

test('lifecycle observes hidden/freeze/pagehide, not blur, and unregisters', () => {
  const page = new Page(),
    host = new EventTarget(),
    events = [];
  const off = bindTranscriptionPageLifecycle(
    (v) => events.push(v),
    () => events.push('active'),
    page,
    host
  );
  host.dispatchEvent(new Event('blur'));
  page.visibilityState = 'hidden';
  page.dispatchEvent(new Event('visibilitychange'));
  page.dispatchEvent(new Event('freeze'));
  host.dispatchEvent(new Event('pagehide'));
  page.dispatchEvent(new Event('resume')); // Still hidden, not active.
  page.visibilityState = 'visible';
  host.dispatchEvent(new Event('pageshow'));
  assert.deepEqual(events, ['active', false, true, true, 'active']);
  off();
  page.dispatchEvent(new Event('freeze'));
  host.dispatchEvent(new Event('pagehide'));
  assert.equal(events.length, 5);
});
test('hidden at construction cannot admit or resume work', () =>
  harness(async (h) => {
    h.page.visibilityState = 'hidden';
    const e = engine(),
      q = h.queue(e);
    try {
      await assert.rejects(h.enqueue(q), /Return to this tab/);
      await assert.rejects(q.resume(crypto.randomUUID()), /Return to this tab/);
      assert.equal(e.started, false);
      assert.equal(h.locks.held, false);
    } finally {
      e.finish();
    }
  }));
test('hidden revokes a pending origin lock without claiming a job', () =>
  harness(async (h) => {
    const blocker = deferred();
    const blocking = h.locks.request('manabi-moss-inference', {}, () => blocker.promise);
    const e = engine(),
      q = h.queue(e);
    try {
      const j = await h.enqueue(q);
      await until(() => h.locks.pending.length === 1);
      h.page.visibilityState = 'hidden';
      h.page.dispatchEvent(new Event('visibilitychange'));
      await until(() => h.locks.pending.length === 0);
      blocker.resolve();
      await blocking;
      await tick();
      assert.equal(e.started, false);
      assert.equal((await h.store.local('guest', 'jobs', j.id)).status, 'queued');
      h.page.visibilityState = 'visible';
      h.page.dispatchEvent(new Event('visibilitychange'));
      await tick();
      assert.equal(e.started, false, 'visibility does not replay jobs');
    } finally {
      blocker.resolve();
      e.finish();
    }
  }));
test('hidden orderly shutdown retains the lock until engine disposal finishes', () =>
  harness(async (h) => {
    const e = engine(),
      q = h.queue(e);
    try {
      const j = await h.enqueue(q);
      await until(() => e.started);
      h.page.visibilityState = 'hidden';
      h.page.dispatchEvent(new Event('visibilitychange'));
      assert.equal(h.locks.held, true);
      e.answer.resolve();
      await until(() => e.stopping);
      assert.equal(h.locks.held, true);
      e.stop.resolve();
      await until(() => !h.locks.held);
      const saved = await h.store.local('guest', 'jobs', j.id);
      assert.equal(saved.status, 'paused');
      assert.equal(saved.nextWindow, 0);
      assert.equal(e.interrupted, 0);
    } finally {
      e.finish();
    }
  }));
test('freeze releases only after synchronous interruption, before a delayed checkpoint callback', () =>
  harness(async (h) => {
    const e = engine(),
      q = h.queue(e),
      delayed = deferred();
    const original = h.store.updateLocal.bind(h.store);
    try {
      const j = await h.enqueue(q);
      await until(() => e.started);
      // The pause transaction models callbacks that cannot run until thaw.
      h.store.updateLocal = async (...args) => {
        await delayed.promise;
        return original(...args);
      };
      h.page.dispatchEvent(new Event('freeze'));
      assert.equal(e.interrupted, 1);
      await until(() => !h.locks.held);
      assert.equal((await h.store.local('guest', 'jobs', j.id)).status, 'running');
      assert.equal(e.stopping, false, 'the old task is waiting for its storage callback');
      delayed.resolve();
      await until(() => e.stopping);
      assert.equal((await h.store.local('guest', 'jobs', j.id)).status, 'paused');
      assert.deepEqual(await h.store.tracks('guest', j.mediaKey), []);
    } finally {
      delayed.resolve();
      h.store.updateLocal = original;
      e.finish();
    }
  }));
test('a stale thawed pause cannot replace a successor owner or its completed result', () =>
  harness(async (h) => {
    const e = engine(),
      q = h.queue(e),
      delayed = deferred();
    const original = h.store.updateLocal.bind(h.store);
    try {
      const j = await h.enqueue(q);
      await until(() => e.started);
      h.store.updateLocal = async (...args) => {
        await delayed.promise;
        return original(...args);
      };
      h.page.dispatchEvent(new Event('freeze'));
      await until(() => !h.locks.held);
      const successor = crypto.randomUUID();
      await original('guest', 'jobs', j.id, (old) => ({
        ...old,
        ownerId: successor,
        error: 'successor state'
      }));
      delayed.resolve();
      await until(() => e.stopping);
      await tick();
      const saved = await h.store.local('guest', 'jobs', j.id);
      assert.equal(saved.ownerId, successor);
      assert.equal(saved.status, 'running');
      assert.equal(saved.error, 'successor state');
    } finally {
      delayed.resolve();
      h.store.updateLocal = original;
      e.finish();
    }
  }));
for (const mode of ['absent', 'throws'])
  test(`freeze never releases a custom engine without guaranteed interruption: ${mode}`, () =>
    harness(async (h) => {
      const e = engine(),
        q = h.queue(e);
      if (mode === 'absent') delete e.interrupt;
      else
        e.interrupt = () => {
          throw Error('could not stop');
        };
      try {
        await h.enqueue(q);
        await until(() => e.started);
        h.page.dispatchEvent(new Event('freeze'));
        await tick();
        assert.equal(h.locks.held, true);
        assert.equal(h.errors.length, mode === 'throws' ? 1 : 0);
      } finally {
        e.finish();
      }
    }));
test('pagehide can finish emergency retirement after workspace disposal has started', () =>
  harness(async (h) => {
    const e = engine(),
      q = h.queue(e);
    try {
      await h.enqueue(q);
      await until(() => e.started);
      const closing = q.dispose();
      h.host.dispatchEvent(new Event('pagehide'));
      assert.equal(e.interrupted, 1);
      await closing;
      assert.equal(h.locks.held, false);
      h.host.dispatchEvent(new Event('pagehide'));
      assert.equal(e.interrupted, 1);
    } finally {
      e.finish();
    }
  }));

class WorkerDouble extends EventTarget {
  static latest;
  stopped = 0;
  constructor() {
    super();
    WorkerDouble.latest = this;
  }
  postMessage(message) {
    this.last = message;
    if (message.type === 'prepare')
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent('message', {
            data: { id: message.id, type: 'ready', value: null }
          })
        )
      );
    // Intentionally no disposal acknowledgement: it must not need a timer.
  }
  terminate() {
    this.stopped++;
  }
}
test('client interruption terminates a retiring worker and fences queued preparation', async () => {
  const old = globalThis.Worker;
  globalThis.Worker = WorkerDouble;
  const client = new MossClient('/moss', new URL('https://test.invalid/worker.js'));
  const signal = new AbortController().signal;
  try {
    await client.prepare(signal, () => {});
    const worker = WorkerDouble.latest;
    const pending = client.transcribe(new Float32Array(160), signal);
    const rejects = assert.rejects(pending, { name: 'AbortError' });
    const retiring = client.dispose();
    const prepare = client.prepare(signal, () => {});
    const prepareRejects = assert.rejects(prepare, { name: 'AbortError' });
    client.interrupt();
    assert.equal(worker.stopped, 1);
    await Promise.all([rejects, prepareRejects, retiring]);
    client.interrupt();
    assert.equal(worker.stopped, 1);
    await client.prepare(signal, () => {});
    assert.notEqual(WorkerDouble.latest, worker);
  } finally {
    client.interrupt();
    await client.dispose();
    if (old === undefined) delete globalThis.Worker;
    else globalThis.Worker = old;
  }
});

test('frozen recovery yields its lock and cannot pause a successor when its transaction resumes', () =>
  harness(async (h) => {
    const e = engine(),
      q = h.queue(e),
      delayed = deferred();
    const original = h.store.updateLocal.bind(h.store);
    const id = crypto.randomUUID();
    const orphan = {
      version: 1,
      id,
      mediaKey: 'content:' + 'c'.repeat(64),
      language: 'ja',
      audioTrack: '1',
      duration: 2,
      status: 'running',
      nextWindow: 0,
      cues: [],
      modelSha256: MOSS.sha256,
      engineRevision: MOSS.engineRevision,
      createdAt: 1,
      ownerId: crypto.randomUUID(),
      leaseUntil: Date.now() + 90000
    };
    let entered = false;
    try {
      await h.store.putLocal('guest', 'jobs', id, orphan);
      h.store.updateLocal = async (...args) => {
        entered = true;
        await delayed.promise;
        return original(...args);
      };
      const recovery = q.recover();
      await until(() => entered);
      assert.equal(h.locks.held, true);
      h.page.dispatchEvent(new Event('freeze'));
      await until(() => !h.locks.held);
      const successor = crypto.randomUUID();
      await original('guest', 'jobs', id, (old) => ({ ...old, ownerId: successor }));
      h.page.visibilityState = 'visible';
      h.page.dispatchEvent(new Event('resume'));
      delayed.resolve();
      await recovery;
      const saved = await h.store.local('guest', 'jobs', id);
      assert.equal(saved.ownerId, successor);
      assert.equal(saved.status, 'running');
      assert.equal(e.started, false);
    } finally {
      delayed.resolve();
      h.store.updateLocal = original;
      e.finish();
    }
  }));

test('a hidden page does not acquire an orphan-recovery lock', () =>
  harness(async (h) => {
    h.page.visibilityState = 'hidden';
    const e = engine(),
      q = h.queue(e);
    try {
      await q.recover();
      assert.equal(h.locks.held, false);
      assert.equal(h.locks.pending.length, 0);
    } finally {
      e.finish();
    }
  }));
