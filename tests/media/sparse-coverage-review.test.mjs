/** Whole-cue/coverage regressions. Scripted hypotheses, not real-model quality evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newSparseState,
  safeSparseCues,
  sparseLead,
  assembleSparse
} from '../../.cache/media-test-build/sparse-transcription.js';

const cue = (window, n, start, end, text = '境界をまたぐ長い文章です。') => ({
  id: `w${window}/cue-${n}`,
  start,
  end,
  text
});
const window = (...cues) => ({ cues, inferenceMs: 1000 });

test('resolved sparse seams publish whole cues that extend outside the four-second seam band', () => {
  const s = newSparseState(78);
  s.windows[0] = window(cue(0, 0, 23, 27));
  s.windows[1] = window(cue(1, 0, 24, 27));
  assert.deepEqual(safeSparseCues(s, 78), [s.windows[0].cues[0]]);
  assert.equal(sparseLead(s, 78, 23), 27);
});
test('a long held cue shortens ready coverage to its start rather than the nominal cut', () => {
  const s = newSparseState(78);
  s.windows[0] = window(cue(0, 0, 20, 27));
  assert.deepEqual(safeSparseCues(s, 78), []);
  assert.equal(sparseLead(s, 78, 19), 1);
  assert.equal(sparseLead(s, 78, 21), 0);
});
test('an unresolved leading whole cue cannot be reported ready in the following core', () => {
  const s = newSparseState(78);
  s.windows[1] = window(cue(1, 0, 25, 34), cue(1, 1, 40, 42, '安全な文章'));
  assert.equal(sparseLead(s, 78, 29), 0);
  assert.equal(sparseLead(s, 78, 34), 16);
  assert.deepEqual(safeSparseCues(s, 78), [s.windows[1].cues[1]]);
});
test('an earlier conflicting window cannot remove a previously accepted interior cue', () => {
  const s = newSparseState(78);
  const accepted = cue(1, 1, 34, 38, 'すでに受け入れた文章です。');
  s.windows[1] = window(cue(1, 0, 24, 27, '右側の候補'), accepted);
  const before = safeSparseCues(s, 78);
  s.windows[0] = window(cue(0, 0, 24, 27, '異なる左側の候補'));
  assert.deepEqual(safeSparseCues(s, 78), before);
  assert.deepEqual(before, [accepted]);
});
test('readiness uses repaired hypotheses at their outer boundary, not superseded raw text', () => {
  const s = newSparseState(104);
  s.windows[0] = window();
  s.windows[1] = window(cue(1, 0, 50, 53, '旧候補'));
  s.windows[2] = window(cue(2, 0, 50, 53, '旧候補'));
  s.repairs[0] = [{ ...cue(0, 0, 50, 53, '修復結果は異なる'), id: 'w0/repair-0' }];
  assert.equal(sparseLead(s, 104, 51), 0);
});
test('agreement with a repaired outer boundary restores whole seam captions', () => {
  const s = newSparseState(104);
  s.windows[0] = window();
  s.windows[1] = window(cue(1, 0, 50, 53, '旧候補'));
  s.windows[2] = window(cue(2, 0, 50, 53));
  const repaired = { ...cue(0, 0, 49, 53), id: 'w0/repair-0' };
  s.repairs[0] = [repaired];
  assert.deepEqual(safeSparseCues(s, 104), [repaired]);
  assert.equal(sparseLead(s, 104, 51), 25);
});
test('dense seam reconciliation does not truncate the context to sixteen cues', () => {
  const s = newSparseState(52);
  s.windows[0] = window(
    ...Array.from({ length: 20 }, (_, n) =>
      cue(0, n, 24 + n * 0.16, 24 + n * 0.16 + 0.1, `項目${n}です`)
    )
  );
  s.windows[1] = window(...s.windows[0].cues.map((c, n) => ({ ...c, id: `w1/cue-${n}` })));
  const result = assembleSparse(s);
  assert.deepEqual(result.cues, s.windows[0].cues);
  assert.deepEqual(safeSparseCues(s, 52), result.cues);
});
test('fully joined display and final assembly use the same canonical cue objects', () => {
  const s = newSparseState(52);
  s.windows[0] = window(cue(0, 0, 23, 27));
  s.windows[1] = window(cue(1, 0, 24, 27));
  assert.deepEqual(safeSparseCues(s, 52), assembleSparse(s).cues);
  assert.equal(sparseLead(s, 52, 28), 24);
});

test('cue projection does not mutate frozen source hypotheses or repair arrays', () => {
  const s = newSparseState(52);
  s.windows[0] = window(cue(0, 0, 23, 27));
  s.windows[1] = window(cue(1, 0, 24, 27));
  const before = structuredClone(s);
  const freeze = (v) => {
    if (v && typeof v === 'object') {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
  };
  freeze(s);
  assert.equal(sparseLead(s, 52, 0), 52);
  assert.deepEqual(safeSparseCues(s, 52), assembleSparse(s).cues);
  assert.deepEqual(s, before);
});
test('fractional final sample remains displayed without claiming coverage past the video', () => {
  const duration = 3.00001;
  const s = newSparseState(duration);
  s.windows[0] = window(cue(0, 0, 2, Math.ceil(duration * 16000) / 16000));
  assert.deepEqual(safeSparseCues(s, duration), assembleSparse(s).cues);
  assert.equal(sparseLead(s, duration, 0), duration);
});
