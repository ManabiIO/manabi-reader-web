import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALIGNMENT_LIMITS,
  ALIGNMENT_SAMPLE_RATE,
  WORD_ALIGNMENT_REVISION,
  planWordAlignmentBatches,
  mapPackedWordsToMedia,
  validateWordAlignmentJob,
  validateAlignmentBatchResult,
  prioritizeAlignmentBatches
} from '../../.cache/media-test-build/word-alignment.js';
import { WordAlignmentStore } from '../../.cache/media-test-build/word-alignment-store.js';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';

const cue = (id, start, end, text = id) => ({ id, start, end, text });
const hash = (c) => c.repeat(64);
const batch = (id = hash('d'), text = '日本') => ({
  batchId: id,
  words: [{ text, start: 1, end: 2 }],
  completedAt: 2
});
const job = (changes = {}) => ({
  version: 2,
  revision: 0,
  id: '00000000-0000-4000-8000-000000000001',
  mediaKey: `content:${hash('a')}`,
  trackId: '00000000-0000-4000-8000-000000000002',
  trackDigest: hash('b'),
  audioTrack: 'audio:ja',
  language: 'ja',
  engine: 'qwen3-forced-aligner',
  engineRevision: WORD_ALIGNMENT_REVISION,
  model: 'Qwen/Qwen3-ForcedAligner-0.6B',
  modelRevision: 'e'.repeat(40),
  modelSha256: hash('c'),
  status: 'queued',
  createdAt: 1,
  updatedAt: 1,
  plannedBatchIds: [hash('d'), hash('f')],
  completedBatchIds: [],
  results: [],
  ...changes
});

// Uses the production MediaStore transaction callbacks. This deterministic IDB
// boundary double is not a substitute for native persistence or worker tests.
async function stores(t, options = {}) {
  const original = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const factory = new TransactionFactory();
  Object.assign(factory, options);
  const connections = [new MediaStore(factory), new MediaStore(factory)];
  const wrappers = connections.map((store) => new WordAlignmentStore(store, 'guest'));
  t.after(async () => {
    await Promise.all(connections.map((store) => store.close()));
    globalThis.IDBKeyRange = original;
  });
  return { factory, connections, a: wrappers[0], b: wrappers[1] };
}
async function started(store, input = job()) {
  await store.put(input);
  return store.update(input.id, 0, (current) => ({ ...current, status: 'running' }));
}

test('planner rejects invalid raw cue times instead of repairing them with padding', () => {
  for (const c of [
    cue('x', 2, 1),
    cue('x', -1, 1),
    cue('x', 1, 1),
    cue('x', NaN, 2),
    cue('x', 1, Infinity)
  ])
    assert.throws(() => planWordAlignmentBatches([c]));
});

test('planner rejects malformed text, duplicate IDs and sparse input', () => {
  for (const value of [
    [cue('x', 1, 2, ' ')],
    [cue('x', 1, 2, '\ud800')],
    [cue('x', 1, 2), cue('x', 3, 4)],
    Array(1),
    null
  ])
    assert.throws(() => planWordAlignmentBatches(value));
});

test('batch IDs cannot collide through first/last delimiters or missing middle cues', () => {
  const options = { paddingSeconds: 0, bridgeSeconds: 2 };
  const first = planWordAlignmentBatches([cue('a', 0, 1), cue('b..c', 2, 3)], options)[0];
  const second = planWordAlignmentBatches([cue('a..b', 0, 1), cue('c', 2, 3)], options)[0];
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^[a-f0-9]{64}$/);
  const make = (middle) =>
    planWordAlignmentBatches([cue('a', 0, 1), cue(middle, 1, 2), cue('c', 2, 3)], options)[0].id;
  assert.notEqual(make('b'), make('different'));
});

test('batch identity includes text, timing, speaker and decode policy', () => {
  const input = [cue('x', 10, 11, '日本')];
  const id = planWordAlignmentBatches(input)[0].id;
  for (const replacement of [{ text: '日本語' }, { end: 11.01 }, { speaker: 'B' }])
    assert.notEqual(planWordAlignmentBatches([{ ...input[0], ...replacement }])[0].id, id);
  for (const options of [
    { paddingSeconds: 0 },
    { bridgeSeconds: 0 },
    { maximumBatchCues: 10 },
    { mediaDuration: 12 }
  ])
    assert.notEqual(planWordAlignmentBatches(input, options)[0].id, id);
  assert.equal(planWordAlignmentBatches(structuredClone(input))[0].id, id);
});

test('planner snapshots caller cues and preserves authored order for identical times', () => {
  const input = [cue('z', 1, 2), cue('a', 1, 2), cue('y', 1, 2)];
  const plans = planWordAlignmentBatches(input);
  assert.deepEqual(
    plans[0].cues.map((c) => c.id),
    ['z', 'a', 'y']
  );
  input[0].text = 'edited';
  input[0].start = 99;
  assert.equal(plans[0].cues[0].text, 'z');
  assert.equal(plans[0].cues[0].start, 1);
});

test('padded contexts clip to known media EOF and reject cues outside the source', () => {
  const [plan] = planWordAlignmentBatches([cue('x', 0, 2)], { mediaDuration: 2 });
  assert.equal(plan.segments[0].mediaStart, 0);
  assert.equal(plan.segments[0].mediaEnd, 2);
  assert.equal(plan.packedDuration, 2);
  assert.throws(() => planWordAlignmentBatches([cue('x', 1, 3)], { mediaDuration: 2 }));
  assert.throws(() => planWordAlignmentBatches([cue('x', 0, 0.00001)], { mediaDuration: 0.00001 }));
});

test('fractional cue durations accumulate exact sample counts within each batch', () => {
  const input = Array.from({ length: 500 }, (_, i) =>
    cue(String(i), i * 0.03125, i * 0.03125 + 0.02131)
  );
  const plans = planWordAlignmentBatches(input, {
    paddingSeconds: 0.025,
    maximumBatchSeconds: 1.013
  });
  for (const plan of plans) {
    let expected = 0;
    for (const segment of plan.segments) {
      assert.equal(Math.round(segment.packedStart * ALIGNMENT_SAMPLE_RATE), expected);
      expected +=
        Math.round(segment.mediaEnd * ALIGNMENT_SAMPLE_RATE) -
        Math.round(segment.mediaStart * ALIGNMENT_SAMPLE_RATE);
      assert.equal(Math.round(segment.packedEnd * ALIGNMENT_SAMPLE_RATE), expected);
    }
    assert.equal(plan.packedDuration, expected / ALIGNMENT_SAMPLE_RATE);
    assert.ok(expected <= Math.floor(1.013 * ALIGNMENT_SAMPLE_RATE));
  }
  assert.equal(plans.flatMap((p) => p.cues).length, input.length);
});

test('planner rejects unbounded options and exceeds neither configured nor hard limits', () => {
  for (const options of [
    { maximumBatchSeconds: 181 },
    { maximumBatchCues: 513 },
    { maximumBatchCues: 1.5 },
    { bridgeSeconds: NaN }
  ])
    assert.throws(() => planWordAlignmentBatches([cue('x', 1, 2)], options));
  assert.throws(() => planWordAlignmentBatches(Array(50001)));
  assert.deepEqual(planWordAlignmentBatches([]), []);
});

const mapSegments = () => [
  { cueId: 'a', mediaStart: 10, mediaEnd: 12, packedStart: 0, packedEnd: 2 },
  { cueId: 'b', mediaStart: 30, mediaEnd: 32, packedStart: 2, packedEnd: 4 }
];

test('mapping validates every segment, even segments not used by returned words', () => {
  const modifications = [
    { mediaEnd: 99 },
    { mediaStart: -1 },
    { packedStart: 1 },
    { packedStart: 3 },
    { packedEnd: 2 },
    { cueId: 'a' },
    { mediaStart: 30.00001 },
    { mediaEnd: Infinity },
    { unexpected: true }
  ];
  for (const change of modifications) {
    const segments = mapSegments();
    Object.assign(segments[1], change);
    assert.throws(() => mapPackedWordsToMedia([{ text: 'a', start: 0.1, end: 0.2 }], segments));
  }
});

test('mapping handles exact splice endpoints but never accepts crossing with a tolerance', () => {
  assert.deepEqual(
    mapPackedWordsToMedia(
      [
        { text: 'a', start: 1.5, end: 2 },
        { text: 'b', start: 2, end: 2.5 }
      ],
      mapSegments()
    ),
    [
      { text: 'a', start: 11.5, end: 12 },
      { text: 'b', start: 30, end: 30.5 }
    ]
  );
  for (const word of [
    { text: 'bad', start: 1.9, end: 2.0000001 },
    { text: 'bad', start: 1.9999999, end: 2.1 },
    { text: 'bad', start: 4, end: 5 }
  ])
    assert.throws(() => mapPackedWordsToMedia([word], mapSegments()), /splice/);
});

test('mapping rejects malformed, sparse, oversized or unordered output', () => {
  for (const words of [
    Array(1),
    Array(16001),
    [{ text: ' ', start: 0, end: 1 }],
    [
      { text: 'b', start: 1, end: 2 },
      { text: 'a', start: 0, end: 0.5 }
    ]
  ])
    assert.throws(() => mapPackedWordsToMedia(words, mapSegments()));
  assert.throws(() => mapPackedWordsToMedia([], Array(1)));
});

test('mapping preserves random sample-boundary intervals without cumulative drift', () => {
  let seed = 437;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  let packed = 0;
  const words = [],
    segments = [],
    expected = [];
  for (let i = 0; i < 100; i++) {
    const length = 100 + (random() % 1000),
      source = 300000 + (random() % 1000000000);
    segments.push({
      cueId: String(i),
      mediaStart: source / 16000,
      mediaEnd: (source + length) / 16000,
      packedStart: packed / 16000,
      packedEnd: (packed + length) / 16000
    });
    words.push({
      text: String(i),
      start: (packed + 10) / 16000,
      end: (packed + length - 10) / 16000
    });
    expected.push([source + 10, source + length - 10]);
    packed += length;
  }
  const actual = mapPackedWordsToMedia(words, segments);
  actual.forEach((word, i) =>
    assert.deepEqual([Math.round(word.start * 16000), Math.round(word.end * 16000)], expected[i])
  );
});

test('scheduler rejects NaN lookahead instead of silently scrambling priority', () => {
  assert.throws(() => prioritizeAlignmentBatches([], new Set(), 10, NaN));
});

test('job validation requires a frozen nonempty plan, version and immutable model revision', () => {
  assert.equal(validateWordAlignmentJob(job()).revision, 0);
  for (const changes of [
    { version: 1 },
    { revision: -1 },
    { revision: 0.5 },
    { plannedBatchIds: [] },
    { plannedBatchIds: [hash('d'), hash('d')] },
    { plannedBatchIds: ['old..id'] },
    { modelRevision: 'main' },
    { updatedAt: 0 },
    { surprise: true }
  ])
    assert.throws(() => validateWordAlignmentJob(job(changes)));
});

test('job validation rejects false completion, foreign result IDs and missing result rows', () => {
  for (const changes of [
    { status: 'complete' },
    { completedBatchIds: [hash('d')] },
    { results: [batch()] },
    { completedBatchIds: [hash('1')], results: [batch(hash('1'))] },
    { status: 'complete', completedBatchIds: [hash('d')], results: [batch()] }
  ])
    assert.throws(() => validateWordAlignmentJob(job(changes)));
});

test('alignment results reject empty, malformed, sparse and excessive word arrays', () => {
  for (const result of [
    batch('old..id'),
    { ...batch(), words: [] },
    { ...batch(), words: Array(1) },
    { ...batch(), words: Array(ALIGNMENT_LIMITS.wordsPerBatch + 1) },
    { ...batch(), completedAt: NaN }
  ])
    assert.throws(() => validateAlignmentBatchResult(result));
});

test('alignment validator returns detached snapshots of nested results and plan', () => {
  const input = job({ status: 'running', completedBatchIds: [hash('d')], results: [batch()] });
  const validated = validateWordAlignmentJob(input);
  input.results[0].words[0].text = 'edited';
  input.plannedBatchIds[0] = hash('1');
  assert.equal(validated.results[0].words[0].text, '日本');
  assert.equal(validated.plannedBatchIds[0], hash('d'));
});

test('concurrent job creation never overwrites the winning source identity', async (t) => {
  const { a, b } = await stores(t);
  const input = job();
  const other = job({ trackDigest: hash('9') });
  const outcomes = await Promise.allSettled([a.put(input), b.put(other)]);
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((o) => o.status === 'rejected').length, 1);
  assert.deepEqual(await a.get(input.id), input);
  await b.put(structuredClone(input));
});

test('put cannot reset running, paused or completed history', async (t) => {
  const { a } = await stores(t);
  const running = await started(a);
  await assert.rejects(a.put(job()), /already exists/);
  await assert.rejects(a.put({ ...running, trackDigest: hash('9') }), /already exists/);
  const paused = await a.update(running.id, running.revision, (j) => ({ ...j, status: 'paused' }));
  await assert.rejects(a.put(job()), /already exists/);
  assert.deepEqual(await a.get(running.id), paused);
});

test('updates cannot rebind immutable source/plan or bypass result publication', async (t) => {
  const { a } = await stores(t);
  const current = await started(a);
  const changes = [
    { trackDigest: hash('9') },
    { audioTrack: 'commentary' },
    { modelSha256: hash('9') },
    { plannedBatchIds: [hash('d')] },
    { language: 'en' },
    { createdAt: 0 },
    { revision: 200 },
    { completedBatchIds: [hash('d')], results: [batch()] }
  ];
  for (const change of changes) {
    await assert.rejects(async () =>
      a.update(current.id, current.revision, (j) => Object.assign(j, change))
    );
    assert.deepEqual(await a.get(current.id), current);
  }
});

test('two connections cannot consume the same revision for competing state edits', async (t) => {
  const { a, b } = await stores(t);
  const current = await started(a);
  const outcomes = await Promise.allSettled([
    a.update(current.id, current.revision, (j) => ({ ...j, status: 'paused' })),
    b.checkpoint(current.id, batch(), current.revision)
  ]);
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((o) => o.status === 'rejected').length, 1);
  const saved = await a.get(current.id);
  assert.equal(saved.status, 'paused');
  assert.equal(saved.results.length, 0);
});

test('pause then restart fences an old completion even when status is running again', async (t) => {
  const { a, b } = await stores(t);
  const current = await started(a);
  const paused = await b.update(current.id, current.revision, (j) => ({ ...j, status: 'paused' }));
  const restarted = await b.update(current.id, paused.revision, (j) => ({
    ...j,
    status: 'running'
  }));
  await assert.rejects(a.checkpoint(current.id, batch(), current.revision), /state changed/);
  await assert.rejects(a.complete(current.id, current.revision), /state changed/);
  assert.deepEqual(await a.get(current.id), restarted);
});

test('completion verifies the stored whole plan, not a caller subset or stopped job', async (t) => {
  const { a } = await stores(t);
  let current = await started(a);
  current = await a.checkpoint(current.id, batch(), current.revision);
  await assert.rejects(a.complete(current.id, current.revision), /missing batches/);
  await assert.rejects(async () => a.complete(current.id, []), /exact alignment revision/);
  current = await a.checkpoint(current.id, batch(hash('f')), current.revision);
  const paused = await a.update(current.id, current.revision, (j) => ({ ...j, status: 'paused' }));
  await assert.rejects(a.complete(current.id, paused.revision), /Inactive/);
  current = await a.update(current.id, paused.revision, (j) => ({ ...j, status: 'running' }));
  const complete = await a.complete(current.id, current.revision);
  assert.equal(complete.status, 'complete');
  assert.equal(complete.revision, current.revision + 1);
  assert.deepEqual(await a.complete(current.id, complete.revision), complete);
  assert.deepEqual(await a.checkpoint(current.id, batch(), complete.revision), complete);
  await assert.rejects(
    a.checkpoint(current.id, batch(hash('d'), 'changed'), complete.revision),
    /different/
  );
  await assert.rejects(
    a.update(current.id, complete.revision, (j) => ({ ...j, status: 'running' }))
  );
});

test('foreign batch results are rejected atomically', async (t) => {
  const { a } = await stores(t);
  const current = await started(a);
  await assert.rejects(a.checkpoint(current.id, batch(hash('9')), current.revision), /frozen plan/);
  assert.deepEqual(await a.get(current.id), current);
});

test('creation and checkpoints snapshot inputs before waiting on the database', async (t) => {
  const { a, factory } = await stores(t, { holdOpen: true });
  const input = job();
  const pending = a.put(input);
  input.trackDigest = hash('9');
  input.plannedBatchIds[0] = hash('9');
  factory.releaseOpen();
  await pending;
  assert.deepEqual(await a.get(input.id), job());
  const current = await a.update(input.id, 0, (j) => ({ ...j, status: 'running' }));
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  factory.queue = factory.queue.then(() => gate);
  const output = batch();
  const checkpoint = a.checkpoint(current.id, output, current.revision);
  output.words[0].text = 'edited';
  output.batchId = hash('9');
  release();
  const saved = await checkpoint;
  assert.deepEqual(saved.results, [batch()]);
});

test('a failed checkpoint commit preserves both revision and previous results for retry', async (t) => {
  const { a, factory } = await stores(t);
  const current = await started(a);
  factory.failNextCommit = new DOMException('Injected quota', 'QuotaExceededError');
  await assert.rejects(a.checkpoint(current.id, batch(), current.revision));
  assert.deepEqual(await a.get(current.id), current);
  const saved = await a.checkpoint(current.id, batch(), current.revision);
  assert.equal(saved.revision, current.revision + 1);
});

test('missing or invalid revision approval cannot mutate data', async (t) => {
  const { a } = await stores(t);
  const current = await started(a);
  for (const revision of [undefined, NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(
      async () => a.checkpoint(current.id, batch(), revision),
      /exact alignment revision/
    );
  assert.deepEqual(await a.get(current.id), current);
});

test('fresh insert requires queued empty state and existing-key reads verify identity', async (t) => {
  const { a, connections } = await stores(t);
  for (const changes of [{ status: 'running' }, { revision: 1 }, { error: 'stale' }])
    await assert.rejects(a.put(job(changes)), /fresh queued/);
  const input = job();
  await connections[0].putLocal('guest', 'word-alignment', input.id, job({ id: input.trackId }));
  await assert.rejects(a.get(input.id), /storage key/);
});

test('transcript and alignment payload budgets reject oversized Unicode data', () => {
  const line = 'あ'.repeat(8192);
  assert.throws(
    () =>
      planWordAlignmentBatches(
        Array.from({ length: 700 }, (_, i) => cue(String(i), i, i + 0.5, line))
      ),
    /byte limit/
  );
  const words = Array.from({ length: 6000 }, () => ({ text: 'あ'.repeat(1024), start: 1, end: 2 }));
  assert.throws(() => validateAlignmentBatchResult({ ...batch(), words }), /byte limit/);
});

test('store rejects exhausted revisions rather than wrapping approval identity', async (t) => {
  const { a, connections } = await stores(t);
  const current = job({ status: 'running', revision: Number.MAX_SAFE_INTEGER });
  await connections[0].putLocal('guest', 'word-alignment', current.id, current);
  await assert.rejects(a.checkpoint(current.id, batch(), current.revision), /revision exhausted/);
  assert.deepEqual(await a.get(current.id), current);
});
