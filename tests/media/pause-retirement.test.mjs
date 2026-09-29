import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';

const key = 'content:' + 'b'.repeat(64);
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
async function scenario(method, superseded) {
  const previous = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), crypto.randomUUID());
  const started = deferred(),
    release = deferred(),
    entered = deferred();
  let signal;
  const queue = new TranscriptionQueue(
    store,
    'guest',
    {
      async prepare() {},
      async transcribe(_pcm, current) {
        signal = current;
        started.resolve();
        return await new Promise((_, reject) => {
          if (current.aborted) reject(current.reason);
          else current.addEventListener('abort', () => reject(current.reason), { once: true });
        });
      },
      dispose() {}
    },
    async () => new Float32Array(32000).fill(0.1)
  );
  const update = store.updateLocal.bind(store);
  try {
    const job = await queue.enqueue(key, 'ja', '1', 2, 0);
    await started.promise;
    const failure = new Error('pause checkpoint unavailable');
    let held = false;
    store.updateLocal = async (...args) => {
      if (args[1] === 'jobs' && !held) {
        held = true;
        entered.resolve();
        await release.promise;
        throw failure;
      }
      return update(...args);
    };
    const pausing = queue[method](key);
    const result = pausing.then(
      () => undefined,
      (error) => error
    );
    await entered.promise;
    if (superseded) assert.equal((await queue.enqueue(key, 'ja', '1', 2, 0)).id, job.id);
    release.resolve();
    assert.equal(await result, failure, 'preserve the real storage failure');
    assert.equal(
      signal.aborted,
      !superseded,
      superseded
        ? 'stale failed pause must not abort newer admission'
        : 'storage failure must not prevent model cancellation'
    );
    assert.equal((await store.tracks('guest', key)).length, 0);
  } finally {
    release.resolve();
    store.updateLocal = update;
    await queue.dispose();
    await store.close();
    if (previous === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = previous;
  }
}
for (const method of ['pauseSparseForMedia', 'pauseForMedia']) {
  test(`${method}: failed checkpoint still cancels the captured inference`, () =>
    scenario(method, false));
  test(`${method}: failed old checkpoint cannot cancel a newer same-job admission`, () =>
    scenario(method, true));
}
