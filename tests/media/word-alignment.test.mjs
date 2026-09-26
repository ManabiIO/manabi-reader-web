import test from 'node:test';
import assert from 'node:assert/strict';
import {
  karaokeWordProgress,
  mapPackedWordsToMedia,
  planWordAlignmentBatches,
  prioritizeAlignmentBatches,
  validateWordAlignmentJob
} from '../../.cache/media-test-build/word-alignment.js';

const cue = (id, start, end, text = id) => ({
  id,
  start,
  end,
  text
});

test('speech-island planning skips long silence but merges nearby cues', () => {
  const batches = planWordAlignmentBatches(
    [
      cue('a', 10, 11),
      cue('b', 12, 13),
      cue('c', 100, 101)
    ],
    { paddingSeconds: 1, bridgeSeconds: 1.5 }
  );
  assert.equal(batches.length, 2);
  assert.deepEqual(
    batches[0].cues.map((x) => x.id),
    ['a', 'b']
  );
  assert.deepEqual(
    batches[1].cues.map((x) => x.id),
    ['c']
  );
});

test('planner enforces cue-count and duration bounds', () => {
  const cues = Array.from({ length: 6 }, (_, i) =>
    cue(String(i), i * 2, i * 2 + 1)
  );
  const batches = planWordAlignmentBatches(cues, {
    maximumBatchCues: 2,
    paddingSeconds: 0,
    bridgeSeconds: 2
  });
  assert.deepEqual(
    batches.map((b) => b.cues.length),
    [2, 2, 2]
  );
  assert.throws(
    () =>
      planWordAlignmentBatches([cue('x', 0, 30)], {
        maximumBatchSeconds: 10
      }),
    /exceeds/
  );
});

test('packed words map exactly back to their source segment', () => {
  const segments = [
    {
      cueId: 'a',
      mediaStart: 10,
      mediaEnd: 12,
      packedStart: 0,
      packedEnd: 2
    },
    {
      cueId: 'b',
      mediaStart: 30,
      mediaEnd: 32,
      packedStart: 2,
      packedEnd: 4
    }
  ];
  const mapped = mapPackedWordsToMedia(
    [
      { text: '一', start: 0.25, end: 0.75 },
      { text: '二', start: 2.5, end: 3.25 }
    ],
    segments
  );
  assert.deepEqual(mapped, [
    { text: '一', start: 10.25, end: 10.75 },
    { text: '二', start: 30.5, end: 31.25 }
  ]);
});

test('packed words crossing a synthetic splice fail closed', () => {
  const segments = [
    {
      cueId: 'a',
      mediaStart: 10,
      mediaEnd: 12,
      packedStart: 0,
      packedEnd: 2
    },
    {
      cueId: 'b',
      mediaStart: 30,
      mediaEnd: 32,
      packedStart: 2,
      packedEnd: 4
    }
  ];
  assert.throws(
    () =>
      mapPackedWordsToMedia(
        [{ text: 'bad', start: 1.9, end: 2.1 }],
        segments
      ),
    /splice/
  );
});

test('playhead scheduling prioritizes near future without discarding earlier work', () => {
  const batches = [
    {
      id: 'past',
      mediaStart: 0,
      mediaEnd: 30,
      packedDuration: 30,
      cues: [],
      segments: []
    },
    {
      id: 'near',
      mediaStart: 80,
      mediaEnd: 100,
      packedDuration: 20,
      cues: [],
      segments: []
    },
    {
      id: 'future',
      mediaStart: 400,
      mediaEnd: 420,
      packedDuration: 20,
      cues: [],
      segments: []
    }
  ];
  assert.deepEqual(
    prioritizeAlignmentBatches(
      batches,
      new Set(),
      90,
      120
    ).map((x) => x.id),
    ['near', 'past', 'future']
  );
  assert.deepEqual(
    prioritizeAlignmentBatches(
      batches,
      new Set(['near']),
      90,
      120
    ).map((x) => x.id),
    ['past', 'future']
  );
});

test('karaoke wipe is continuous only inside an authoritative word interval', () => {
  const word = { text: '日本語', start: 5, end: 7 };
  assert.equal(karaokeWordProgress(word, 4.9), 0);
  assert.equal(karaokeWordProgress(word, 5), 0);
  assert.equal(karaokeWordProgress(word, 6), 0.5);
  assert.equal(karaokeWordProgress(word, 7), 1);
});

test('durable job validation fences transcript/model identity and duplicate results', () => {
  const base = {
    version: 1,
    id: '00000000-0000-4000-8000-000000000001',
    mediaKey: `content:${'a'.repeat(64)}`,
    trackId: '00000000-0000-4000-8000-000000000002',
    trackDigest: 'b'.repeat(64),
    audioTrack: 'audio:ja',
    language: 'ja',
    engine: 'qwen3-forced-aligner',
    engineRevision: 'qwen3-packed-v1',
    model: 'Qwen/Qwen3-ForcedAligner-0.6B',
    modelRevision: 'main',
    modelSha256: 'c'.repeat(64),
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    completedBatchIds: ['a..b'],
    results: [
      {
        batchId: 'a..b',
        words: [{ text: '日本', start: 1, end: 2 }],
        completedAt: 2
      }
    ]
  };
  assert.equal(validateWordAlignmentJob(base).language, 'ja');
  assert.throws(
    () =>
      validateWordAlignmentJob({
        ...base,
        modelSha256: 'nope'
      }),
    /Invalid/
  );
  assert.throws(
    () =>
      validateWordAlignmentJob({
        ...base,
        results: [...base.results, base.results[0]]
      }),
    /Duplicate alignment result/
  );
});
