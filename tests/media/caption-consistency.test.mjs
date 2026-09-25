/** Production store with the explicitly identified transaction double; no native IDB claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { splitTrack } from '../../.cache/media-test-build/replica.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';
const scope = 'guest',
  key = 'content:' + 'a'.repeat(64),
  other = 'content:' + 'b'.repeat(64);
const track = (mediaKey = key, id = crypto.randomUUID()) => ({
  version: 1,
  id,
  mediaKey,
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
    text: '字幕' + i
  }))
});
async function harness(fn) {
  const old = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const factory = new TransactionFactory(),
    store = new MediaStore(factory, 'captions-' + crypto.randomUUID());
  try {
    await fn(store, factory);
  } finally {
    await store.close();
    if (old === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = old;
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
test('caption invalidations distinguish subtitle publication from local-only writes', () =>
  harness(async (store) => {
    const seen = [];
    store.subscribe((captions) => seen.push(captions));
    await store.putLocal(scope, 'jobs', 'one', { position: 1 });
    await tick();
    assert.deepEqual(seen, [false]);
    seen.length = 0;
    await store.saveTrack(scope, track());
    await tick();
    assert.deepEqual(seen, [true]);
  }));
test('coalesced observer notifications retain any caption invalidation', () =>
  harness(async (store) => {
    const seen = [];
    store.subscribe((captions) => seen.push(captions));
    store.notify(false, false);
    store.notify(false, true);
    store.notify(false, false);
    await tick();
    assert.deepEqual(seen, [true]);
    store.notify(false, false);
    await tick();
    assert.deepEqual(seen, [true, false]);
  }));
test('incoming legacy or malformed notification remains a conservative invalidation, not stored data', () =>
  harness(async (store) => {
    const seen = [];
    store.subscribe((value) => seen.push(value));
    for (const data of [
      'change',
      null,
      { type: 'media-change', captions: 'false' },
      { type: 'media-change', captions: true }
    ]) {
      store.channel.onmessage({ data });
      await tick();
    }
    assert.deepEqual(seen, [true, true, true, true]);
    assert.deepEqual(await store.records(scope), []);
    store.channel.onmessage({ data: { type: 'media-change', captions: false } });
    await tick();
    assert.equal(seen.at(-1), false);
  }));
test('track restore reads only selected manifest pages and uses one transaction snapshot', () =>
  harness(async (store, factory) => {
    const a = track(),
      b = track(other),
      c = track();
    await store.saveTrack(scope, a);
    await store.saveTrack(scope, b);
    await store.saveTrack('account:other', c);
    factory.reads = [];
    const before = factory.transactions.length;
    const tracks = await store.tracks(scope, key);
    assert.deepEqual(tracks, [a]);
    assert.equal(factory.transactions.length - before, 1);
    const scans = factory.reads.filter((r) => r.operation === 'getAll');
    assert.equal(scans.length, 1);
    assert.ok(scans[0].query.lower.includes('video_track'));
    const pages = factory.reads.filter((r) => r.operation === 'get').map((r) => JSON.parse(r.key));
    assert.equal(pages.length, 3);
    assert.ok(
      pages.every(([s, k, id]) => s === scope && k === 'video_chunk' && id.startsWith(a.id + '/p/'))
    );
  }));
test('manifest before its pages stays unavailable until all verified pages arrive', () =>
  harness(async (store) => {
    const t = track(),
      pieces = splitTrack(t),
      manifest = pieces.find((p) => p.kind === 'video_track'),
      pages = pieces.filter((p) => p.kind === 'video_chunk');
    await store.edit(scope, manifest.kind, manifest.id, key, manifest.payload);
    assert.deepEqual(await store.tracks(scope, key), []);
    for (const p of pages.slice(0, -1)) await store.edit(scope, p.kind, p.id, key, p.payload);
    assert.deepEqual(await store.tracks(scope, key), []);
    const last = pages.at(-1);
    await store.edit(scope, last.kind, last.id, key, last.payload);
    assert.deepEqual(await store.tracks(scope, key), [t]);
  }));
test('deleted manifest pages and corrupt cross-media pages cannot be attached to the player', () =>
  harness(async (store, factory) => {
    const t = track();
    await store.saveTrack(scope, t);
    const pageKey = JSON.stringify([scope, 'video_chunk', t.id + '/p/0']);
    const value = factory.values().get(pageKey);
    factory.values().set(pageKey, { ...value, mediaKey: other });
    await assert.rejects(store.tracks(scope, key), /identity/);
    factory.values().set(pageKey, { ...value, payload: null });
    assert.deepEqual(await store.tracks(scope, key), []);
  }));
