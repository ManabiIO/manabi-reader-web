/** Real queue/store algorithms; storage and recognition are explicit test doubles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';
const key = 'content:' + '7'.repeat(64),
  scope = 'guest';
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(fn) {
  for (let i = 0; i < 500; i++) {
    if (await fn()) return;
    await tick();
  }
  throw Error('Queue did not settle');
}
async function harness(decode, body) {
  const old = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'preflight-tests'),
    events = [];
  const engine = {
    async prepare() {
      events.push('prepare');
    },
    async transcribe() {
      events.push('inference');
      return '[0][S01]テストです。[1]';
    },
    dispose() {
      events.push('dispose');
    }
  };
  const queue = new TranscriptionQueue(store, scope, engine, async (...args) => {
    events.push('decode');
    return decode(...args);
  });
  try {
    await body({ queue, store, events });
  } finally {
    await queue.dispose();
    await store.close();
    if (old === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = old;
  }
}
async function final(store, id) {
  await until(async () =>
    ['complete', 'failed', 'paused'].includes((await store.local(scope, 'jobs', id))?.status)
  );
  return store.local(scope, 'jobs', id);
}
test('missing source or unsupported decode must fail before loading model weights', () =>
  harness(
    async () => {
      throw Error('Source unavailable');
    },
    async ({ queue, store, events }) => {
      const job = await queue.enqueue(key, 'ja', '1', 2);
      const done = await final(store, job.id);
      assert.equal(done.status, 'failed');
      assert.match(done.error, /Source unavailable/);
      assert.equal(events.includes('prepare'), false);
      assert.equal(events.includes('inference'), false);
    }
  ));
test('invalid decoded PCM cannot trigger a model download', () =>
  harness(
    async () => new Float32Array([NaN]),
    async ({ queue, store, events }) => {
      const job = await queue.enqueue(key, 'ja', '1', 2);
      assert.equal((await final(store, job.id)).status, 'failed');
      assert.equal(events.includes('prepare'), false);
    }
  ));
test('exactly silent audio publishes an empty complete track without preparing MOSS', () =>
  harness(
    async () => new Float32Array(32000),
    async ({ queue, store, events }) => {
      const job = await queue.enqueue(key, 'ja', '1', 2);
      assert.equal((await final(store, job.id)).status, 'complete');
      const [track] = await store.tracks(scope, key);
      assert.ok(track.complete);
      assert.deepEqual(track.cues, []);
      assert.equal(events.includes('prepare'), false);
      assert.equal(events.includes('inference'), false);
    }
  ));
test('first nonsilent window prepares lazily and later windows reuse the prepared batch', () => {
  let calls = 0;
  return harness(
    async () => new Float32Array(16000).fill(++calls === 1 ? 0 : 0.1),
    async ({ queue, store, events }) => {
      const job = await queue.enqueue(key, 'ja', '1', 121);
      assert.equal((await final(store, job.id)).status, 'complete');
      assert.deepEqual(
        events.filter((x) => x !== 'dispose'),
        ['decode', 'decode', 'prepare', 'inference', 'decode', 'prepare', 'inference']
      );
    }
  );
});
test('cancel during initial source preparation never starts model preparation', async () => {
  let release,
    started = false;
  await harness(
    async (_job, _start, _end, signal) => {
      started = true;
      await new Promise((r) => (release = r));
      signal.throwIfAborted();
      return new Float32Array(32000).fill(0.1);
    },
    async ({ queue, store, events }) => {
      const job = await queue.enqueue(key, 'ja', '1', 2);
      try {
        await until(() => started);
        await queue.cancel(job.id);
        release();
        assert.equal((await final(store, job.id)).status, 'paused');
        assert.equal(events.includes('prepare'), false);
      } finally {
        release?.();
      }
    }
  );
});
