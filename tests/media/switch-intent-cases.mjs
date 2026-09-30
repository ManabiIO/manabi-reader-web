/** Production queue/store with controlled scheduling and recognition, not model evidence. */
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
const key = 'content:' + 'd'.repeat(64);
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { resolve, promise };
};
const equal = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
};
async function harness(factory, run) {
  const store = new MediaStore(factory, 'switch-intent-' + crypto.randomUUID());
  const started = deferred(),
    releases = [];
  let calls = 0;
  const queue = new TranscriptionQueue(
    store,
    'guest',
    {
      prepare: async () => {},
      transcribe: async (_pcm, signal) => {
        calls++;
        started.resolve();
        return await new Promise((_, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      dispose() {}
    },
    async () => new Float32Array(32000).fill(0.1)
  );
  // Prevent an incorrectly non-cancelling scenario from hanging the test worker.
  const timer = setTimeout(() => releases.forEach((r) => r()), 3000);
  try {
    const job = await queue.enqueue(key, 'ja', '1', 2, 0);
    await started.promise;
    return await run({ store, queue, job, releases, calls: () => calls });
  } finally {
    clearTimeout(timer);
    releases.forEach((r) => r());
    await queue.dispose();
    await store.close();
  }
}
export const cases = [];
for (const stage of ['scan', 'write']) {
  cases.push({
    name: `A replaced video-switch intent cannot pause a runner after delayed ${stage}`,
    run: (factory) =>
      harness(factory, async ({ store, queue, job, releases, calls }) => {
        const entered = deferred(),
          release = deferred();
        releases.push(release.resolve);
        const method = stage === 'scan' ? 'listLocal' : 'updateLocal';
        const original = store[method].bind(store);
        let current = true,
          held = false;
        store[method] = async (...args) => {
          if (!held && args[1] === 'jobs') {
            held = true;
            entered.resolve();
            await release.promise;
          }
          return original(...args);
        };
        const before = await store.local('guest', 'jobs', job.id);
        const pausing = queue.pauseSparseForMedia(key, () => current);
        await entered.promise;
        current = false;
        release.resolve();
        const ids = await pausing;
        equal(
          await store.local('guest', 'jobs', job.id),
          before,
          'A stale switch changed its runner'
        );
        equal(ids, [], 'A stale switch claimed to pause work');
        equal(calls(), 1, 'Unexpected inference restart');
        store[method] = original;
        return { unchanged: true, stage, calls: calls() };
      })
  });
}
cases.push({
  name: 'A fresh Generate of the same running job supersedes an older pending switch scan',
  run: (factory) =>
    harness(factory, async ({ store, queue, job, releases }) => {
      const entered = deferred(),
        release = deferred();
      releases.push(release.resolve);
      const list = store.listLocal.bind(store);
      let held = false;
      store.listLocal = async (...args) => {
        if (!held && args[1] === 'jobs') {
          held = true;
          entered.resolve();
          await release.promise;
        }
        return list(...args);
      };
      const before = await store.local('guest', 'jobs', job.id);
      const pausing = queue.pauseSparseForMedia(key);
      await entered.promise;
      const requested = await queue.enqueue(key, 'ja', '1', 2, 0);
      equal(requested.id, job.id, 'Generate should deduplicate the running job');
      release.resolve();
      equal(await pausing, [], 'Old switch revoked the newer Generate admission');
      equal(
        await store.local('guest', 'jobs', job.id),
        before,
        'Old switch paused newer user intent'
      );
      store.listLocal = list;
      return { sameJob: true, supersededSwitch: true };
    })
});
cases.push({
  name: 'A current switch still pauses its owned runner and preserves the job',
  run: (factory) =>
    harness(factory, async ({ store, queue, job }) => {
      equal(
        await queue.pauseSparseForMedia(key, () => true),
        [job.id],
        'Current switch did not pause'
      );
      await queue.task;
      const saved = await store.local('guest', 'jobs', job.id);
      equal(saved.status, 'paused', 'Job must remain resumable');
      equal(saved.pauseReason, 'switch', 'Switch is not an explicit user cancel');
      equal(await store.tracks('guest', key), [], 'Paused work was published');
      return { status: saved.status, reason: saved.pauseReason };
    })
});

cases.push({
  name: 'A current switch after repeated Generate still pauses the existing runner',
  run: (factory) =>
    harness(factory, async ({ store, queue, job }) => {
      const requested = await queue.enqueue(key, 'ja', '1', 2, 0);
      equal(requested.id, job.id, 'Repeated Generate must reuse its runner');
      equal(
        await queue.pauseSparseForMedia(key),
        [job.id],
        'Current switch did not retire both local admissions'
      );
      await queue.task;
      const saved = await store.local('guest', 'jobs', job.id);
      equal(saved.status, 'paused', 'Repeated Generate hid a live runner from the switch');
      equal(saved.pauseReason, 'switch', 'Wrong pause intent');
      return { sameJob: true, paused: true };
    })
});
