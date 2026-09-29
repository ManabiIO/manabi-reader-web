import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mediaScope,
  searchVideoTitles,
  searchVideoTranscripts
} from '../../.cache/media-test-build/video-search.js';

const key = (digit) => 'content:' + digit.repeat(64);
const replica = (kind, mediaKey, payload) => ({
  scope: 'guest',
  kind,
  id: mediaKey,
  mediaKey,
  payload,
  base: payload,
  revision: 1,
  localVersion: crypto.randomUUID(),
  dirty: false
});
const info = (title, addedAt = 1) => ({
  version: 1,
  title,
  duration: 120,
  width: 1920,
  height: 1080,
  addedAt
});
const resume = (mediaKey, delays = {}) => ({
  version: 1,
  mediaKey,
  position: 0,
  duration: 120,
  rate: 1,
  finished: false,
  updatedAt: 1,
  primary: null,
  secondary: null,
  delays
});
const track = (id, mediaKey, cues, extra = {}) => ({
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
  cues,
  ...extra
});
const cue = (id, start, text, end = start + 1) => ({ id, start, end, text });

class Store {
  constructor({ infos = [], resumes = [], tracks = new Map(), failures = new Set() } = {}) {
    this.infos = infos;
    this.resumes = resumes;
    this.trackMap = tracks;
    this.failures = failures;
    this.trackSignals = [];
    this.manifestReads = 0;
    this.manifestSnapshot = [...new Set([...tracks.keys(), ...failures])].map((mediaKey) => ({
      mediaKey
    }));
    this.seenManifestSnapshots = [];
  }

  async records(_scope, kind) {
    return kind === 'video_info' ? this.infos : this.resumes;
  }

  async trackManifests(_scope, signal) {
    this.manifestReads++;
    signal?.throwIfAborted();
    return this.manifestSnapshot;
  }

  async tracks(_scope, mediaKey, signal, manifestSnapshot) {
    this.trackSignals.push(signal);
    this.seenManifestSnapshots.push(manifestSnapshot);
    signal?.throwIfAborted();
    if (this.failures.has(mediaKey)) throw new Error('broken track snapshot');
    return this.trackMap.get(mediaKey) ?? [];
  }
}

test('video title search folds width and case without touching stored titles', async () => {
  const a = key('a');
  const store = new Store({
    infos: [
      replica('video_info', a, info('ＡＢＣ 日本語')),
      replica('video_info', key('b'), info('Other'))
    ]
  });
  const result = await searchVideoTitles(store, 'guest', 'abc', new AbortController().signal);
  assert.deepEqual(result, {
    hits: [{ key: a, title: 'ＡＢＣ 日本語', duration: 120, addedAt: 1 }],
    truncated: false
  });
  assert.equal(store.infos[0].payload.title, 'ＡＢＣ 日本語');
});

test('video title search ranks exact, prefix, boundary and interior matches', async () => {
  const store = new Store({
    infos: [
      replica('video_info', key('a'), info('Copycat notes')),
      replica('video_info', key('b'), info('A cat story')),
      replica('video_info', key('c'), info('Cat guide')),
      replica('video_info', key('d'), info('cat'))
    ]
  });
  const result = await searchVideoTitles(store, 'guest', 'cat', new AbortController().signal);
  assert.deepEqual(
    result.hits.map((hit) => hit.title),
    ['cat', 'Cat guide', 'A cat story', 'Copycat notes']
  );
});

test('video title relevance uses the best occurrence and code-point position', async () => {
  const store = new Store({
    infos: [
      replica('video_info', key('a'), info('Copycat only')),
      replica('video_info', key('b'), info('Copycat cat')),
      replica('video_info', key('c'), info('abc cat')),
      replica('video_info', key('d'), info('🐱x cat trailing text'))
    ]
  });
  const result = await searchVideoTitles(store, 'guest', 'cat', new AbortController().signal);
  assert.deepEqual(
    result.hits.map((hit) => hit.title),
    ['🐱x cat trailing text', 'abc cat', 'Copycat cat', 'Copycat only']
  );
});

test('transcript search uses saved delay, prefers authored transcription, and deduplicates equivalent cues', async () => {
  const a = key('a');
  const authored = '00000000-0000-4000-8000-000000000001';
  const generated = '00000000-0000-4000-8000-000000000002';
  const store = new Store({
    infos: [replica('video_info', a, info('Movie'))],
    resumes: [replica('video_resume', a, resume(a, { [authored]: 1.25 }))],
    tracks: new Map([
      [
        a,
        [
          track(generated, a, [cue('generated', 10, '同じ 文')], {
            origin: 'generated',
            createdAt: 20
          }),
          track(authored, a, [cue('authored', 10, '同じ 文')])
        ]
      ]
    ])
  });
  const result = await searchVideoTranscripts(store, 'guest', '同じ', new AbortController().signal);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].trackId, authored);
  assert.equal(result.hits[0].cueId, 'authored');
  assert.equal(result.hits[0].time, 11.25);
  assert.equal(result.failed, 0);
  assert.equal(result.scanned, 1);
});

test('transcript search never includes incomplete tracks and clips by code point', async () => {
  const a = key('a');
  const complete = '00000000-0000-4000-8000-000000000003';
  const incomplete = '00000000-0000-4000-8000-000000000004';
  const long = 'needle ' + '😀'.repeat(400);
  const store = new Store({
    infos: [replica('video_info', a, info('Movie'))],
    tracks: new Map([
      [
        a,
        [
          track(incomplete, a, [cue('draft', 1, 'needle draft')], { complete: false }),
          track(complete, a, [cue('published', 2, long)])
        ]
      ]
    ])
  });
  const result = await searchVideoTranscripts(
    store,
    'guest',
    'needle',
    new AbortController().signal
  );
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].cueId, 'published');
  assert.equal(Array.from(result.hits[0].text).length, 360);
  assert.equal(result.hits[0].text.endsWith('…'), true);
  const last = result.hits[0].text.charCodeAt(result.hits[0].text.length - 1);
  assert.equal(last >= 0xd800 && last <= 0xdbff, false);
});

test('transcript search caps each video while continuing into other videos', async () => {
  const a = key('a');
  const b = key('b');
  const many = Array.from({ length: 30 }, (_, i) => cue('a-' + i, i, 'needle ' + i));
  const store = new Store({
    infos: [replica('video_info', a, info('A', 2)), replica('video_info', b, info('B', 1))],
    tracks: new Map([
      [a, [track('00000000-0000-4000-8000-000000000005', a, many)]],
      [b, [track('00000000-0000-4000-8000-000000000006', b, [cue('b', 1, 'needle b')])]]
    ])
  });
  const result = await searchVideoTranscripts(
    store,
    'guest',
    'needle',
    new AbortController().signal
  );
  assert.equal(result.hits.filter((hit) => hit.key === a).length, 24);
  assert.equal(result.hits.filter((hit) => hit.key === b).length, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.scanned, 2);
});

test('transcript search enumerates manifests once and skips videos without captions', async () => {
  const a = key('a');
  const b = key('b');
  const c = key('c');
  const store = new Store({
    infos: [
      replica('video_info', a, info('A', 3)),
      replica('video_info', b, info('B', 2)),
      replica('video_info', c, info('No captions', 1))
    ],
    tracks: new Map([
      [a, [track('00000000-0000-4000-8000-000000000009', a, [cue('a', 1, 'needle a')])]],
      [b, [track('00000000-0000-4000-8000-000000000010', b, [cue('b', 2, 'needle b')])]]
    ])
  });
  store.manifestSnapshot = [
    { mediaKey: a, marker: 'a' },
    { mediaKey: b, marker: 'b' }
  ];
  const result = await searchVideoTranscripts(
    store,
    'guest',
    'needle',
    new AbortController().signal
  );
  assert.equal(result.hits.length, 2);
  assert.equal(store.manifestReads, 1);
  assert.equal(result.scanned, 3);
  assert.equal(store.trackSignals.length, 2);
  assert.equal(store.seenManifestSnapshots.length, 2);
  assert.deepEqual(
    store.seenManifestSnapshots.map((snapshot) => snapshot.map((row) => row.marker)),
    [['a'], ['b']]
  );
});

test('one corrupt transcript snapshot does not hide other video matches', async () => {
  const a = key('a');
  const b = key('b');
  const store = new Store({
    infos: [replica('video_info', a, info('A', 2)), replica('video_info', b, info('B', 1))],
    failures: new Set([a]),
    tracks: new Map([
      [b, [track('00000000-0000-4000-8000-000000000007', b, [cue('b', 3, 'needle')])]]
    ])
  });
  const batches = [];
  const result = await searchVideoTranscripts(
    store,
    'guest',
    'needle',
    new AbortController().signal,
    (batch) => batches.push(batch)
  );
  assert.equal(result.failed, 1);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].key, b);
  assert.ok(batches.some((batch) => batch.failed === 1 && batch.scanned === 1));
});

test('abort fences transcript reads before storage work starts', async () => {
  const a = key('a');
  const controller = new AbortController();
  const store = new Store({
    infos: [replica('video_info', a, info('A'))],
    tracks: new Map([
      [a, [track('00000000-0000-4000-8000-000000000008', a, [cue('a', 1, 'needle')])]]
    ])
  });
  controller.abort(new DOMException('replaced', 'AbortError'));
  await assert.rejects(
    searchVideoTranscripts(store, 'guest', 'needle', controller.signal),
    /replaced/
  );
  assert.equal(store.trackSignals.length, 0);
});

test('media scope follows local profile ownership', () => {
  assert.equal(mediaScope(null), 'guest');
  assert.equal(mediaScope('user-1'), 'account:user-1');
});
