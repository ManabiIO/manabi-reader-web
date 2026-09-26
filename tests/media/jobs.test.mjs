/** Real queue/store algorithms with explicit transaction and recognition doubles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { validateJob, JobOwnershipLost } from '../../.cache/media-test-build/jobs.js';
import { MOSS } from '../../.cache/media-test-build/model-cache.js';
import { planWindows } from '../../.cache/media-test-build/moss-output.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';
const scope = 'account:jobs',
  key = 'content:' + 'a'.repeat(64),
  id = 'b0000000-0000-4000-8000-000000000001',
  owner = 'c0000000-0000-4000-8000-000000000001';
const tick = () => new Promise((r) => setTimeout(r, 0));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const job = () => ({
  version: 1,
  id,
  mediaKey: key,
  language: 'ja',
  audioTrack: '1',
  duration: 2,
  status: 'queued',
  nextWindow: 0,
  cues: [],
  modelSha256: MOSS.sha256,
  engineRevision: MOSS.engineRevision,
  createdAt: 1
});
const eventually = async (fn) => {
  for (let i = 0; i < 500; i++) {
    if (await fn()) return;
    await tick();
  }
  throw Error('Job did not settle');
};
async function harness(body) {
  const old = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const factory = new TransactionFactory(),
    store = new MediaStore(factory, 'job-tests'),
    queues = [];
  const queue = (
    engine,
    decode = async () => new Float32Array(32000).fill(0.1),
    changed = () => {}
  ) => {
    const q = new TranscriptionQueue(store, scope, engine, decode, changed, (e) => {
      throw e;
    });
    queues.push(q);
    return q;
  };
  try {
    await body({ factory, store, queue });
  } finally {
    for (const q of queues) await q.dispose();
    await store.close();
    if (old === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = old;
  }
}
const cue = { id: 'w0/cue-0', start: 0, end: 1, text: 'こんにちは。' };
const completeTrack = (j) => ({
  version: 1,
  id: j.id,
  mediaKey: j.mediaKey,
  label: 'Japanese',
  language: 'ja',
  kind: 'transcription',
  origin: 'sidecar',
  complete: true,
  forced: false,
  createdAt: 1,
  cues: j.cues
});
for (const bad of [
  { nextWindow: -1 },
  { nextWindow: 2 },
  { nextWindow: 0.5 },
  { duration: 0 },
  { audioTrack: '../1' },
  { status: ['queued'] },
  { id: 'bad' },
  { mediaKey: 'provider:secret' },
  { modelSha256: 'bad' },
  { nextWindow: 0, cues: [cue] },
  { nextWindow: 1, cues: [{ ...cue, id: 'w1/cue-0' }] },
  { nextWindow: 1, cues: [{ ...cue, end: 3 }] },
  { nextWindow: 1, cues: [cue, cue] },
  { ownerId: owner },
  { cancelRequested: 'true' },
  { status: 'complete', nextWindow: 0 },
  { unknown: 'state' }
])
  test('saved job rejects malformed checkpoint ' + JSON.stringify(bad), () =>
    assert.throws(() => validateJob({ ...job(), ...bad }))
  );
test('window planning bounds custom tiny windows before allocation', () => {
  assert.throws(() => planWindows(604800, 0.01, 0));
  assert.throws(() => planWindows(604800, 1, 0));
  assert.equal(planWindows(604800).length, 10080);
});
test('job claim is atomic: simultaneous owners cannot both win', () =>
  harness(async ({ store }) => {
    await store.putLocal(scope, 'jobs', id, job());
    const claim = (who) =>
      store.updateLocal(scope, 'jobs', id, (old) =>
        old.status === 'queued'
          ? { ...old, status: 'running', ownerId: who, leaseUntil: Date.now() + 90000 }
          : old
      );
    const [a, b] = await Promise.all([claim(owner), claim('d0000000-0000-4000-8000-000000000001')]);
    assert.equal(a.ownerId, owner);
    assert.equal(b.ownerId, owner);
  }));
test('cancelled or superseded owner cannot publish a track or completion', () =>
  harness(async ({ store }) => {
    const current = {
      ...job(),
      status: 'running',
      ownerId: owner,
      leaseUntil: Date.now() + 90000,
      nextWindow: 1,
      cues: [cue]
    };
    await store.putLocal(scope, 'jobs', id, current);
    const completed = { ...job(), status: 'complete', nextWindow: 1, cues: [cue], completedAt: 1 };
    await assert.rejects(
      store.saveTrack(scope, completeTrack(completed), {
        ownerId: 'd0000000-0000-4000-8000-000000000001',
        job: completed
      }),
      JobOwnershipLost
    );
    await store.putLocal(scope, 'jobs', id, { ...current, cancelRequested: true });
    await assert.rejects(
      store.saveTrack(scope, completeTrack(completed), { ownerId: owner, job: completed }),
      JobOwnershipLost
    );
    assert.equal((await store.tracks(scope, key)).length, 0);
    assert.equal((await store.local(scope, 'jobs', id)).status, 'running');
  }));
test('caption pages, manifest and job completion roll back together on quota failure', () =>
  harness(async ({ store, factory }) => {
    const current = {
      ...job(),
      status: 'running',
      ownerId: owner,
      leaseUntil: Date.now() + 90000,
      nextWindow: 1,
      cues: [cue]
    };
    await store.putLocal(scope, 'jobs', id, current);
    const completed = { ...job(), status: 'complete', nextWindow: 1, cues: [cue], completedAt: 1 };
    factory.failPutNumber = factory.putCount + 2;
    await assert.rejects(
      store.saveTrack(scope, completeTrack(completed), { ownerId: owner, job: completed }),
      { name: 'QuotaExceededError' }
    );
    assert.equal((await store.local(scope, 'jobs', id)).status, 'running');
    assert.equal((await store.records(scope)).length, 0);
    factory.failPutNumber = undefined;
    await store.saveTrack(scope, completeTrack(completed), { ownerId: owner, job: completed });
    assert.equal((await store.local(scope, 'jobs', id)).status, 'complete');
    assert.equal((await store.tracks(scope, key)).length, 1);
  }));
test('failed publication retries with stable provenance and no repeated inference or download', () =>
  harness(async ({ queue, store, factory }) => {
    let prepares = 0,
      decodes = 0,
      calls = 0,
      first = true;
    const timestamps = [],
      publish = store.saveTrack.bind(store);
    store.saveTrack = async (...args) => {
      timestamps.push(args[1].provenance.generatedAt);
      if (first) {
        first = false;
        factory.failNextCommit = new DOMException('Disk full', 'QuotaExceededError');
      }
      return publish(...args);
    };
    const q = queue(
      {
        async prepare() {
          prepares++;
        },
        async transcribe() {
          calls++;
          return '[0][S01]こんにちは。[1]';
        },
        dispose() {}
      },
      async () => {
        decodes++;
        return new Float32Array(32000).fill(0.1);
      }
    );
    const j = await q.enqueue(key, 'ja', '1', 2);
    await eventually(async () => (await store.local(scope, 'jobs', j.id)).status === 'failed');
    const saved = await store.local(scope, 'jobs', j.id);
    assert.equal(saved.nextWindow, 1);
    assert.equal((await store.tracks(scope, key)).length, 0);
    await q.resume(j.id);
    await eventually(async () => (await store.local(scope, 'jobs', j.id)).status === 'complete');
    assert.deepEqual([prepares, decodes, calls], [1, 1, 1]);
    assert.deepEqual(timestamps, [saved.completedAt, saved.completedAt]);
    assert.equal((await store.tracks(scope, key)).length, 1);
  }));
test('throwing progress observer cannot turn a successful transcription into a failure', () =>
  harness(async ({ queue, store }) => {
    const q = queue(
      {
        async prepare() {},
        async transcribe() {
          return '[0][S01]こんにちは。[1]';
        },
        dispose() {}
      },
      undefined,
      () => {
        throw Error('render bug');
      }
    );
    const j = await q.enqueue(key, 'ja', '1', 2);
    await eventually(async () => (await store.local(scope, 'jobs', j.id)).status === 'complete');
    assert.equal((await store.tracks(scope, key)).length, 1);
  }));
test('a cancellation requested by another queue reaches the active worker and preserves checkpoints', () =>
  harness(async ({ queue, store }) => {
    const started = deferred();
    let aborted = false;
    const q = queue({
      prepare(signal) {
        started.resolve();
        return new Promise((_, no) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              no(signal.reason);
            },
            { once: true }
          )
        );
      },
      dispose() {}
    });
    const other = queue({ dispose() {} }),
      j = await q.enqueue(key, 'ja', '1', 2);
    await started.promise;
    await other.cancel(j.id);
    await eventually(async () => (await store.local(scope, 'jobs', j.id)).status === 'paused');
    assert.equal(aborted, true);
    assert.equal((await store.tracks(scope, key)).length, 0);
  }));
test('resume refuses a live lease; recovery only releases stale owners without Web Locks', () =>
  withLocks(undefined, () =>
    harness(async ({ queue, store }) => {
      const q = queue({ dispose() {} });
      await store.putLocal(scope, 'jobs', id, {
        ...job(),
        status: 'running',
        ownerId: owner,
        leaseUntil: Date.now() + 90000
      });
      await assert.rejects(q.resume(id), /still active/);
      await q.recover();
      assert.equal((await store.local(scope, 'jobs', id)).status, 'running');
      await store.putLocal(scope, 'jobs', id, {
        ...job(),
        status: 'running',
        ownerId: owner,
        leaseUntil: 1
      });
      await q.recover();
      assert.equal((await store.local(scope, 'jobs', id)).status, 'paused');
    })
  ));
test('non-finite PCM never reaches MOSS or publishes a silent transcript', () =>
  harness(async ({ queue, store }) => {
    let calls = 0;
    const q = queue(
      {
        async prepare() {},
        async transcribe() {
          calls++;
          return '';
        },
        dispose() {}
      },
      async () => new Float32Array([NaN])
    );
    const j = await q.enqueue(key, 'ja', '1', 2);
    await eventually(async () => (await store.local(scope, 'jobs', j.id)).status === 'failed');
    assert.equal(calls, 0);
    assert.equal((await store.tracks(scope, key)).length, 0);
  }));
test('resuming an older model revision never silently uses the current model', () =>
  harness(async ({ queue, store }) => {
    let prepares = 0;
    const q = queue({
      async prepare() {
        prepares++;
      },
      dispose() {}
    });
    await store.putLocal(scope, 'jobs', id, {
      ...job(),
      status: 'paused',
      engineRevision: 'older'
    });
    await assert.rejects(q.resume(id), /another model revision/);
    assert.equal(prepares, 0);
  }));

test('successful publication discards only the redundant completed-job cues, not the saved transcript', () =>
  harness(async ({ store }) => {
    const current = {
      ...job(),
      status: 'running',
      ownerId: owner,
      leaseUntil: Date.now() + 90000,
      nextWindow: 1,
      cues: [cue]
    };
    await store.putLocal(scope, 'jobs', id, current);
    const completed = { ...job(), status: 'complete', nextWindow: 1, cues: [cue], completedAt: 1 };
    await store.saveTrack(scope, completeTrack(completed), { ownerId: owner, job: completed });
    const summary = await store.local(scope, 'jobs', id);
    assert.equal(summary.status, 'complete');
    assert.equal(summary.nextWindow, 1);
    assert.deepEqual(summary.cues, []);
    assert.deepEqual((await store.tracks(scope, key))[0].cues, [cue]);
  }));
test('changed completion cues cannot replace the durable checkpoint even for its current owner', () =>
  harness(async ({ store }) => {
    await store.putLocal(scope, 'jobs', id, {
      ...job(),
      status: 'running',
      ownerId: owner,
      leaseUntil: Date.now() + 90000,
      nextWindow: 1,
      cues: [cue]
    });
    const completed = {
      ...job(),
      status: 'complete',
      nextWindow: 1,
      cues: [{ ...cue, text: 'Not the checkpoint' }],
      completedAt: 1
    };
    await assert.rejects(
      store.saveTrack(scope, completeTrack(completed), { ownerId: owner, job: completed }),
      /durable checkpoint/
    );
    assert.equal((await store.tracks(scope, key)).length, 0);
    assert.deepEqual((await store.local(scope, 'jobs', id)).cues, [cue]);
  }));
test('published track and completed job must carry the same text and language', () =>
  harness(async ({ store }) => {
    const completed = { ...job(), status: 'complete', nextWindow: 1, cues: [cue], completedAt: 1 };
    for (const t of [
      { ...completeTrack(completed), language: 'en' },
      { ...completeTrack(completed), cues: [{ ...cue, text: 'different' }] }
    ])
      await assert.rejects(
        store.saveTrack(scope, t, { ownerId: owner, job: completed }),
        /Invalid completed/
      );
    assert.equal((await store.records(scope)).length, 0);
  }));

// Node may expose navigator.locks; each capability scenario owns its mock.
async function withLocks(locks, body) {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
  try {
    return await body();
  } finally {
    if (previous) Object.defineProperty(navigator, 'locks', previous);
    else delete navigator.locks;
  }
}
for (const available of [false, true]) {
  test(`recovery ${available ? 'releases an orphan under exclusive lock' : 'leaves a held inference lock untouched'}`, () =>
    withLocks(
      {
        async request(name, options, callback) {
          assert.equal(name, 'manabi-moss-inference');
          assert.deepEqual(options, { ifAvailable: true });
          return callback(available ? { name } : null);
        }
      },
      () =>
        harness(async ({ queue, store }) => {
          const q = queue({ dispose() {} });
          await store.putLocal(scope, 'jobs', id, {
            ...job(),
            status: 'running',
            ownerId: owner,
            leaseUntil: Date.now() + 90000
          });
          await q.recover();
          assert.equal(
            (await store.local(scope, 'jobs', id)).status,
            available ? 'paused' : 'running'
          );
        })
    ));
}
