/** Whole-cue repair alignment, not recognition accuracy or a performance benchmark. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { retainAcceptedRepair } from '../../.cache/media-test-build/moss-repair.js';
const cue = (id, text, start, end, speaker = 's1') => ({ id, text, start, end, speaker });
const align = (a, r) => retainAcceptedRepair(a, r, 0, 60);

test('one accepted Japanese cue may agree with several repair cues without losing its identity', () => {
  const a = [cue('old', '今日は良い天気ですね。', 2, 6)];
  const suffix = cue('new', '続きです。', 25, 27);
  const r = [cue('r0', '今日は', 2, 4), cue('r1', '良い天気ですね。', 4, 6), suffix];
  const before = structuredClone(r);
  assert.deepEqual(align(a, r), [...a, suffix]);
  assert.equal(align(a, r)[0], a[0]);
  assert.deepEqual(r, before);
});
test('many accepted cues may agree with a merged repair cue without new timestamps', () => {
  const a = [cue('a', '今日は', 2, 4), cue('b', '良い天気ですね。', 4, 6)];
  assert.deepEqual(align(a, [cue('r', '今日は良い天気ですね。', 2.1, 6.1)]), a);
});
test('equivalent alternative alignment partitions are not mistaken for ambiguity', () => {
  const a = [cue('a', '日本', 2, 3), cue('b', '語です。', 3, 4)];
  const r = [cue('r0', '日本', 2, 3), cue('r1', '語です', 3, 4)];
  assert.deepEqual(align(a, r), a); // 1:1 + 1:1 and 2:2 consume the same whole cues.
});
test('nonmatching speech between immutable cues is retained, not silently consumed', () => {
  const a = [cue('a', '最初です。', 2, 3), cue('b', '最後です。', 8, 9)];
  const middle = cue('extra', '新しい音声', 5, 6);
  const r = [cue('r0', '最初です', 2, 3), middle, cue('r2', '最後です', 8, 9)];
  assert.deepEqual(align(a, r), [a[0], middle, a[1]]);
});
test('unrelated repair prefix and suffix survive canonicalization', () => {
  const a = [cue('a', 'こんにちは。', 2, 4)];
  const pre = cue('pre', '前', 0, 1),
    post = cue('post', '後', 8, 9);
  const r = [pre, cue('r0', 'こん', 2, 3), cue('r1', 'にちは。', 3, 4), post];
  assert.deepEqual(align(a, r), [pre, ...a, post]);
});
for (const [left, right] of [
  ['1.5人です。', '15人です。'],
  ['a part', 'apart'],
  ['日本語', '中国語'],
  ['１．５人です。', '１５人です。'],
  ['1 5', '15']
])
  test(`repair cannot alter lexical content: ${left}`, () => {
    assert.equal(align([cue('a', left, 2, 6)], [cue('r', right, 2, 6)]), undefined);
  });
test('English whole cue splits keep word boundaries', () => {
  const a = [cue('a', 'We should stay here.', 2, 6)];
  assert.deepEqual(align(a, [cue('r0', 'We should', 2, 4), cue('r1', 'stay here.', 4, 6)]), a);
});
test('fallback rejects timing drift beyond the original repair guard', () => {
  assert.equal(
    align([cue('a', '日本語です。', 2, 6)], [cue('r', '日本語です', 2.36, 6.36)]),
    undefined
  );
});
test('a separate repeated reply is not used as the repair anchor', () => {
  assert.equal(align([cue('a', 'はい。', 2, 2.2)], [cue('r', 'はい', 2.21, 2.41)]), undefined);
});
test('two possible whole-cue anchors remain ambiguous', () => {
  const a = [cue('a', '同じ返事です。', 2, 6)];
  const r = [cue('r0', '同じ返事です', 2, 6), cue('r1', '同じ返事です', 2.1, 6.1)];
  assert.equal(align(a, r), undefined);
});
for (const side of ['accepted', 'repair'])
  test(`resegmentation cannot collapse distinct ${side} speakers`, () => {
    const split = [cue('a', 'はい', 2, 4, 'one'), cue('b', 'そうです。', 4, 6, 'two')];
    const merged = [cue('m', 'はいそうです。', 2, 6)];
    assert.equal(side === 'accepted' ? align(split, merged) : align(merged, split), undefined);
  });
test('resegmentation cannot merge simultaneous speech', () => {
  const a = [cue('a', '日本語です。', 2, 6)];
  const r = [cue('r0', '日本', 2, 4), cue('r1', '語です。', 3, 6)];
  assert.equal(align(a, r), undefined);
});
test('a cue excluded by the alignment extent cannot vanish between grouped candidates', () => {
  const a = [cue('a', '日本語です。', 2, 6)];
  const r = [cue('r0', '日本', 2, 4), cue('extra', '別の発言', 3, 12), cue('r1', '語です。', 4, 6)];
  assert.equal(align(a, r), undefined);
});
test('partial outer accepted cues are not clipped to fit a repair input', () => {
  const a = [cue('a', '外側の字幕', 0, 10)];
  const r = [cue('r', '後続', 12, 14)];
  assert.deepEqual(retainAcceptedRepair(a, r, 5, 20), r);
});
test('frozen inputs remain unchanged when no unique alignment exists', () => {
  const a = Object.freeze([Object.freeze(cue('a', '元です。', 2, 6))]);
  const r = Object.freeze([Object.freeze(cue('r', '異なります。', 2, 6))]);
  assert.equal(align(a, r), undefined);
});
test('exact dense repairs keep their previous supported limit', () => {
  const a = Array.from({ length: 200 }, (_, n) => cue(`a${n}`, `内容${n}`, n / 4, n / 4 + 0.1));
  const r = a.map((c, n) => ({ ...c, id: `r${n}` }));
  assert.deepEqual(align(a, r), a);
});
test('oversized fallback fails closed rather than creating unbounded alignment work', () => {
  const a = Array.from({ length: 129 }, (_, n) => cue(`a${n}`, `内容${n}。`, n / 4, n / 4 + 0.1));
  const r = a.map((c, n) => ({ ...c, id: `r${n}`, text: c.text.slice(0, -1) }));
  assert.equal(align(a, r), undefined);
});
test('long fallback text stays bounded even when normalization would agree', () => {
  const text = '長'.repeat(17000);
  assert.equal(align([cue('a', text + '。', 2, 6)], [cue('r', text, 2, 6)]), undefined);
});
test('short and long random Japanese partitions retain every accepted cue exactly once', () => {
  let seed = 317;
  const random = (max) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % max;
  };
  const text = '私たちは今日図書館に行って日本語の本を読みました';
  const split = (prefix) => {
    const cuts = [0];
    while (cuts.at(-1) < text.length) cuts.push(Math.min(text.length, cuts.at(-1) + 2 + random(5)));
    return cuts
      .slice(0, -1)
      .map((start, n) =>
        cue(`${prefix}${n}`, text.slice(start, cuts[n + 1]), 2 + start / 4, 2 + cuts[n + 1] / 4)
      );
  };
  for (let n = 0; n < 40; n++) {
    const a = split('a'),
      r = split('r');
    assert.deepEqual(align(a, r), a, `partition ${n}`);
  }
});
