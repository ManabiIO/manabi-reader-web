import test from 'node:test';
import assert from 'node:assert/strict';
import {
  karaokeWordProgress,
  mapPackedWordsToMedia,
  planWordAlignmentBatches,
  prioritizeAlignmentBatches,
  validateWordAlignmentJob
} from '../../.cache/media-test-build/word-alignment.js';

import { WordAlignmentStore } from '../../.cache/media-test-build/word-alignment-store.js';

const cue = (id, start, end, text = id) => ({
  id,
  start,
  end,
  text
});

test('speech-island planning skips long silence but merges nearby cues', () => {
  const batches = planWordAlignmentBatches(
    [cue('a', 10, 11), cue('b', 12, 13), cue('c', 100, 101)],
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
  const cues = Array.from({ length: 6 }, (_, i) => cue(String(i), i * 2, i * 2 + 1));
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
    () => mapPackedWordsToMedia([{ text: 'bad', start: 1.9, end: 2.1 }], segments),
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
    prioritizeAlignmentBatches(batches, new Set(), 90, 120).map((x) => x.id),
    ['near', 'past', 'future']
  );
  assert.deepEqual(
    prioritizeAlignmentBatches(batches, new Set(['near']), 90, 120).map((x) => x.id),
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
    version: 2,
    revision: 0,
    plannedBatchIds: ['d'.repeat(64)],
    id: '00000000-0000-4000-8000-000000000001',
    mediaKey: `content:${'a'.repeat(64)}`,
    trackId: '00000000-0000-4000-8000-000000000002',
    trackDigest: 'b'.repeat(64),
    audioTrack: 'audio:ja',
    language: 'ja',
    engine: 'qwen3-forced-aligner',
    engineRevision: 'qwen3-packed-v2',
    model: 'Qwen/Qwen3-ForcedAligner-0.6B',
    modelRevision: 'e'.repeat(40),
    modelSha256: 'c'.repeat(64),
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    completedBatchIds: ['d'.repeat(64)],
    results: [
      {
        batchId: 'd'.repeat(64),
        words: [{ text: '日本', start: 1, end: 2 }],
        completedAt: 2
      }
    ]
  };
  assert.equal(validateWordAlignmentJob(base).language, 'ja');
  for (const status of ['running', 'complete']) {
    assert.throws(
      () => validateWordAlignmentJob({ ...base, status, results: [] }),
      /must match durable results/
    );
    assert.throws(
      () => validateWordAlignmentJob({ ...base, status, completedBatchIds: [] }),
      /must match durable results/
    );
    assert.throws(
      () => validateWordAlignmentJob({ ...base, status, completedBatchIds: ['f'.repeat(64)] }),
      /must match durable results/
    );
  }
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
    /Invalid word-alignment job|Duplicate alignment result/
  );
});

test('overlapping cue padding cannot exceed the packed inference duration limit', () => {
  const cues = Array.from({ length: 8 }, (_, i) => cue(String(i), 10, 11));
  const batches = planWordAlignmentBatches(cues, {
    paddingSeconds: 1,
    maximumBatchSeconds: 10
  });
  assert.deepEqual(
    batches.map((batch) => batch.cues.length),
    [3, 3, 2]
  );
  assert.deepEqual(
    batches.flatMap((batch) => batch.cues.map((item) => item.id)),
    cues.map((item) => item.id)
  );
  for (const batch of batches) {
    assert.ok(
      batch.packedDuration <= 10,
      `Packed audio exceeds the bound: ${batch.packedDuration}`
    );
    assert.equal(batch.segments.at(-1).packedEnd, batch.packedDuration);
  }
});

test('durable alignment checkpoints reject stopped jobs and preserve completion', async () => {
  const result = {
    batchId: 'd'.repeat(64),
    words: [{ text: '日本', start: 1, end: 2 }],
    completedAt: 2
  };
  const base = {
    version: 2,
    revision: 0,
    plannedBatchIds: ['d'.repeat(64)],
    id: '00000000-0000-4000-8000-000000000001',
    mediaKey: `content:${'a'.repeat(64)}`,
    trackId: '00000000-0000-4000-8000-000000000002',
    trackDigest: 'b'.repeat(64),
    audioTrack: 'audio:ja',
    language: 'ja',
    engine: 'qwen3-forced-aligner',
    engineRevision: 'qwen3-packed-v2',
    model: 'Qwen/Qwen3-ForcedAligner-0.6B',
    modelRevision: 'e'.repeat(40),
    modelSha256: 'c'.repeat(64),
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    completedBatchIds: [],
    results: []
  };
  // Transaction double exercises the wrapper's admission rules, not native IDB.
  let durable = structuredClone(base);
  const store = new WordAlignmentStore(
    {
      async updateLocal(_scope, _kind, _id, change) {
        const next = change(structuredClone(durable));
        durable = next;
        return next;
      }
    },
    'guest'
  );
  for (const status of ['paused', 'failed']) {
    durable = { ...base, status };
    await assert.rejects(store.checkpoint(base.id, result, durable.revision), /Inactive/);
    assert.equal(durable.status, status);
    assert.deepEqual(durable.results, []);
  }
  durable = structuredClone(base);
  await store.checkpoint(base.id, result, durable.revision);
  await assert.rejects(async () => store.complete(base.id, undefined), /exact alignment revision/);
  await store.complete(base.id, durable.revision);
  await store.checkpoint(base.id, result, durable.revision);
  assert.equal(durable.status, 'complete');
  await assert.rejects(
    store.checkpoint(base.id, { ...result, batchId: 'f'.repeat(64) }, durable.revision),
    /new checkpoint/
  );
  await assert.rejects(
    store.checkpoint(
      base.id,
      { ...result, words: [{ text: '別', start: 1, end: 2 }] },
      durable.revision
    ),
    /different durable output/
  );
  await assert.rejects(
    store.update(base.id, durable.revision, (job) => ({ ...job, id: base.trackId })),
    /identity cannot change/
  );
  assert.equal(durable.id, base.id);
  assert.deepEqual(durable.results, [result]);
});
