/** Production publication/queue algorithms with controlled transaction boundaries.
 * Native IndexedDB rollback is qualified in publication-cancellation-browser.py.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { MOSS } from '../../.cache/media-test-build/model-cache.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';

const scope = 'guest',
  key = 'content:' + 'a'.repeat(64);
const owner = '11111111-1111-4111-8111-111111111111';
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(read) {
  for (let n = 0; n < 500; n++) {
    if (await read()) return;
    await tick();
  }
  assert.fail('Publication did not settle');
}
function checkpoint() {
  const cues = Array.from({ length: 1500 }, (_, n) => ({
    id: `w0/cue-${n}`,
    start: n / 30,
    end: n / 30 + 0.02,
    text: `保存${n}`
  }));
  const job = {
    version: 1,
    id: crypto.randomUUID(),
    mediaKey: key,
    language: 'ja',
    audioTrack: '1',
    duration: 60,
    status: 'running',
    nextWindow: 1,
    cues,
    modelSha256: MOSS.sha256,
    engineRevision: MOSS.engineRevision,
    createdAt: 1,
    completedAt: 2,
    ownerId: owner,
    leaseUntil: Date.now() + 90000
  };
  const { ownerId: _, leaseUntil: __, ...completed } = { ...job, status: 'complete' };
  const track = {
    version: 1,
    id: job.id,
    mediaKey: key,
    language: 'ja',
    label: 'Japanese',
    kind: 'transcription',
    origin: 'sidecar',
    complete: true,
    forced: false,
    createdAt: 1,
    cues
  };
  return { job, completed, track };
}
async function harness(body) {
  const old = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const factory = new TransactionFactory(),
    store = new MediaStore(factory, 'publication-cancel');
  const controller = new AbortController();
  const data = checkpoint();
  try {
    await store.putLocal(scope, 'jobs', data.job.id, data.job);
    await body({ factory, store, controller, ...data });
  } finally {
    await store.close();
    if (old === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = old;
  }
}
async function unchanged({ store, job }) {
  assert.deepEqual(await store.local(scope, 'jobs', job.id), job);
  assert.deepEqual(await store.records(scope), []);
  assert.deepEqual(await store.tracks(scope, key), []);
}
for (const reason of [new DOMException('Cancelled', 'AbortError'), null, false, 0])
  test(`pre-publication cancellation preserves exact ${String(reason)} reason and checkpoint`, () =>
    harness(async (h) => {
      const count = h.factory.transactions.length;
      h.controller.abort(reason);
      await assert.rejects(
        h.store.saveTrack(scope, h.track, {
          ownerId: owner,
          job: h.completed,
          signal: h.controller.signal
        }),
        (error) => error === reason
      );
      assert.equal(h.factory.transactions.length, count, 'no transaction is admitted');
      await unchanged(h);
    }));
test('cancellation while opening storage prevents later publication and still drains Close', () =>
  harness(async (h) => {
    // A second connection must open asynchronously while the first retains the checkpoint.
    h.factory.holdOpen = true;
    const other = new MediaStore(h.factory, 'publication-cancel');
    const reason = new DOMException('Closed while opening', 'AbortError');
    const pending = other.saveTrack(scope, h.track, {
      ownerId: owner,
      job: h.completed,
      signal: h.controller.signal
    });
    const rejected = assert.rejects(pending, (error) => error === reason);
    const closing = other.close();
    h.controller.abort(reason);
    h.factory.releaseOpen();
    await Promise.all([rejected, closing]);
    await unchanged(h);
  }));
test('cancellation of an admitted publication rolls back its job and every caption page', () =>
  harness(async (h) => {
    const transaction = h.store.tx.bind(h.store);
    h.store.tx = (names, mode, work, ...args) =>
      transaction(
        names,
        mode,
        (...inner) => {
          work(...inner);
          if (Array.isArray(names)) h.controller.abort();
        },
        ...args
      );
    await assert.rejects(
      h.store.saveTrack(scope, h.track, {
        ownerId: owner,
        job: h.completed,
        signal: h.controller.signal
      }),
      { name: 'AbortError' }
    );
    await unchanged(h);
  }));
test('cancellation after the first caption put aborts all pages without broadcasting publication', () =>
  harness(async (h) => {
    const transaction = h.store.tx.bind(h.store);
    let puts = 0,
      notifications = 0;
    const off = h.store.subscribe((captions) => {
      if (captions) notifications++;
    });
    h.store.tx = (names, mode, work, ...args) =>
      transaction(
        names,
        mode,
        (store, ...inner) => {
          if (Array.isArray(names)) {
            const put = store.put.bind(store);
            store.put = (...values) => {
              const request = put(...values);
              puts++;
              h.controller.abort();
              return request;
            };
          }
          work(store, ...inner);
        },
        ...args
      );
    try {
      await assert.rejects(
        h.store.saveTrack(scope, h.track, {
          ownerId: owner,
          job: h.completed,
          signal: h.controller.signal
        }),
        { name: 'AbortError' }
      );
      assert.equal(puts, 1);
      await unchanged(h);
      assert.equal(notifications, 0);
    } finally {
      off();
    }
  }));
test('publication snapshots owner authority before asynchronous storage callbacks', () =>
  harness(async (h) => {
    const completion = {
      ownerId: crypto.randomUUID(),
      job: h.completed,
      signal: h.controller.signal
    };
    const pending = h.store.saveTrack(scope, h.track, completion);
    completion.ownerId = owner;
    await assert.rejects(pending, /cancelled or taken over/);
    await unchanged(h);
  }));
test('a successful committed publication stays successful after its signal is aborted', () =>
  harness(async (h) => {
    const signal = h.controller.signal;
    const listeners = new Set();
    const add = signal.addEventListener.bind(signal),
      remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (type, listener, ...args) => {
      if (type === 'abort') listeners.add(listener);
      return add(type, listener, ...args);
    };
    signal.removeEventListener = (type, listener, ...args) => {
      if (type === 'abort') listeners.delete(listener);
      return remove(type, listener, ...args);
    };
    await h.store.saveTrack(scope, h.track, { ownerId: owner, job: h.completed, signal });
    assert.equal(listeners.size, 0);
    h.controller.abort();
    assert.equal((await h.store.local(scope, 'jobs', h.job.id)).status, 'complete');
    assert.deepEqual((await h.store.tracks(scope, key))[0].cues, h.job.cues);
  }));
for (const version of [1, 2, 3])
  for (const action of ['close', 'cancel'])
    test(`version ${version}: ${action} before publication preserves final checkpoint for inference-free Resume`, async () => {
      const old = globalThis.IDBKeyRange;
      globalThis.IDBKeyRange = RangeDouble;
      const store = new MediaStore(new TransactionFactory(), `queue-cancel-${version}`);
      const counts = { prepare: 0, infer: 0, decode: 0, dispose: 0 };
      const engine = {
        async prepare() {
          counts.prepare++;
        },
        async transcribe() {
          counts.infer++;
          return '[0][S01]保存する字幕[1]';
        },
        dispose() {
          counts.dispose++;
        }
      };
      const decode = async () => {
        counts.decode++;
        return new Float32Array(32000).fill(0.1);
      };
      const queue = new TranscriptionQueue(store, scope, engine, decode);
      let closing, successor;
      const publish = store.saveTrack.bind(store);
      store.saveTrack = (...args) => {
        const pending = publish(...args);
        closing = action === 'close' ? queue.dispose() : queue.cancel(args[2].job.id);
        return pending;
      };
      try {
        let j;
        if (version === 1) {
          j = {
            ...checkpoint().job,
            id: crypto.randomUUID(),
            duration: 2,
            status: 'paused',
            nextWindow: 0,
            cues: []
          };
          delete j.ownerId;
          delete j.leaseUntil;
          delete j.completedAt;
          await store.putLocal(scope, 'jobs', j.id, j);
          await queue.resume(j.id);
        } else j = await queue.enqueue(key, 'ja', '1', 2, version === 3 ? 0 : undefined);
        await until(() => !!closing);
        await closing;
        await until(async () => (await store.local(scope, 'jobs', j.id)).status === 'paused');
        await queue.dispose();
        const paused = await store.local(scope, 'jobs', j.id);
        assert.equal(paused.status, 'paused');
        if (action === 'cancel') assert.equal(paused.pauseReason, 'user');
        assert.equal(paused.nextWindow, 1);
        assert.equal(paused.cues[0].text, '保存する字幕');
        assert.ok(paused.completedAt);
        assert.deepEqual(await store.tracks(scope, key), []);
        store.saveTrack = publish;
        successor = new TranscriptionQueue(store, scope, engine, decode);
        await successor.resume(j.id);
        await until(async () => (await store.local(scope, 'jobs', j.id)).status === 'complete');
        assert.deepEqual(
          { prepare: counts.prepare, infer: counts.infer, decode: counts.decode },
          { prepare: 1, infer: 1, decode: 1 }
        );
        const tracks = await store.tracks(scope, key);
        assert.equal(tracks.length, 1);
        assert.deepEqual(tracks[0].cues, paused.cues);
        assert.equal(tracks[0].provenance.generatedAt, paused.completedAt);
      } finally {
        await queue.dispose();
        await successor?.dispose();
        await store.close();
        if (old === undefined) delete globalThis.IDBKeyRange;
        else globalThis.IDBKeyRange = old;
      }
    });

test('Cancel aborts the captured runner promptly, never a later owner with the same job ID', async () => {
  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  const queue = new TranscriptionQueue(
    { updateLocal: () => delayed },
    scope,
    { dispose() {} },
    async () => new Float32Array()
  );
  const id = crypto.randomUUID();
  const first = new AbortController(),
    next = new AbortController();
  queue.active = { id, ownerId: crypto.randomUUID(), controller: first };
  try {
    const cancelling = queue.cancel(id);
    assert.equal(first.signal.aborted, true, 'cancellation does not wait for storage');
    queue.active = { id, ownerId: crypto.randomUUID(), controller: next };
    release();
    await cancelling;
    assert.equal(next.signal.aborted, false);
  } finally {
    release();
    await queue.dispose();
  }
});
