/** Adversarial seam and operation-lifetime tests. Scripted outputs, not real ASR evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  joinBoundary,
  repairedSuffix,
  newProgressiveState,
  SAMPLE_RATE
} from '../../.cache/media-test-build/moss-progressive.js';
import { transcribeProgressively } from '../../.cache/media-test-build/progressive-transcription.js';
import { validateJob } from '../../.cache/media-test-build/jobs.js';
import { MOSS } from '../../.cache/media-test-build/model-cache.js';
const cue = (text, start, end, id = 'w0/cue-0', speaker = 'w0/S01') => ({
  id,
  text,
  start,
  end,
  speaker
});

for (const [left, right] of [
  ['1.5人です。', '15人です。'],
  ['１．５人です。', '１５人です。'],
  ['1,5です。', '15です。'],
  ['1. 5です。', '15です。']
]) {
  test(`seam comparison preserves numeric punctuation: ${left} versus ${right}`, () => {
    assert.equal(
      joinBoundary([cue(left, 25, 29)], [cue(right, 25, 29, 'w1/cue-0')], 28),
      undefined
    );
  });
}
test('two separate identical multi-character replies adjacent to the seam are not deduplicated', () => {
  const a = cue('そうですね。', 27, 27.8);
  const b = cue('そうですね。', 28.1, 28.9, 'w1/cue-0');
  assert.deepEqual(joinBoundary([a], [b], 28), [a, b]);
});
test('whole-cue matching cannot collapse two speaker turns into one speaker turn', () => {
  const a = cue('そうですそうです', 25, 29);
  const b = [
    cue('そうです', 25, 27, 'w1/cue-0', 'w1/S01'),
    cue('そうです', 27, 29, 'w1/cue-1', 'w1/S02')
  ];
  assert.equal(joinBoundary([a], b, 28), undefined);
});
test('a short repeated repair anchor cannot consume a separate later reply', () => {
  const accepted = [cue('そうですね。', 20, 20.8)];
  const repair = [
    cue('そうですね。', 21.1, 21.9, 'w1/repair-0'),
    cue('続きです。', 23, 24, 'w1/repair-1')
  ];
  assert.equal(repairedSuffix(accepted, repair, 0), undefined);
});
function job(duration = 50) {
  return validateJob({
    version: 2,
    progressive: newProgressiveState(),
    id: '77777777-7777-4777-8777-777777777777',
    mediaKey: 'content:' + 'a'.repeat(64),
    language: 'ja',
    audioTrack: '1',
    duration,
    status: 'running',
    nextWindow: 0,
    cues: [],
    modelSha256: MOSS.sha256,
    engineRevision: MOSS.engineRevision,
    createdAt: 1
  });
}
test('an engine callback retained after a finished inference cannot publish stale preview', async () => {
  let saved = job(2),
    late;
  const events = [];
  await transcribeProgressively(saved, {
    engine: {
      prepare: async () => {},
      transcribe: async (_pcm, _signal, preview) => {
        late = preview;
        return '[0][S01]最初です。[1]';
      }
    },
    decode: async (_job, a, b) => new Float32Array(Math.round((b - a) * SAMPLE_RATE)).fill(0.1),
    signal: new AbortController().signal,
    checkpoint: async (j) => (saved = validateJob(j)),
    notify: (p) => events.push(structuredClone(p))
  });
  const count = events.length;
  late('[0][S01]古いプレビュー。[1][1][S01]次');
  assert.equal(events.length, count);
});
test('a retained preview callback after cancellation is inert rather than throwing out of band', async () => {
  const controller = new AbortController();
  let late;
  await transcribeProgressively(job(2), {
    engine: {
      prepare: async () => {},
      transcribe: async (_pcm, _signal, preview) => {
        late = preview;
        return '[0][S01]最初です。[1]';
      }
    },
    decode: async (_j, a, b) => new Float32Array(Math.round((b - a) * SAMPLE_RATE)).fill(0.1),
    signal: controller.signal,
    checkpoint: async (j) => validateJob(j),
    notify() {}
  });
  controller.abort();
  assert.doesNotThrow(() => late('[0][S01]古い出力。[1][1][S01]次'));
});

for (const [a, b] of [
  ['a part', 'apart'],
  ['1 5です。', '15です。'],
  ['value 1.5', 'value 15']
]) {
  test(`lexical spaces and numeric punctuation do not collapse: ${a}`, () => {
    const cue = (text, start, end) => ({ id: text, text, start, end, speaker: 's1' });
    assert.equal(joinBoundary([cue(a, 27, 29)], [cue(b, 27, 29)], 28), undefined);
  });
}
test('ordinary English one-to-many cue boundaries still agree', () => {
  const c = (id, text, start, end) => ({ id, text, start, end, speaker: 's1' });
  const left = [c('a', 'We should stay here.', 26, 30)];
  const right = [c('b', 'We should', 26, 28), c('c', 'stay here.', 28, 30)];
  assert.deepEqual(joinBoundary(left, right, 28), left);
});
