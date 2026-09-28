import test from 'node:test';
import assert from 'node:assert/strict';
import { retainAcceptedRepair } from '../../.cache/media-test-build/moss-repair.js';
const cue = (id, start, end, text = 'はい') => ({ id, start, end, text, speaker: 'S01' });
const align = (a, r) => retainAcceptedRepair(a, r, 0, 60);

for (const text of ['はい', 'Yes', '本当にそう思います'])
  test(`exact ${text} from a separate utterance is not a repair anchor`, () => {
    const a = [cue('a', 2, 2.2, text)];
    const r = [cue('r', 2.21, 2.41, text)];
    assert.equal(align(a, r), undefined);
  });
test('exact anchor selects the overlapping reply and keeps a separate nearby repeat', () => {
  const a = cue('a', 2, 2.2);
  const r = [cue('r0', 2, 2.2), cue('r1', 2.21, 2.41)];
  assert.deepEqual(align([a], r), [a, r[1]]);
});
test('short exact speech must substantially overlap, not merely touch', () => {
  assert.equal(align([cue('a', 2, 2.2)], [cue('r', 2.15, 2.35)]), undefined);
  assert.equal(align([cue('a', 2, 2.2)], [cue('r', 2.2, 2.4)]), undefined);
});
test('exact restoration remains sorted when immutable timestamps change local ordering', () => {
  const a = cue('a', 2.31, 2.71);
  const r = [cue('r0', 2.3, 2.72), cue('r1', 2.305, 2.9, '別の声')];
  const before = structuredClone({ a, r });
  assert.deepEqual(align([a], r), [r[1], a]);
  assert.deepEqual({ a, r }, before);
});
test('valid short exact drift and same-time long speech still retain original captions', () => {
  for (const end of [2.2, 20]) {
    const a = cue('a', 2, end);
    assert.deepEqual(align([a], [cue('r', 2.02, end + 0.02)]), [a]);
  }
});
