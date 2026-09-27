import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { validateJob } from '../../.cache/media-test-build/jobs.js';
import {
  newSparseState,
  nextSparseWindow,
  safeSparseCues,
  sparseLead,
  sparseCoverage,
  sparseMissingWindowsForLead,
  assembleSparse,
  sparseBounds
} from '../../.cache/media-test-build/sparse-transcription.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';

const key = 'content:' + '6'.repeat(64);
const cue = (window, start, end, text) => ({
  id: `w${window}/cue-${Math.round(start * 10)}`,
  start,
  end,
  text
});
test('sparse coverage follows seeks and never schedules a completed window twice', () => {
  const state = newSparseState(78, 62);
  assert.equal(nextSparseWindow(state), 2);
  state.windows[2] = { cues: [], inferenceMs: 42000 };
  assert.equal(nextSparseWindow(state), 1);
  state.targetSeconds = 0;
  assert.equal(nextSparseWindow(state), 0);
  state.windows[0] = { cues: [], inferenceMs: 42000 };
  assert.equal(nextSparseWindow(state), 1);
  state.windows[1] = { cues: [], inferenceMs: 42000 };
  assert.equal(nextSparseWindow(state), -1);
  assert.equal(sparseCoverage(state, 78), 78);
  assert.equal(sparseLead(state, 78, 10), 68);
  const seek = newSparseState(78, 26.5);
  seek.windows[1] = { cues: [], inferenceMs: 42000 };
  assert.equal(nextSparseWindow(seek), 0, 'the missing previous seam beats a future core');
  assert.deepEqual(sparseMissingWindowsForLead(seek, 78, 26.5, 26), [0, 2]);
  assert.deepEqual(sparseMissingWindowsForLead(seek, 78, 51, 26), [2]);
});
test('unresolved edges stay out of drafts until an adjacent hypothesis joins', () => {
  const state = newSparseState(52);
  state.windows[0] = {
    cues: [cue(0, 4, 5, 'first'), cue(0, 24.5, 25, 'edge')],
    inferenceMs: 40000
  };
  assert.deepEqual(
    safeSparseCues(state, 52).map((c) => c.text),
    ['first']
  );
  assert.equal(sparseLead(state, 52, 24.5), 0);
  state.windows[1] = {
    cues: [cue(1, 24.5, 25, 'edge'), cue(1, 30, 31, 'last')],
    inferenceMs: 40000
  };
  assert.deepEqual(
    safeSparseCues(state, 52).map((c) => c.text),
    ['first', 'edge', 'last']
  );
  assert.deepEqual(
    assembleSparse(state).cues?.map((c) => c.text),
    ['first', 'edge', 'last']
  );
});
test('agreed whole cues crossing a seam margin appear, one-sided cues require repair', () => {
  const state = newSparseState(52);
  const agreed = cue(0, 23, 26, 'agreed line');
  state.windows[0] = { cues: [agreed], inferenceMs: 1 };
  state.windows[1] = {
    cues: [{ ...cue(1, 24, 26, 'agreed line'), id: 'w1/cue-0' }],
    inferenceMs: 1
  };
  assert.deepEqual(
    safeSparseCues(state, 52).map((c) => c.id),
    [agreed.id]
  );
  assert.equal(assembleSparse(state).repair, undefined);
  state.windows[1] = { cues: [], inferenceMs: 1 };
  assert.deepEqual(safeSparseCues(state, 52), []);
  assert.deepEqual(assembleSparse(state), { repair: 0 });
  assert.equal(sparseLead(state, 52, 0), 24);
});
test('an empty seam repair cannot erase recognized speech', () => {
  const state = newSparseState(52);
  state.windows[0] = { cues: [cue(0, 24, 27, 'spoken left')], inferenceMs: 1 };
  state.windows[1] = { cues: [cue(1, 24, 27, 'spoken right')], inferenceMs: 1 };
  state.repairs[0] = [];
  assert.deepEqual(assembleSparse(state), { repair: 0 });
  assert.throws(
    () =>
      validateJob({
        version: 3,
        sparse: state,
        id: crypto.randomUUID(),
        mediaKey: key,
        language: 'ja',
        audioTrack: '1',
        duration: 52,
        status: 'failed',
        nextWindow: 2,
        cues: [],
        modelSha256: 'a'.repeat(64),
        engineRevision: 'test',
        createdAt: Date.now()
      }),
    /Empty sparse seam repair/
  );
});
test('repaired drafts hold cues crossing the next unresolved boundary', () => {
  const state = newSparseState(78);
  state.windows[0] = { cues: [cue(0, 3, 4, 'early')], inferenceMs: 1 };
  state.windows[1] = { cues: [cue(1, 51, 53, 'next seam')], inferenceMs: 1 };
  state.repairs[0] = [
    { id: 'w0/repair-0', start: 3, end: 4, text: 'early' },
    { id: 'w0/repair-1', start: 51, end: 53, text: 'next seam' }
  ];
  assert.deepEqual(
    safeSparseCues(state, 78).map((c) => c.text),
    ['early']
  );
});
test('watched-through sparse job completes from one inference per window', async () => {
  const old = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'sparse-queue-tests');
  const decoded = [],
    inferred = [];
  let unblock;
  const first = new Promise((resolve) => {
    unblock = resolve;
  });
  const engine = {
    async prepare() {},
    async transcribe(pcm) {
      inferred.push(1);
      if (inferred.length === 1) await first;
      structuredClone(pcm.buffer, { transfer: [pcm.buffer] });
      return decoded.at(-1) === 0 ? '[3][S01]テスト。[4]' : '[6][S01]テスト。[7]';
    },
    dispose() {}
  };
  const queue = new TranscriptionQueue(store, 'guest', engine, async (_job, start, end) => {
    decoded.push(start);
    return new Float32Array(Math.round((end - start) * 16000)).fill(0.1);
  });
  try {
    const job = await queue.enqueue(key, 'ja', '1', 78, 62);
    for (let i = 0; i < 500 && inferred.length === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(decoded[0], sparseBounds(2, 78).start);
    queue.prioritize(job.id, 0);
    unblock();
    for (let i = 0; i < 500; i++) {
      const saved = await store.local('guest', 'jobs', job.id);
      if (saved?.status === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const saved = validateJob(await store.local('guest', 'jobs', job.id));
    assert.equal(saved.status, 'complete');
    assert.equal(saved.version, 3);
    assert.equal(saved.sparse, undefined, 'published hypotheses are compacted');
    assert.deepEqual(decoded, [50, 0, 24]);
    assert.equal(inferred.length, 3);
    const [track] = await store.tracks('guest', key);
    assert.equal(track.complete, true);
    assert.deepEqual(
      track.cues.map((cue) => cue.start),
      [3, 30, 56]
    );
  } finally {
    unblock?.();
    await queue.dispose();
    await store.close();
    if (old === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = old;
  }
});
test('an ambiguous near-playhead seam is repaired before unrelated later windows', async () => {
  const old = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'sparse-early-repair-tests');
  const calls = [];
  const responses = [
    '[3][S01]accepted[4][24][S01]left[27]',
    '[0][S01]right[3]',
    '[3][S01]accepted[4][24][S01]repaired[27]',
    '[5][S01]later[6]'
  ];
  const engine = {
    async prepare() {},
    async transcribe(pcm) {
      calls.push(pcm.length / 16000);
      return responses.shift();
    },
    dispose() {}
  };
  const queue = new TranscriptionQueue(store, 'guest', engine, async (_job, start, end) =>
    new Float32Array(Math.round((end - start) * 16000)).fill(0.1)
  );
  try {
    const job = await queue.enqueue(key, 'ja', '1', 78, 0);
    for (let i = 0; i < 500; i++) {
      const saved = await store.local('guest', 'jobs', job.id);
      if (saved?.status === 'complete' || saved?.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const saved = validateJob(await store.local('guest', 'jobs', job.id));
    assert.equal(saved.status, 'complete', saved.error);
    assert.deepEqual(calls, [28, 30, 54, 28]);
    const [track] = await store.tracks('guest', key);
    assert.deepEqual(
      track.cues.map((c) => c.text),
      ['accepted', 'repaired', 'later']
    );
    assert.equal(track.cues[0].id, 'w0/cue-0', 'earlier accepted caption keeps its identity');
  } finally {
    await queue.dispose();
    await store.close();
    if (old === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = old;
  }
});
test('a repair that changes an accepted cue fails without publishing a rewritten track', async () => {
  const old = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'sparse-repair-conflict-tests');
  const responses = [
    '[3][S01]accepted[4][24][S01]left[27]',
    '[0][S01]right[3]',
    '[3][S01]changed[4][24][S01]repaired[27]'
  ];
  const calls = [];
  const engine = {
    async prepare() {},
    async transcribe(pcm) {
      calls.push(pcm.length / 16000);
      return responses.shift();
    },
    dispose() {}
  };
  const queue = new TranscriptionQueue(store, 'guest', engine, async (_job, start, end) =>
    new Float32Array(Math.round((end - start) * 16000)).fill(0.1)
  );
  try {
    const job = await queue.enqueue(key, 'ja', '1', 78, 0);
    for (let i = 0; i < 500; i++) {
      const saved = await store.local('guest', 'jobs', job.id);
      if (saved?.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const saved = validateJob(await store.local('guest', 'jobs', job.id));
    assert.equal(saved.status, 'failed');
    assert.match(saved.error, /conflicts with an accepted caption/);
    assert.equal(saved.nextWindow, 2);
    assert.deepEqual(
      saved.cues.map((c) => c.text),
      ['accepted']
    );
    assert.deepEqual(calls, [28, 30, 54], 'the remaining video was not inferred after the blocker');
    assert.deepEqual(await store.tracks('guest', key), []);
    responses.push('[3][S01]accepted[4][24][S01]repaired[27]', '[5][S01]later[6]');
    await queue.resume(job.id);
    for (let i = 0; i < 500; i++) {
      const resumed = await store.local('guest', 'jobs', job.id);
      if (resumed?.status === 'complete' || resumed?.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const completed = validateJob(await store.local('guest', 'jobs', job.id));
    assert.equal(completed.status, 'complete', completed.error);
    assert.deepEqual(calls, [28, 30, 54, 54, 28], 'retry repairs before the later core');
    const [track] = await store.tracks('guest', key);
    assert.equal(track.cues[0].id, 'w0/cue-0');
  } finally {
    await queue.dispose();
    await store.close();
    if (old === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = old;
  }
});
