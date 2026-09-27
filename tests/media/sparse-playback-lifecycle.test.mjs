/** Sparse playback checkpoints, seek priority, interruption, and publication. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { downloadSubtitles } from '../../.cache/media-test-build/subtitle-download.js';
import { serializeSubtitles } from '../../.cache/media-test-build/captions.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';

const key = `content:${'a'.repeat(64)}`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
async function until(read) {
  for (let n = 0; n < 1000; n++) {
    const result = await read();
    if (result) return result;
    await tick();
  }
  throw new Error('Timed out waiting for a transcription checkpoint');
}

test('seeking ahead keeps completed windows, then resume fills every gap before SRT publication', async () => {
  const range = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'sparse-playback-lifecycle');
  const reads = [];
  let queue;
  let transcriptions = 0;
  let blockThirdDecode = true;
  let jobId;
  queue = new TranscriptionQueue(
    store,
    'guest',
    {
      async prepare() {},
      async transcribe() {
        if (++transcriptions === 1) queue.prioritize(jobId, 82);
        return '[5][S01]字幕があります。[6]';
      },
      dispose() {}
    },
    async (_job, start, end, signal) => {
      jobId = _job.id;
      reads.push([start, end]);
      if (reads.length === 3 && blockThirdDecode) {
        await new Promise((_, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      return new Float32Array(Math.ceil((end - start) * 16000)).fill(0.1);
    }
  );
  let job;
  try {
    job = await queue.enqueue(key, 'ja', '1', 104, 0);
    const checkpoint = await until(async () => {
      const saved = await store.local('guest', 'jobs', job.id);
      return reads.length === 3 && saved?.nextWindow === 2 ? saved : undefined;
    });
    assert.equal(checkpoint.status, 'running');
    assert.deepEqual(
      reads.slice(0, 2).map(([start]) => start),
      [0, 76]
    );
    assert.equal(checkpoint.sparse.windows.filter(Boolean).length, 2);
    assert.equal((await store.tracks('guest', key)).length, 0);
    assert.throws(
      () => downloadSubtitles('video.mp4', { complete: false, cues: checkpoint.cues }),
      /Finish transcription/
    );

    await queue.cancel(job.id);
    await until(async () => (await store.local('guest', 'jobs', job.id))?.status === 'paused');
    if (queue.task) await queue.task;
    const paused = await store.local('guest', 'jobs', job.id);
    assert.equal(paused.nextWindow, 2);
    assert.equal(paused.sparse.windows.filter(Boolean).length, 2);
    assert.equal((await store.tracks('guest', key)).length, 0);

    blockThirdDecode = false;
    await queue.resume(job.id);
    const completed = await until(async () => {
      const saved = await store.local('guest', 'jobs', job.id);
      return saved?.status === 'complete' ? saved : undefined;
    });
    const [track] = await store.tracks('guest', key);
    assert.equal(completed.nextWindow, 4);
    assert.equal(track.complete, true);
    assert.equal(track.cues.length, 4);
    assert.equal(serializeSubtitles(track).match(/字幕があります。/g)?.length, 4);
    assert.deepEqual(new Set(reads.map(([start]) => start)), new Set([0, 24, 50, 76]));
    assert.equal(reads.filter(([start]) => start === 0).length, 1);
    assert.equal(reads.filter(([start]) => start === 76).length, 1);
  } finally {
    await queue.dispose();
    await store.close();
    if (range === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = range;
  }
});
