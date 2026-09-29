/** Actual legacy queue and store; scripted inference and deterministic transaction boundaries. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { MOSS } from '../../.cache/media-test-build/model-cache.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';

const prefix = '[2][S01]日本語[3][3][S01]続き',
  final = prefix + '[4]';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(check) {
  for (let i = 0; i < 300; i++) {
    if (await check()) return;
    await tick();
  }
  throw new Error('Expected queue state was not reached');
}
async function harness(transcribe, body, duration = 65) {
  const previousRange = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'legacy-preview'),
    events = [];
  const job = {
    version: 1,
    id: crypto.randomUUID(),
    mediaKey: 'content:' + 'a'.repeat(64),
    language: 'ja',
    audioTrack: '1',
    duration,
    status: 'paused',
    nextWindow: 0,
    cues: [],
    modelSha256: MOSS.sha256,
    engineRevision: MOSS.engineRevision,
    createdAt: 1
  };
  const queue = new TranscriptionQueue(
    store,
    'guest',
    { prepare: async () => {}, transcribe, dispose() {} },
    async (_job, a, b) => new Float32Array(Math.round((b - a) * 16000)).fill(0.1),
    (p) => events.push(structuredClone(p))
  );
  try {
    await store.putLocal('guest', 'jobs', job.id, job);
    await queue.resume(job.id);
    await body({
      store,
      queue,
      job,
      events,
      saved: () => store.local('guest', 'jobs', job.id)
    });
  } finally {
    await queue.dispose();
    await store.close();
    if (previousRange === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = previousRange;
  }
}

test('legacy callbacks are closed between windows and after completion', async () => {
  let first,
    last,
    calls = 0;
  await harness(
    async (_pcm, _signal, partial) => {
      if (calls++ === 0) first = partial;
      else first(prefix);
      last = partial;
      partial(prefix);
      return final;
    },
    async ({ events, saved, store, job }) => {
      await until(async () => (await saved()).status === 'complete');
      assert.equal(calls, 2);
      assert.deepEqual(
        events.filter((p) => p.provisional).map((p) => p.loaded),
        [0, 1]
      );
      const count = events.length;
      first(prefix);
      last(prefix);
      assert.equal(events.length, count);
      const [track] = await store.tracks('guest', job.mediaKey);
      assert.deepEqual(
        track.cues.map((c) => c.start),
        [2, 3, 60, 61]
      );
    }
  );
});

test('legacy malformed previews do not discard good recognition or poison the next window', async () => {
  let calls = 0;
  await harness(
    async (_pcm, _signal, partial) => {
      if (calls++ === 0) partial(null);
      partial(prefix);
      return final;
    },
    async ({ events, saved, store, job }) => {
      await until(async () => ['complete', 'failed'].includes((await saved()).status));
      assert.equal((await saved()).status, 'complete');
      assert.equal(calls, 2);
      assert.deepEqual(
        events.filter((p) => p.provisional).map((p) => p.loaded),
        [1]
      );
      const tracks = await store.tracks('guest', job.mediaKey);
      assert.equal(tracks.length, 1);
      assert.equal(tracks[0].complete, true);
      assert.equal(tracks[0].cues.length, 4);
    }
  );
});

test('legacy callbacks after cancellation are inert and cannot publish a completed track', async () => {
  let preview, finish;
  await harness(
    async (_pcm, _signal, partial) => {
      preview = partial;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    async ({ queue, job, events, saved, store }) => {
      await until(() => !!preview);
      try {
        await queue.cancel(job.id);
        const count = events.length;
        assert.doesNotThrow(() => preview(prefix));
        assert.equal(events.length, count);
      } finally {
        finish(final);
      }
      await until(async () => (await saved()).status === 'paused');
      assert.equal((await saved()).nextWindow, 0);
      assert.deepEqual((await saved()).cues, []);
      assert.deepEqual(await store.tracks('guest', job.mediaKey), []);
    },
    2
  );
});
