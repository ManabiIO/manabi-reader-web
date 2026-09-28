import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { validateJob } from '../../.cache/media-test-build/jobs.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';

const provisional = 'content:' + 'a'.repeat(64);
const verified = 'content:' + 'b'.repeat(64);
const wrong = 'content:' + 'c'.repeat(64);
const sample = 'sampled-v1:' + 'd'.repeat(64);
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
async function until(check) {
  for (let n = 0; n < 500; n++) {
    const value = await check();
    if (value) return value;
    await tick();
  }
  throw new Error('Provisional transcription did not settle');
}
async function withQueue(transcribe, body) {
  const prior = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'provisional-identity');
  let inferences = 0;
  const queue = new TranscriptionQueue(
    store,
    'guest',
    {
      async prepare() {},
      async transcribe(...args) {
        inferences++;
        return transcribe(...args);
      },
      dispose() {}
    },
    async (_job, start, end) =>
      new Float32Array(Math.ceil(end * 16000) - Math.round(start * 16000)).fill(0.1)
  );
  try {
    await body({ queue, store, inferences: () => inferences });
  } finally {
    await queue.dispose();
    await store.close();
    if (prior === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = prior;
  }
}

test('a local provisional job keeps its window but cannot publish before full verification', () =>
  withQueue(
    async () => '[1][S01]字幕です。[2]',
    async ({ queue, store, inferences }) => {
      const initial = await queue.enqueue(provisional, 'ja', '1', 12, 0, true);
      const pending = await until(async () => {
        const job = await store.local('guest', 'jobs', initial.id);
        return job?.status === 'paused' && job.pauseReason === 'identity' ? job : undefined;
      });
      assert.equal(pending.nextWindow, 1);
      assert.equal(pending.cues.length, 1);
      assert.equal(inferences(), 1);
      assert.deepEqual(await store.tracks('guest', provisional), []);
      assert.deepEqual(await store.tracks('guest', verified), []);
      await assert.rejects(queue.resume(initial.id), /full video verification/);
      await queue.verifyProvisional(provisional, verified);
      await assert.rejects(queue.verifyProvisional(provisional, wrong), /belongs to another video/);
      await queue.resume(initial.id);
      await until(
        async () => (await store.local('guest', 'jobs', initial.id))?.status === 'complete'
      );
      const [track] = await store.tracks('guest', verified);
      assert.equal(track.id, initial.id);
      assert.equal(track.complete, true);
      assert.equal(track.cues[0].text, '字幕です。');
      assert.equal(
        inferences(),
        1,
        'verification must publish the saved window without repeating ASR'
      );
      assert.deepEqual(await store.tracks('guest', provisional), []);
    }
  ));

test('verification during inference survives the next checkpoint and publishes once', () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  return withQueue(
    async () => held,
    async ({ queue, store, inferences }) => {
      const initial = await queue.enqueue(provisional, 'ja', '1', 12, 0, true);
      try {
        await until(() => inferences() === 1);
        await queue.verifyProvisional(provisional, verified);
      } finally {
        release('[1][S01]検証済み。[2]');
      }
      await until(
        async () => (await store.local('guest', 'jobs', initial.id))?.status === 'complete'
      );
      const [track] = await store.tracks('guest', verified);
      assert.equal(track.cues[0].text, '検証済み。');
      assert.equal(inferences(), 1);
    }
  );
});

test('recovery proof is checkpointed with its window and removed after publication', () =>
  withQueue(
    async () => '[1][S01]字幕です。[2]',
    async ({ queue, store }) => {
      const initial = await queue.enqueue(provisional, 'ja', '1', 12, 0, true, sample);
      const pending = await until(async () => {
        const job = await store.local('guest', 'jobs', initial.id);
        return job?.pauseReason === 'identity' ? job : undefined;
      });
      assert.equal(pending.sourceSample, sample);
      assert.equal(pending.audioProofs.length, 1);
      assert.equal(pending.audioProofs[0].start, 0);
      assert.equal(pending.audioProofs[0].end, 12);
      assert.match(pending.audioProofs[0].digest, /^[a-f0-9]{64}$/);
      assert.throws(
        () => validateJob({ ...pending, audioProofs: [] }),
        /Missing saved audio proof/
      );
      assert.throws(
        () =>
          validateJob({
            ...pending,
            audioProofs: [{ ...pending.audioProofs[0], start: 1 }]
          }),
        /Audio proof does not belong/
      );
      await queue.verifyProvisional(provisional, verified);
      await queue.resume(initial.id);
      const completed = await until(async () => {
        const job = await store.local('guest', 'jobs', initial.id);
        return job?.status === 'complete' ? job : undefined;
      });
      assert.equal(completed.audioProofs, undefined);
      assert.equal(completed.sourceSample, undefined);
    }
  ));

test('recovery cannot attach a job whose saved audio proof changed during comparison', () =>
  withQueue(
    async () => '[1][S01]字幕です。[2]',
    async ({ queue, store }) => {
      const initial = await queue.enqueue(provisional, 'ja', '1', 12, 0, true, sample);
      const pending = await until(async () => {
        const job = await store.local('guest', 'jobs', initial.id);
        return job?.pauseReason === 'identity' ? job : undefined;
      });
      await store.updateLocal('guest', 'jobs', initial.id, (job) => ({
        ...job,
        audioProofs: [{ ...job.audioProofs[0], digest: 'e'.repeat(64) }]
      }));
      await assert.rejects(
        queue.verifyProvisional(provisional, verified, initial.id, pending),
        /cancelled or taken over/
      );
      assert.equal((await store.local('guest', 'jobs', initial.id)).verifiedMediaKey, undefined);
    }
  ));

test('a recovered sparse job proves normal windows and its seam repair', () => {
  const responses = [
    '[3][S01]accepted[4][24][S01]left[27]',
    '[0][S01]right[3]',
    '[3][S01]accepted[4][24][S01]repaired[27]'
  ];
  return withQueue(
    async () => responses.shift(),
    async ({ queue, store, inferences }) => {
      const initial = await queue.enqueue(provisional, 'ja', '1', 52, 0, true, sample);
      const pending = await until(async () => {
        const job = await store.local('guest', 'jobs', initial.id);
        return job?.pauseReason === 'identity' ? job : undefined;
      });
      assert.equal(pending.nextWindow, 2);
      assert.ok(pending.sparse.repairs[0]);
      assert.deepEqual(
        pending.audioProofs.map((proof) => [proof.start, proof.end]),
        [
          [0, 28],
          [24, 52],
          [0, 52]
        ]
      );
      await queue.verifyProvisional(provisional, verified);
      await queue.resume(initial.id);
      await until(
        async () => (await store.local('guest', 'jobs', initial.id))?.status === 'complete'
      );
      assert.equal(inferences(), 3);
      assert.deepEqual(
        (await store.tracks('guest', verified))[0].cues.map((cue) => cue.text),
        ['accepted', 'repaired']
      );
    }
  );
});
