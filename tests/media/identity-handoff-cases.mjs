/** Production queue/store handoff scenarios shared by Node and native IndexedDB.
 * Recognition and controlled storage delays are scripted, never real-model evidence.
 */
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { jobCanResume, releasedJob } from '../../.cache/media-test-build/jobs.js';
import { MOSS } from '../../.cache/media-test-build/model-cache.js';
import { newSparseState } from '../../.cache/media-test-build/sparse-transcription.js';

const localKey = 'content:' + 'a'.repeat(64),
  verifiedKey = 'content:' + 'b'.repeat(64),
  otherKey = 'content:' + 'c'.repeat(64);
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function equal(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
async function until(read) {
  for (let n = 0; n < 1000; n++) {
    const value = await read();
    if (value) return value;
    await tick();
  }
  throw new Error('Identity handoff did not reach its expected state');
}
function abortableInference(_pcm, signal) {
  signal.throwIfAborted();
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}
function savedJob(reason = 'identity') {
  return {
    version: 3,
    sparse: newSparseState(2),
    provisional: true,
    mediaKey: localKey,
    verifiedMediaKey: verifiedKey,
    id: crypto.randomUUID(),
    language: 'ja',
    audioTrack: '1',
    duration: 2,
    status: 'paused',
    pauseReason: reason,
    nextWindow: 0,
    cues: [],
    modelSha256: MOSS.sha256,
    engineRevision: MOSS.engineRevision,
    createdAt: 1
  };
}
async function harness(factory, run) {
  const store = new MediaStore(factory, 'identity-handoff-' + crypto.randomUUID());
  const queues = [],
    releases = [];
  let calls = 0;
  const queue = (transcribe = async () => '[0][S01]保存する字幕[1]') => {
    const q = new TranscriptionQueue(
      store,
      'guest',
      {
        async prepare() {},
        async transcribe(...args) {
          calls++;
          return await transcribe(...args);
        },
        dispose() {}
      },
      async (_job, start, end) =>
        new Float32Array(Math.ceil(end * 16000) - Math.round(start * 16000)).fill(0.1)
    );
    queues.push(q);
    return q;
  };
  const hold = () => {
    const gate = deferred();
    releases.push(gate.resolve);
    return gate;
  };
  try {
    return await run({
      store,
      queue,
      hold,
      calls: () => calls,
      saved: (id) => store.local('guest', 'jobs', id)
    });
  } finally {
    releases.forEach((release) => release());
    await Promise.all(queues.map((q) => q.dispose()));
    await store.close();
  }
}

export const cases = [];
for (const key of [localKey, verifiedKey])
  cases.push({
    name: `a verified provisional runner pauses through its ${key === localKey ? 'original' : 'verified'} key`,
    run: (factory) =>
      harness(factory, async (h) => {
        const q = h.queue(abortableInference);
        const j = await q.enqueue(localKey, 'ja', '1', 40, 0, true);
        await until(() => h.calls() === 1);
        await q.verifyProvisional(localKey, verifiedKey);
        const ids = await q.pauseSparseForMedia(key);
        equal(ids, [j.id], 'the switch must find this exact runner');
        const paused = await until(async () => {
          const s = await h.saved(j.id);
          return s.status === 'paused' && s;
        });
        equal(paused.pauseReason, 'switch', 'automatic switch reason');
        equal(paused.verifiedMediaKey, verifiedKey, 'verified identity retained');
        equal(await h.store.tracks('guest', verifiedKey), [], 'no completed track');
        return { status: paused.status, reason: paused.pauseReason, calls: h.calls() };
      })
  });

cases.push({
  name: 'another queue cannot pause a verified provisional owner',
  run: (factory) =>
    harness(factory, async (h) => {
      const owner = h.queue(abortableInference),
        peer = h.queue();
      const j = await owner.enqueue(localKey, 'ja', '1', 40, 0, true);
      await until(() => h.calls() === 1);
      await owner.verifyProvisional(localKey, verifiedKey);
      const before = await h.saved(j.id);
      equal(
        await peer.pauseSparseForMedia(verifiedKey),
        [],
        'foreign queue has no switch admission'
      );
      equal(await h.saved(j.id), before, 'owner checkpoint unchanged');
      return { status: before.status, calls: h.calls() };
    })
});

for (const action of ['user', 'switch'])
  cases.push({
    name: `an identity wait cannot replace a newer ${action} pause`,
    run: (factory) =>
      harness(factory, async (h) => {
        const q = h.queue(),
          gate = h.hold();
        const update = h.store.updateLocal.bind(h.store);
        let held = false,
          armed = true;
        // Hold only the write after the final checkpoint has committed. The user
        // intent transaction can then commit before the runner's catch callback.
        h.store.updateLocal = async (...args) => {
          const old = await h.store.local(args[0], args[1], args[2]);
          if (armed && old?.completedAt !== undefined && old.status === 'running') {
            armed = false;
            held = true;
            await gate.promise;
          }
          return update(...args);
        };
        const j = await q.enqueue(localKey, 'ja', '1', 2, 0, true);
        await until(() => held);
        if (action === 'user') await q.cancel(j.id);
        else await q.pauseSparseForMedia(localKey);
        gate.resolve();
        const paused = await until(async () => {
          const s = await h.saved(j.id);
          return s.status === 'paused' && s;
        });
        equal(paused.pauseReason, action, 'newer intent must win over identity waiting');
        await q.verifyProvisional(localKey, verifiedKey);
        const verified = await h.saved(j.id);
        equal(verified.pauseReason, action, 'verification does not change pause intent');
        equal(await h.store.tracks('guest', verifiedKey), [], 'no automatic publication');
        return {
          status: verified.status,
          reason: verified.pauseReason,
          nextWindow: verified.nextWindow
        };
      })
  });

for (const expected of ['identity', 'switch', 'queued'])
  cases.push({
    name: `automatic ${expected} resume rechecks user cancellation in its transaction`,
    run: (factory) =>
      harness(factory, async (h) => {
        const q = h.queue(),
          gate = h.hold();
        const j =
          expected === 'queued' ? releasedJob(savedJob('switch'), 'queued') : savedJob(expected);
        await h.store.putLocal('guest', 'jobs', j.id, j);
        const update = h.store.updateLocal.bind(h.store);
        let entered = false,
          armed = true;
        h.store.updateLocal = async (...args) => {
          if (armed) {
            armed = false;
            entered = true;
            await gate.promise;
          }
          return update(...args);
        };
        const pending = q.resume(j.id, { mediaKey: verifiedKey, expected, isCurrent: () => true });
        await until(() => entered);
        await q.cancel(j.id);
        gate.resolve();
        const result = await pending;
        equal(result, undefined, 'stale automatic admission must be declined');
        equal((await h.saved(j.id)).pauseReason, 'user', 'Cancel must remain durable');
        equal(h.calls(), 0, 'no recognition after cancellation');
        return { reason: 'user', calls: h.calls() };
      })
  });

for (const point of ['transaction', 'admission'])
  cases.push({
    name: `automatic resume fences a video switch before ${point}`,
    run: (factory) =>
      harness(factory, async (h) => {
        const q = h.queue(),
          gate = h.hold(),
          j = savedJob();
        await h.store.putLocal('guest', 'jobs', j.id, j);
        const update = h.store.updateLocal.bind(h.store);
        let current = true,
          entered = false;
        h.store.updateLocal = async (...args) => {
          if (point === 'transaction') {
            entered = true;
            await gate.promise;
            return update(...args);
          }
          const result = await update(...args);
          entered = true;
          await gate.promise;
          return result;
        };
        const pending = q.resume(j.id, {
          mediaKey: verifiedKey,
          expected: 'identity',
          isCurrent: () => current
        });
        await until(() => entered);
        current = false;
        gate.resolve();
        equal(await pending, undefined, 'replaced video cannot admit work');
        equal(h.calls(), 0, 'no old-video inference');
        const saved = await h.saved(j.id);
        equal(
          saved.status,
          point === 'transaction' ? 'paused' : 'queued',
          'durable state at fence'
        );
        return { status: saved.status, calls: h.calls() };
      })
  });

cases.push({
  name: 'automatic identity resume rejects the wrong verified video',
  run: (factory) =>
    harness(factory, async (h) => {
      const q = h.queue(),
        j = savedJob();
      await h.store.putLocal('guest', 'jobs', j.id, j);
      equal(
        await q.resume(j.id, { mediaKey: otherKey, expected: 'identity', isCurrent: () => true }),
        undefined,
        'wrong video'
      );
      equal(await h.saved(j.id), j, 'checkpoint unchanged');
      equal(h.calls(), 0, 'no inference');
      return { calls: h.calls() };
    })
});

cases.push({
  name: 'matching automatic identity resume completes under the verified key',
  run: (factory) =>
    harness(factory, async (h) => {
      const q = h.queue(),
        j = savedJob();
      await h.store.putLocal('guest', 'jobs', j.id, j);
      const result = await q.resume(j.id, {
        mediaKey: verifiedKey,
        expected: 'identity',
        isCurrent: () => true
      });
      equal(result?.id, j.id, 'same job resumed');
      await until(async () => (await h.saved(j.id)).status === 'complete');
      const tracks = await h.store.tracks('guest', verifiedKey);
      equal(tracks.length, 1, 'one complete track');
      equal(tracks[0].id, j.id, 'same track identity');
      equal(await h.store.tracks('guest', localKey), [], 'never publish under provisional key');
      return { calls: h.calls(), complete: tracks[0].complete };
    })
});

cases.push({
  name: 'manual Resume still resumes an explicitly user-paused job',
  run: (factory) =>
    harness(factory, async (h) => {
      const q = h.queue(),
        j = savedJob('user');
      await h.store.putLocal('guest', 'jobs', j.id, j);
      equal(jobCanResume(j), true, 'manual resume remains available');
      equal((await q.resume(j.id)).id, j.id, 'same manual job');
      await until(async () => (await h.saved(j.id)).status === 'complete');
      return { status: 'complete', calls: h.calls() };
    })
});

for (const point of ['queued', 'claim'])
  cases.push({
    name: `automatic continuation stays scoped while waiting for ${point}`,
    run: (factory) =>
      harness(factory, async (h) => {
        const hold = h.hold();
        const q = h.queue(async () => {
          if (point === 'queued' && h.calls() === 1) return await hold.promise;
          return '[0][S01]保存する字幕[1]';
        });
        if (point === 'queued') {
          await q.enqueue(otherKey, 'ja', '1', 2, 0);
          await until(() => h.calls() === 1);
        }
        const j = savedJob();
        await h.store.putLocal('guest', 'jobs', j.id, j);
        let current = true,
          entered = false;
        const update = h.store.updateLocal.bind(h.store);
        if (point === 'claim')
          h.store.updateLocal = async (...args) => {
            const before = await h.store.local(args[0], args[1], args[2]);
            if (before?.id === j.id && before.status === 'queued') {
              entered = true;
              await hold.promise;
            }
            return update(...args);
          };
        await q.resume(j.id, {
          mediaKey: verifiedKey,
          expected: 'identity',
          isCurrent: () => current
        });
        if (point === 'claim') await until(() => entered);
        current = false;
        hold.resolve('[0][S01]他の字幕[1]');
        // Own the whole drain, not a timing guess that inference has not started yet.
        await q.task;
        equal((await h.saved(j.id)).status, 'queued', 'revoked automatic job remains unclaimed');
        equal(h.calls(), point === 'queued' ? 1 : 0, 'no inference from the stale admission');
        equal(await h.store.tracks('guest', verifiedKey), [], 'no stale automatic publication');
        return { status: 'queued', calls: h.calls() };
      })
  });
