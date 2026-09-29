import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';

const key = 'content:' + '7'.repeat(64);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function until(read) {
  for (let n = 0; n < 500; n++) {
    const value = await read();
    if (value) return value;
    await tick();
  }
  assert.fail('Expected queue state was not reached');
}
async function withStore(name, run) {
  const previous = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), name + crypto.randomUUID());
  try {
    await run(store);
  } finally {
    await store.close();
    if (previous === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = previous;
  }
}

test('delayed source revocation cannot delete a newer queued admission for the same job', () =>
  withStore('pause-token-', async (store) => {
    let calls = 0;
    const queue = new TranscriptionQueue(
      store,
      'guest',
      {
        async prepare() {},
        async transcribe() {
          calls++;
          return '[0][S01]字幕です。[1]';
        },
        dispose() {}
      },
      async (_job, start, end) => new Float32Array(Math.ceil((end - start) * 16000)).fill(0.1)
    );
    const realKick = queue.kick.bind(queue);
    queue.kick = () => {};
    try {
      const job = await queue.enqueue(key, 'ja', '1', 2);
      const gate = deferred();
      const original = store.listLocal.bind(store);
      let held = false;
      store.listLocal = async (...args) => {
        if (!held) {
          held = true;
          await gate.promise;
        }
        return original(...args);
      };
      const pausing = queue.pauseForMedia(key);
      for (let n = 0; n < 50 && !held; n++) await tick();
      assert.equal(held, true);
      const resumed = await queue.resume(job.id);
      assert.equal(resumed.id, job.id);
      gate.resolve();
      assert.deepEqual(await pausing, [], 'stale revocation still owned the replacement admission');
      store.listLocal = original;
      queue.kick = realKick;
      realKick();
      await until(async () => (await store.local('guest', 'jobs', job.id))?.status === 'complete');
      assert.equal(calls, 1);
      assert.equal((await store.tracks('guest', key)).length, 1);
    } finally {
      queue.kick = realKick;
      await queue.dispose();
    }
  }));

test('delayed source revocation cannot abort a successor owner with the same job ID', () =>
  withStore('pause-owner-', async (store) => {
    const first = deferred();
    const secondFinish = deferred();
    const secondStarted = deferred();
    let calls = 0;
    const queue = new TranscriptionQueue(
      store,
      'guest',
      {
        async prepare() {},
        async transcribe(_pcm, signal) {
          calls++;
          if (calls === 1) {
            await first.promise;
            throw new Error('scripted first owner failure');
          }
          secondStarted.resolve();
          await Promise.race([
            secondFinish.promise,
            new Promise((_, reject) => {
              if (signal.aborted) reject(signal.reason);
              else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            })
          ]);
          return '[0][S01]後続です。[1]';
        },
        dispose() {}
      },
      async (_job, start, end) => new Float32Array(Math.ceil((end - start) * 16000)).fill(0.1)
    );
    try {
      const job = await queue.enqueue(key, 'ja', '1', 2);
      await until(async () => (await store.local('guest', 'jobs', job.id))?.status === 'running');
      const gate = deferred();
      const original = store.listLocal.bind(store);
      let held = false;
      store.listLocal = async (...args) => {
        if (!held) {
          held = true;
          await gate.promise;
        }
        return original(...args);
      };
      const pausing = queue.pauseForMedia(key);
      for (let n = 0; n < 50 && !held; n++) await tick();
      assert.equal(held, true);
      first.resolve();
      await until(async () => (await store.local('guest', 'jobs', job.id))?.status === 'failed');
      await queue.resume(job.id);
      await secondStarted.promise;
      gate.resolve();
      assert.deepEqual(await pausing, [], 'stale revocation captured the successor owner');
      secondFinish.resolve();
      await until(async () => (await store.local('guest', 'jobs', job.id))?.status === 'complete');
      assert.equal(calls, 2);
      assert.equal((await store.tracks('guest', key)).length, 1);
    } finally {
      first.resolve();
      secondFinish.resolve();
      await queue.dispose();
    }
  }));

test('queued admission that becomes active while revocation is scanning is still paused', () =>
  withStore('pause-claim-transition-', async (store) => {
    const started = deferred();
    let calls = 0;
    const queue = new TranscriptionQueue(
      store,
      'guest',
      {
        async prepare() {},
        async transcribe(_pcm, signal) {
          calls++;
          started.resolve();
          return await new Promise((_, reject) => {
            if (signal.aborted) reject(signal.reason);
            else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
        dispose() {}
      },
      async (_job, start, end) => new Float32Array(Math.ceil((end - start) * 16000)).fill(0.1)
    );
    const realKick = queue.kick.bind(queue);
    queue.kick = () => {};
    try {
      const job = await queue.enqueue(key, 'ja', '1', 2);
      const gate = deferred();
      const original = store.listLocal.bind(store);
      let scans = 0;
      store.listLocal = async (...args) => {
        scans++;
        if (scans === 1) await gate.promise;
        return original(...args);
      };

      const pausing = queue.pauseForMedia(key);
      await until(() => scans === 1);
      queue.kick = realKick;
      realKick();
      await started.promise;
      gate.resolve();

      assert.deepEqual(await pausing, [job.id]);
      await until(async () => (await store.local('guest', 'jobs', job.id))?.status === 'paused');
      const saved = await store.local('guest', 'jobs', job.id);
      assert.equal(saved.pauseReason, 'switch');
      assert.equal(saved.nextWindow, 0);
      assert.equal(calls, 1);
      assert.equal((await store.tracks('guest', key)).length, 0);
    } finally {
      queue.kick = realKick;
      await queue.dispose();
    }
  }));

test('throwing automatic-resume lifetime fails closed without changing the saved job', () =>
  withStore('resume-lifetime-throw-', async (store) => {
    const queue = new TranscriptionQueue(
      store,
      'guest',
      { dispose() {} },
      async () => new Float32Array(1)
    );
    const realKick = queue.kick.bind(queue);
    queue.kick = () => {};
    try {
      const job = await queue.enqueue(key, 'ja', '1', 2);
      const paused = await store.updateLocal('guest', 'jobs', job.id, (old) => ({
        ...old,
        status: 'paused',
        pauseReason: 'switch'
      }));
      const result = await queue.resume(job.id, {
        mediaKey: key,
        expected: 'switch',
        isCurrent() {
          throw new Error('stale player lifetime');
        }
      });
      assert.equal(result, undefined);
      assert.deepEqual(await store.local('guest', 'jobs', job.id), paused);
    } finally {
      queue.kick = realKick;
      await queue.dispose();
    }
  }));

test('throwing pause lifetime cannot mutate or revoke a queued admission', () =>
  withStore('pause-lifetime-throw-', async (store) => {
    const queue = new TranscriptionQueue(
      store,
      'guest',
      { dispose() {} },
      async () => new Float32Array(1)
    );
    const realKick = queue.kick.bind(queue);
    queue.kick = () => {};
    try {
      const job = await queue.enqueue(key, 'ja', '1', 2);
      assert.deepEqual(
        await queue.pauseSparseForMedia(key, () => {
          throw new Error('stale switch lifetime');
        }),
        []
      );
      const saved = await store.local('guest', 'jobs', job.id);
      assert.equal(saved.status, 'queued');
      assert.equal(saved.pauseReason, undefined);
      assert.equal(queue.admitted.has(job.id), true);
    } finally {
      queue.kick = realKick;
      await queue.dispose();
    }
  }));
