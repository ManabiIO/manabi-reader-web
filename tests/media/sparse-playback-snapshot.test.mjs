import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newSparseState,
  sparseBounds,
  sparsePlaybackSnapshot,
  sparseLead,
  sparseMissingWindowsForLead,
  safeSparseCues
} from '../../.cache/media-test-build/sparse-transcription.js';
import { cueDigest } from '../../.cache/media-test-build/captions.js';
const cue = (id, start, end, text = 'これは日本語の文章です。') => ({ id, start, end, text });

function compare(state, duration) {
  const before = structuredClone(state),
    snapshot = sparsePlaybackSnapshot(state, duration);
  assert.ok(Object.isFrozen(snapshot));
  assert.equal(snapshot.cueDigest, cueDigest(safeSparseCues(state, duration)));
  const completed = state.windows.flatMap((w, i) =>
      w
        ? [
            {
              ...sparseBounds(i, duration),
              ms: w.inferenceMs,
              digitalSilence: w.digitalSilence
            }
          ]
        : []
    ),
    samples = completed.filter((sample) => !sample.digitalSilence);
  assert.equal(snapshot.count, completed.length);
  assert.equal(
    snapshot.totalMs,
    samples.reduce((n, s) => n + s.ms, 0)
  );
  assert.equal(
    snapshot.inputSeconds,
    samples.reduce((n, s) => n + (s.end - s.start), 0)
  );
  assert.ok(
    Math.abs(snapshot.coreSeconds - samples.reduce((n, s) => n + (s.coreEnd - s.coreStart), 0)) <
      1e-9
  );
  for (const position of [
    0,
    0.5,
    23.999,
    24,
    25.999,
    26,
    27.999,
    28,
    30,
    48,
    50,
    52,
    duration - 0.001,
    duration
  ]) {
    if (position > duration) continue;
    assert.equal(
      snapshot.lead(position),
      sparseLead(state, duration, position),
      'lead at ' + position
    );
    for (const needed of [0, 1, 22, Math.min(22, duration - position)])
      assert.deepEqual(
        snapshot.missingWindows(position, needed),
        sparseMissingWindowsForLead(state, duration, position, needed)
      );
  }
  for (const position of [-1, NaN, Infinity]) assert.equal(snapshot.lead(position), 0);
  assert.deepEqual(state, before);
  return snapshot;
}

for (const policy of ['overlap-sparse-v1', 'overlap-sparse-v2']) {
  test(
    policy + ': snapshot matches uncached projection across deterministic arrival orders',
    () => {
      for (let seed = 0; seed < 40; seed++) {
        const duration = seed % 2 ? 103.3171 : 104,
          state = newSparseState(duration);
        state.policy = policy;
        for (let i = 0; i < state.windows.length; i++) {
          if ((seed >> i) & 1) continue;
          const { start, end } = sparseBounds(i, duration);
          const cues = [];
          for (let t = Math.ceil(start / 3) * 3; t + 0.75 <= end; t += 3)
            cues.push(cue(`w${i}/cue-${t}`, t, t + 0.75, '日本語' + t));
          state.windows[i] = { cues, inferenceMs: (i + 1) * 91 };
        }
        compare(state, duration);
      }
    }
  );
  test(
    policy + ': long leading/trailing cues and disconnected speech keep identical readiness',
    () => {
      const state = newSparseState(104);
      state.policy = policy;
      state.windows[1] = {
        cues: [cue('w1/cue-0', 24.5, 33), cue('w1/cue-1', 48, 53)],
        inferenceMs: 90
      };
      compare(state, 104);
    }
  );
  test(policy + ': overlapping repaired components preserve precedence on conflicts', () => {
    const state = newSparseState(78);
    state.policy = policy;
    state.windows = state.windows.map(() => ({ cues: [], inferenceMs: 1 }));
    state.repairs[0] = [cue('w0/repair-0', 30, 34, '先の文'), cue('w0/repair-1', 50, 53, '境界')];
    state.repairs[1] = [cue('w1/repair-0', 30, 34, '異なる文'), cue('w1/repair-1', 50, 53, '境界')];
    compare(state, 78);
  });
}
test('digital-silent coverage does not make the ASR throughput estimate look faster', () => {
  const state = newSparseState(52);
  state.windows[0] = { cues: [], inferenceMs: 52000 };
  state.windows[1] = { cues: [], inferenceMs: 250, digitalSilence: true };
  const snapshot = compare(state, 52),
    first = sparseBounds(0, 52);
  assert.equal(snapshot.count, 2, 'both completed cores still count as coverage');
  assert.equal(snapshot.totalMs, 52000);
  assert.equal(snapshot.inputSeconds, first.end - first.start);
  assert.equal(snapshot.coreSeconds, first.coreEnd - first.coreStart);
});
test('snapshot has no live dependence on its mutable input; a new notification recomputes', () => {
  const state = newSparseState(52);
  state.windows[0] = { cues: [cue('w0/cue-0', 2, 3)], inferenceMs: 17 };
  const first = compare(state, 52),
    oldDigest = first.cueDigest;
  state.windows[0].cues[0].text = '変更';
  state.windows[0].inferenceMs = 44;
  state.windows[1] = { cues: [], inferenceMs: 7 };
  const next = compare(state, 52);
  assert.notEqual(next.cueDigest, oldDigest);
  assert.equal(first.cueDigest, oldDigest);
  assert.equal(first.count, 1);
  assert.equal(first.totalMs, 17);
  assert.deepEqual(first.missingWindows(24, 22), [1]);
  assert.equal(next.count, 2);
  assert.equal(next.totalMs, 51);
  // Make access fail: numeric playback queries must not read even the source arrays.
  Object.defineProperty(state, 'windows', {
    get() {
      throw Error('reread source windows');
    }
  });
  Object.defineProperty(state, 'repairs', {
    get() {
      throw Error('reread source repairs');
    }
  });
  assert.equal(first.lead(2), 22);
  assert.deepEqual(first.missingWindows(24, 22), [1]);
});
test('missing-window result mutation cannot change future queries', () => {
  const snapshot = sparsePlaybackSnapshot(newSparseState(104), 104);
  const first = snapshot.missingWindows(20, 22);
  first.length = 0;
  assert.deepEqual(snapshot.missingWindows(20, 22), [0, 1]);
});
