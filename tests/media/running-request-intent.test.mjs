import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';

const key = 'content:' + '9'.repeat(64);
async function harness(run) {
  const previous = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'running-intent-' + crypto.randomUUID());
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const counters = { decode: 0, prepare: 0, transcribe: 0 };
  const queue = new TranscriptionQueue(
    store,
    'guest',
    {
      async prepare() {
        counters.prepare++;
      },
      async transcribe(_pcm, signal) {
        counters.transcribe++;
        started();
        return await new Promise((_, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      dispose() {}
    },
    async () => {
      counters.decode++;
      return new Float32Array(32000).fill(0.1);
    }
  );
  try {
    const job = await queue.enqueue(key, 'ja', '1', 2, 0);
    await ready;
    await run({ store, queue, job, counters });
  } finally {
    await queue.dispose();
    await store.close();
    if (previous === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = previous;
  }
}

test('repeated Generate refreshes its live runner intent without a second runnable admission', () =>
  harness(async ({ queue, job, counters }) => {
    const active = queue.active,
      oldIntent = active.admission;
    let kicks = 0;
    const kick = queue.kick;
    queue.kick = () => kicks++;
    try {
      const observed = await queue.enqueue(key, 'ja', '1', 2, 0);
      assert.equal(observed.id, job.id);
      assert.equal(queue.active, active);
      assert.notEqual(active.admission, oldIntent);
      assert.equal(queue.admitted.size, 0);
      assert.equal(kicks, 0);
      assert.equal(active.controller.signal.aborted, false);
      assert.deepEqual(counters, { decode: 1, prepare: 1, transcribe: 1 });
    } finally {
      queue.kick = kick;
    }
  }));

test('a stale Generate observation cannot refresh the running intent', () =>
  harness(async ({ queue, job }) => {
    const active = queue.active,
      intent = active.admission;
    const observed = await queue.enqueue(key, 'ja', '1', 2, 0, false, undefined, () => false);
    assert.equal(observed.id, job.id);
    assert.equal(active.admission, intent);
    assert.equal(queue.admitted.size, 0);
    assert.equal(active.controller.signal.aborted, false);
  }));

test('observing another queue running the same job grants no execution or switch authority', () =>
  harness(async ({ store, queue, job, counters }) => {
    let calls = 0;
    const observer = new TranscriptionQueue(
      store,
      'guest',
      {
        async prepare() {
          calls++;
        },
        async transcribe() {
          calls++;
          return '';
        },
        dispose() {}
      },
      async () => {
        calls++;
        return new Float32Array(32000);
      }
    );
    const active = queue.active,
      intent = active.admission;
    try {
      const observed = await observer.enqueue(key, 'ja', '1', 2, 0);
      assert.equal(observed.id, job.id);
      assert.equal(observer.admitted.size, 0);
      assert.equal(observer.active, undefined);
      assert.deepEqual(await observer.pauseForMedia(key), []);
      assert.equal(active.admission, intent);
      assert.equal(active.controller.signal.aborted, false);
      assert.equal(calls, 0);
      assert.deepEqual(counters, { decode: 1, prepare: 1, transcribe: 1 });
    } finally {
      await observer.dispose();
    }
  }));
