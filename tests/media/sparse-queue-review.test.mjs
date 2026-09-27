/** Real queue/checkpoints with scripted inference and a transaction double. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { MOSS } from '../../.cache/media-test-build/model-cache.js';
import {
  newSparseState,
  safeSparseCues
} from '../../.cache/media-test-build/sparse-transcription.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';

const key = 'content:' + '9'.repeat(64);
const cue = (w, text) => ({ id: `w${w}/cue-0`, start: 24, end: 27, text });
const savedJob = (duration) => ({
  version: 3,
  sparse: newSparseState(duration),
  id: crypto.randomUUID(),
  mediaKey: key,
  language: 'ja',
  audioTrack: '1',
  duration,
  status: 'failed',
  nextWindow: 0,
  cues: [],
  modelSha256: MOSS.sha256,
  engineRevision: MOSS.engineRevision,
  createdAt: 1
});
const pendingSeam = (duration) => {
  const job = savedJob(duration);
  job.sparse.windows[0] = { cues: [cue(0, '左の候補')], inferenceMs: 1000 };
  job.sparse.windows[1] = { cues: [cue(1, '右の候補')], inferenceMs: 1000 };
  job.nextWindow = 2;
  job.cues = safeSparseCues(job.sparse, duration);
  return job;
};
async function harness({ duration = 78, target = 0, initial, decode, transcribe }, body) {
  const range = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'sparse-review');
  const events = [],
    inputs = [],
    reads = [];
  let prepared = 0;
  let queue;
  queue = new TranscriptionQueue(
    store,
    'guest',
    {
      async prepare() {
        prepared++;
      },
      async transcribe(pcm) {
        inputs.push(pcm.length);
        return transcribe
          ? transcribe(pcm, queue, events, inputs.length)
          : reads.at(-1)[0] === 0
            ? '[3][S01]文章です。[4]'
            : '[6][S01]文章です。[7]';
      },
      dispose() {}
    },
    async (job, start, end) => {
      reads.push([start, end]);
      return decode
        ? decode(job, start, end, reads.length)
        : new Float32Array(Math.ceil((end - start) * 16000)).fill(0.1);
    },
    (p) => events.push(structuredClone(p))
  );
  try {
    let job;
    if (initial) {
      await store.putLocal('guest', 'jobs', initial.id, initial);
      await queue.resume(initial.id);
      job = initial;
    } else job = await queue.enqueue(key, 'ja', '1', duration, target);
    for (let n = 0; n < 500; n++) {
      const saved = await store.local('guest', 'jobs', job.id);
      if (
        saved &&
        ['complete', 'failed', 'paused'].includes(saved.status) &&
        events.some((p) => ['complete', 'failed', 'paused'].includes(p.stage))
      ) {
        await body({ saved, events, inputs, reads, prepared, store, queue });
        return;
      }
      await new Promise((r) => setTimeout(r, 1));
    }
    throw Error('Queue did not settle');
  } finally {
    await queue.dispose();
    await store.close();
    if (range === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = range;
  }
}

test('the sparse model input never exceeds its encoder block because of one rounded sample', () =>
  harness(
    {
      target: 31,
      decode: async (_job, a, b) => new Float32Array(Math.ceil((b - a) * 16000) + 1).fill(0.1)
    },
    async ({ saved, inputs, reads }) => {
      assert.equal(saved.status, 'complete', saved.error);
      assert.deepEqual(
        inputs,
        reads.map(([a, b]) => Math.ceil(b * 16000) - Math.round(a * 16000))
      );
      assert.ok(inputs.every((n) => n <= 480000));
    }
  ));
test('a short sparse decode is rejected instead of silently omitting an audio sample', () =>
  harness(
    {
      target: 31,
      decode: async (_job, a, b) => new Float32Array(Math.ceil((b - a) * 16000) - 1).fill(0.1)
    },
    async ({ saved, prepared, inputs }) => {
      assert.equal(saved.status, 'failed');
      assert.equal(prepared, 0);
      assert.deepEqual(inputs, []);
    }
  ));
test('a seek made during inference survives the next durable checkpoint', () =>
  harness(
    {
      duration: 104,
      decode: async (_job, a, b, n) => {
        if (n > 1) throw Error('stop after the durable checkpoint');
        return new Float32Array(Math.ceil((b - a) * 16000)).fill(0.1);
      },
      transcribe: async (_pcm, queue, events) => {
        queue.prioritize(events[0].job.id, 62);
        return '[3][S01]文章です。[4]';
      }
    },
    async ({ saved, reads }) => {
      assert.equal(saved.status, 'failed');
      assert.equal(saved.sparse.targetSeconds, 62);
      assert.equal(reads[1][0], 50);
    }
  ));
test('sparse failure progress uses covered seconds and the actual video duration', () =>
  harness(
    {
      decode: async (_job, a, b, n) => {
        if (n > 1) throw Error('source unavailable');
        return new Float32Array(Math.ceil((b - a) * 16000)).fill(0.1);
      }
    },
    async ({ events }) => {
      const failed = events.find((p) => p.stage === 'failed');
      assert.equal(failed.loaded, 26);
      assert.equal(failed.total, 78);
    }
  ));
test('resume retries a saved near-playhead seam before decoding unrelated missing cores', () =>
  harness(
    {
      initial: pendingSeam(78),
      transcribe: async (pcm) =>
        pcm.length > 480000 ? '[24][S01]修復した文章です。[27]' : '[6][S01]後の文章です。[7]'
    },
    async ({ saved, reads }) => {
      assert.equal(saved.status, 'complete', saved.error);
      assert.deepEqual(reads, [
        [0, 54],
        [50, 78]
      ]);
    }
  ));
test('a repair-only resume records the runtime that actually performed the new inference', () => {
  const initial = pendingSeam(52);
  initial.engineRevision = MOSS.engineRevision.replace('manabi-web-v7', 'manabi-web-v6');
  return harness(
    { initial, transcribe: async () => '[24][S01]修復した文章です。[27]' },
    async ({ saved, store }) => {
      assert.equal(saved.status, 'complete', saved.error);
      const [track] = await store.tracks('guest', key);
      assert.match(track.provenance.engineRevision, /manabi-web-v6,manabi-web-v7$/);
    }
  );
});
function crossingOuterSeam() {
  const initial = savedJob(78);
  const accepted = { id: 'w0/cue-0', start: 23, end: 27, text: '保存済みの字幕' };
  initial.sparse.windows[0] = { cues: [accepted], inferenceMs: 1000 };
  initial.sparse.windows[1] = {
    cues: [
      { id: 'w1/cue-0', start: 24, end: 27, text: accepted.text },
      { id: 'w1/cue-1', start: 50, end: 53, text: '左の候補' }
    ],
    inferenceMs: 1000
  };
  initial.sparse.windows[2] = {
    cues: [{ id: 'w2/cue-0', start: 50, end: 53, text: '右の候補' }],
    inferenceMs: 1000
  };
  initial.nextWindow = 3;
  initial.cues = safeSparseCues(initial.sparse, 78);
  assert.deepEqual(initial.cues, [accepted]);
  return { initial, accepted };
}
test('a later seam repair carries a saved outer cue omitted by its shorter input', () => {
  const { initial, accepted } = crossingOuterSeam();
  return harness(
    { initial, transcribe: async () => '[26][S01]修復結果です。[29]' },
    async ({ saved, reads, store }) => {
      assert.equal(saved.status, 'complete', saved.error);
      assert.deepEqual(reads, [[24, 78]]);
      const [track] = await store.tracks('guest', key);
      assert.deepEqual(track.cues[0], accepted);
      assert.equal(track.cues[1].text, '修復結果です。');
    }
  );
});
test('conflicting speech at an accepted outer cue fails without losing the checkpoint', () => {
  const { initial, accepted } = crossingOuterSeam();
  return harness(
    { initial, transcribe: async () => '[0][S01]違う文章です。[3][26][S01]修復結果です。[29]' },
    async ({ saved, store }) => {
      assert.equal(saved.status, 'failed');
      assert.match(saved.error, /remove an accepted caption/);
      assert.deepEqual(saved.cues, [accepted]);
      assert.ok(saved.sparse.repairs.every((repair) => repair === null));
      assert.equal((await store.tracks('guest', key)).length, 0);
    }
  );
});
test('a repair that retains the accepted outer cue can still publish the whole track', () => {
  const { initial, accepted } = crossingOuterSeam();
  return harness(
    { initial, transcribe: async () => '[0][S01]保存済みの字幕[3][26][S01]修復結果です。[29]' },
    async ({ saved, store }) => {
      assert.equal(saved.status, 'complete', saved.error);
      const [track] = await store.tracks('guest', key);
      assert.deepEqual(track.cues[0], accepted);
      assert.equal(track.cues[1].text, '修復結果です。');
    }
  );
});
