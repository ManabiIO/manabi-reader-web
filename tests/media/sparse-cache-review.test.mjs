import {
  legacySparseCues,
  legacyAssembleSparse
} from '../../.cache/media-test-build/sparse-legacy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJob, jobCanResume } from '../../.cache/media-test-build/jobs.js';
import {
  newSparseState,
  safeSparseCues,
  nextSparseWindow,
  sparseMissingWindowsForLead,
  assembleSparse
} from '../../.cache/media-test-build/sparse-transcription.js';

const cue = (i, n, start, end, text) => ({ id: `w${i}/cue-${n}`, start, end, text });
const win = (...cues) => ({ cues, inferenceMs: 1000 });
const job = (sparse, duration, cues) => ({
  version: 3,
  sparse,
  id: crypto.randomUUID(),
  mediaKey: 'content:' + '8'.repeat(64),
  language: 'ja',
  audioTrack: '1',
  duration,
  status: 'paused',
  nextWindow: sparse.windows.filter(Boolean).length,
  cues,
  modelSha256: 'a'.repeat(64),
  engineRevision: 'test',
  createdAt: 1
});
for (const suppress of [true, false]) {
  test(`old sparse draft cache upgrades from verified hypotheses (suppression=${suppress})`, () => {
    const s = newSparseState(104);
    s.policy = 'overlap-sparse-v1';
    s.windows[0] = win(cue(0, 0, 3, 4, '保持された文章'), cue(0, 1, 23, 27, '長い文章です。'));
    s.windows[1] = win(cue(1, 0, 24, 27, '長い文章です。'), cue(1, 1, 50, 53, '左の解釈'));
    s.windows[2] = win(cue(2, 0, 50, 53, '右の解釈'), cue(2, 1, 60, 62, '維持する文章'));
    const old = job(s, 104, legacySparseCues(s, 104, suppress));
    const before = structuredClone(old);
    const read = validateJob(old);
    assert.deepEqual(read.cues, safeSparseCues(s, 104));
    assert.deepEqual(read.sparse, before.sparse);
    assert.deepEqual(old, before, 'reading cannot mutate the saved object');
    assert.deepEqual(validateJob(read), read, 'migration is idempotent');
    assert.equal(read.sparse.policy, 'overlap-sparse-v1');
    assert.equal(read.nextWindow, before.nextWindow);
    const tampered = structuredClone(old);
    tampered.cues = tampered.cues.map((c) => ({ ...c }));
    tampered.cues[0].text += 'altered';
    assert.throws(() => validateJob(tampered), /does not match saved coverage/);
  });
}
test('held leading text prioritizes and estimates the missing previous window beyond two seconds', () => {
  const s = newSparseState(104, 31);
  s.windows[1] = win(cue(1, 0, 25, 34, '長い文が続いています。'));
  assert.equal(nextSparseWindow(s), 0);
  assert.deepEqual(sparseMissingWindowsForLead(s, 104, 31, 26), [0, 2]);
});
test('a blocked repaired outer seam is non-retryable even with unrelated cores still missing', () => {
  const s = newSparseState(104);
  s.windows[0] = win();
  s.windows[1] = win(cue(1, 0, 50, 53, '旧候補'));
  s.windows[2] = win(cue(2, 0, 50, 53, '旧候補'));
  s.repairs[0] = [{ ...cue(0, 0, 50, 53, '修復後の相反する候補'), id: 'w0/repair-0' }];
  assert.equal(jobCanResume(job(s, 104, safeSparseCues(s, 104))), false);
});
test('out-of-order consistent windows preserve every previously accepted caption', () => {
  const duration = 26 * 8;
  const speech = Array.from({ length: 8 }, (_, index) => [
    ...Array.from({ length: 5 }, (_, n) => ({
      start: index * 26 + 4 + n * 4,
      end: index * 26 + 5.6 + n * 4,
      text: `文章番号${index}-${n}です。`
    })),
    ...(index
      ? [{ start: index * 26 - 0.6, end: index * 26 + 0.6, text: `境界${index}です。` }]
      : [])
  ])
    .flat()
    .sort((a, b) => a.start - b.start);
  for (let seed = 1; seed <= 40; seed++) {
    let random = seed;
    const order = Array.from({ length: 8 }, (_, n) => n);
    for (let n = order.length - 1; n; n--) {
      random = (random * 1664525 + 1013904223) >>> 0;
      const j = random % (n + 1);
      [order[n], order[j]] = [order[j], order[n]];
    }
    const s = newSparseState(duration);
    let accepted = [];
    for (const i of order) {
      const start = Math.max(0, i * 26 - 2),
        end = Math.min(duration, (i + 1) * 26 + 2);
      s.windows[i] = win(
        ...speech
          .filter((c) => c.start >= start && c.end <= end)
          .map((c, n) => cue(i, n, c.start, c.end, c.text))
      );
      const next = safeSparseCues(s, duration);
      const byId = new Map(next.map((c) => [c.id, c]));
      for (const c of accepted) assert.deepEqual(byId.get(c.id), c, `seed ${seed}, window ${i}`);
      accepted = next;
    }
    assert.deepEqual(accepted, assembleSparse(s).cues);
    assert.deepEqual(
      accepted.map((c) => c.text),
      speech.map((c) => c.text)
    );
  }
});

test('an old publication retry upgrades a verified duplicate-producing cache without inference', () => {
  const s = newSparseState(52);
  const text = '繰り返しの文章です。';
  s.windows[0] = win(
    ...Array.from({ length: 20 }, (_, n) => cue(0, n, 24 + n * 0.16, 24 + n * 0.16 + 0.1, text))
  );
  s.windows[1] = win(...s.windows[0].cues.map((c, n) => ({ ...c, id: `w1/cue-${n}` })));
  const old = job(s, 52, legacyAssembleSparse(s));
  old.completedAt = 2;
  assert.equal(old.cues.length, 24);
  const migrated = validateJob(old);
  assert.equal(migrated.cues.length, 20);
  assert.equal(migrated.completedAt, 2);
  assert.deepEqual(migrated.sparse, old.sparse);
  assert.deepEqual(validateJob(migrated), migrated);
  const tampered = { ...old, cues: old.cues.map((c) => ({ ...c })) };
  tampered.cues[0].text = '違う文章';
  assert.throws(() => validateJob(tampered), /do not match saved hypotheses/);
});

test('a legacy one-sided publication cache resumes seam repair instead of falsely completing', () => {
  const s = newSparseState(52);
  s.windows[0] = win();
  s.windows[1] = win(cue(1, 0, 25, 31, '片側だけの認識結果です。'));
  const old = job(s, 52, legacyAssembleSparse(s));
  old.completedAt = 2;
  const before = structuredClone(old);
  const migrated = validateJob(old);
  assert.equal(migrated.completedAt, undefined);
  assert.deepEqual(migrated.sparse, before.sparse);
  assert.equal(migrated.nextWindow, 2);
  assert.equal(jobCanResume(migrated), true);
  assert.deepEqual(validateJob(migrated), migrated);
  assert.deepEqual(old, before);
  assert.throws(() => validateJob({ ...old, completedAt: -1 }), /Invalid number/);
  assert.throws(() => validateJob({ ...old, status: 'complete' }), /do not match saved hypotheses/);
});
