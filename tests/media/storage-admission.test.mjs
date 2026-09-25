/** Production MediaStore operations with the explicit transaction double.
 * These checks test transaction boundaries, not native IndexedDB compatibility.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { MOSS } from '../../.cache/media-test-build/model-cache.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';
const scope = 'account:admission',
  mediaKey = 'content:' + 'a'.repeat(64),
  otherKey = 'content:' + 'b'.repeat(64);
const id = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000001`;
const job = (n, extra = {}) => ({
  version: 1,
  id: id(n),
  mediaKey,
  language: 'ja',
  audioTrack: '1',
  duration: 10,
  status: 'queued',
  nextWindow: 0,
  cues: [],
  modelSha256: MOSS.sha256,
  engineRevision: MOSS.engineRevision,
  createdAt: 1,
  ...extra
});
const track = (n, key = mediaKey) => ({
  version: 1,
  id: id(n),
  mediaKey: key,
  label: 'Japanese',
  language: 'ja',
  kind: 'transcription',
  origin: 'sidecar',
  complete: true,
  forced: false,
  createdAt: 1,
  cues: Array.from({ length: 401 }, (_, i) => ({
    id: 'c' + i,
    start: i,
    end: i + 0.5,
    text: 'Caption ' + i
  }))
});
const dbKey = (s, k, i) => JSON.stringify([s, k, i]);
async function harness(body) {
  const old = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const factory = new TransactionFactory(),
    a = new MediaStore(factory, 'admission-test'),
    b = new MediaStore(factory, 'admission-test');
  try {
    await body({ a, b, factory });
  } finally {
    await a.close();
    await b.close();
    if (old === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = old;
  }
}
test('concurrent Generate admission across two store connections creates only one pending job', () =>
  harness(async ({ a, b }) => {
    const [first, second] = await Promise.all([
      a.enqueueJob(scope, job(1)),
      b.enqueueJob(scope, job(2))
    ]);
    assert.equal(first.id, second.id);
    assert.equal((await a.listLocal(scope, 'jobs')).length, 1);
  }));
test('running job is reused, but paused and completed jobs permit a deliberate alternative', () =>
  harness(async ({ a }) => {
    await a.putLocal(
      scope,
      'jobs',
      id(1),
      job(1, { status: 'running', ownerId: id(99), leaseUntil: Date.now() + 90000 })
    );
    assert.equal((await a.enqueueJob(scope, job(2))).id, id(1));
    await a.putLocal(scope, 'jobs', id(1), job(1, { status: 'paused' }));
    assert.equal((await a.enqueueJob(scope, job(2))).id, id(2));
    await a.putLocal(
      scope,
      'jobs',
      id(2),
      job(2, { status: 'complete', nextWindow: 1, completedAt: 2 })
    );
    assert.equal((await a.enqueueJob(scope, job(3))).id, id(3));
  }));
test('different audio, language, media, model and account retain independent generation jobs', () =>
  harness(async ({ a }) => {
    for (const [n, extra] of [
      [1, {}],
      [2, { audioTrack: '2' }],
      [3, { language: 'en' }],
      [4, { mediaKey: otherKey }],
      [5, { engineRevision: 'next' }],
      [6, { modelSha256: 'f'.repeat(64) }]
    ])
      assert.equal((await a.enqueueJob(scope, job(n, extra))).id, id(n));
    assert.equal((await a.enqueueJob('guest', job(7))).id, id(7));
    assert.equal((await a.listLocal(scope, 'jobs')).length, 6);
  }));
test('new admission cannot overwrite any old job with a reused identity', () =>
  harness(async ({ a }) => {
    await a.putLocal(scope, 'jobs', id(1), job(1, { status: 'failed', error: 'failure' }));
    await assert.rejects(a.enqueueJob(scope, job(1)), /identity.*in use/);
    assert.equal((await a.local(scope, 'jobs', id(1))).status, 'failed');
  }));
test('closed admission guard after a delayed database open leaves no durable job', () =>
  harness(async ({ a, factory }) => {
    factory.holdOpen = true;
    let closed = false;
    const adding = a.enqueueJob(scope, job(1), () => {
      if (closed) throw Error('closed');
    });
    closed = true;
    factory.releaseOpen();
    await assert.rejects(adding, /closed/);
    assert.equal((await a.listLocal(scope, 'jobs')).length, 0);
  }));
test('draft job is snapshotted before the database opens', () =>
  harness(async ({ a, factory }) => {
    factory.holdOpen = true;
    const draft = job(1),
      pending = a.enqueueJob(scope, draft);
    draft.language = 'en';
    draft.duration = 900;
    factory.releaseOpen();
    await pending;
    assert.equal((await a.local(scope, 'jobs', id(1))).language, 'ja');
    assert.equal((await a.local(scope, 'jobs', id(1))).duration, 10);
  }));
for (const extra of [
  { completedAt: 2 },
  { error: 'earlier failure' },
  { cancelRequested: false },
  { status: 'paused' }
])
  test('new admission rejects recovered rather than fresh drafts ' + JSON.stringify(extra), () =>
    harness(async ({ a }) => {
      assert.throws(() => a.enqueueJob(scope, job(1, extra)), /fresh/);
    })
  );
test('caption refresh reads only requested manifests and referenced pages in ONE readonly transaction', () =>
  harness(async ({ a, factory }) => {
    await a.saveTrack(scope, track(1));
    await a.saveTrack(scope, track(2, otherKey));
    await a.saveTrack('guest', track(3));
    factory.reads = [];
    factory.transactions = [];
    const result = await a.tracks(scope, mediaKey);
    assert.equal(result.length, 1);
    assert.equal(result[0].cues.length, 401);
    assert.deepEqual(factory.transactions, [{ names: ['records'], mode: 'readonly' }]);
    const [manifests, ...pages] = factory.reads;
    assert.equal(manifests.operation, 'getAll');
    assert.ok(manifests.query.lower.includes('video_track'));
    assert.equal(pages.length, 3);
    assert.ok(
      pages.every(
        (p) =>
          p.operation === 'get' &&
          p.key.startsWith(JSON.stringify([scope, 'video_chunk']).slice(0, -1)) &&
          JSON.parse(p.key)[2].startsWith(id(1) + '/p/')
      )
    );
  }));
test('unrelated large or corrupt caption pages are never deserialized during a video refresh', () =>
  harness(async ({ a, factory }) => {
    await a.saveTrack(scope, track(1));
    await a.saveTrack(scope, track(2, otherKey));
    factory.values().set(dbKey(scope, 'video_chunk', id(2) + '/p/0'), {
      scope: 'wrong',
      kind: 'video_chunk',
      payload: { large: 'unrelated' }
    });
    assert.equal((await a.tracks(scope, mediaKey)).length, 1);
  }));
test('missing subtitle pages hide incomplete tracks and become available after later delivery', () =>
  harness(async ({ a, factory }) => {
    await a.saveTrack(scope, track(1));
    const k = dbKey(scope, 'video_chunk', id(1) + '/p/1'),
      page = factory.values().get(k);
    factory.values().delete(k);
    assert.deepEqual(await a.tracks(scope, mediaKey), []);
    factory.values().set(k, page);
    assert.equal((await a.tracks(scope, mediaKey)).length, 1);
  }));
test('misbound requested page fails rather than displaying another media or account transcript', () =>
  harness(async ({ a, factory }) => {
    await a.saveTrack(scope, track(1));
    const page = factory.values().get(dbKey(scope, 'video_chunk', id(1) + '/p/0'));
    page.mediaKey = otherKey;
    await assert.rejects(a.tracks(scope, mediaKey), /page identity/);
  }));
test('a deleted referenced page keeps the full transcript unpublished', () =>
  harness(async ({ a }) => {
    await a.saveTrack(scope, track(1));
    await a.edit(scope, 'video_chunk', id(1) + '/p/0', mediaKey, null);
    assert.deepEqual(await a.tracks(scope, mediaKey), []);
  }));
