import test from 'node:test';
import assert from 'node:assert/strict';
import { compareEncodedWaveform } from './encoded-waveform.mjs';
const timeBase = { numerator: 1, denominator: 1000 };
function fixture() {
  let seed = 732;
  const wide = Float32Array.from({ length: 10000 }, () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed / 0x80000000;
  });
  return { wide, offset: 2000, narrow: wide.slice(2000, 8000) };
}
test('sample-identical intervals need no shift', () => {
  const { wide, narrow, offset } = fixture();
  const result = compareEncodedWaveform(wide, narrow, offset, timeBase);
  assert.equal(result.passed, true);
  assert.equal(result.shiftSamples, 0);
});
for (const shift of [-16, -1, 1, 16])
  test(`one measured clock tick permits ${shift} samples for comparison only`, () => {
    const { wide, offset } = fixture(),
      narrow = wide.slice(offset + shift, offset + shift + 6000);
    const before = narrow.slice(),
      original = wide.slice();
    const result = compareEncodedWaveform(wide, narrow, offset, timeBase);
    assert.equal(result.passed, true);
    assert.equal(result.shiftSamples, shift);
    assert.deepEqual(narrow, before);
    assert.deepEqual(wide, original);
  });
for (const shift of [-17, 17, 320])
  test(`more than the declared tick (${shift} samples) cannot pass`, () => {
    const { wide, offset } = fixture();
    assert.equal(
      compareEncodedWaveform(
        wide,
        wide.slice(offset + shift, offset + shift + 6000),
        offset,
        timeBase
      ).passed,
      false
    );
  });
test('a finer declared clock does not inherit the millisecond allowance', () => {
  const { wide, offset } = fixture();
  assert.equal(
    compareEncodedWaveform(wide, wide.slice(offset + 1, offset + 6001), offset, {
      numerator: 1,
      denominator: 48000
    }).passed,
    false
  );
});
for (const kind of ['drift', 'lost-packet', 'gain'])
  test(`${kind} cannot be hidden by independently aligning regions`, () => {
    const { wide, narrow, offset } = fixture();
    if (kind === 'drift') narrow.set(wide.subarray(offset + 3016, offset + 6016), 3000);
    else if (kind === 'lost-packet') narrow.fill(0, 2500, 2820);
    else narrow.forEach((v, i) => (narrow[i] = v * 2));
    assert.equal(compareEncodedWaveform(wide, narrow, offset, timeBase).passed, false);
  });
test('silence is not evidence for waveform alignment', () => {
  assert.equal(
    compareEncodedWaveform(new Float32Array(10000), new Float32Array(6000), 2000, timeBase).passed,
    false
  );
});
test('unknown, invalid or excessively coarse timestamps fail instead of widening the test', () => {
  const { wide, narrow, offset } = fixture();
  for (const base of [
    undefined,
    {},
    { numerator: 1, denominator: 100 },
    { numerator: 0, denominator: 1000 },
    { numerator: 1, denominator: Infinity },
    { numerator: true, denominator: 1000 }
  ])
    assert.throws(() => compareEncodedWaveform(wide, narrow, offset, base), /Invalid bounded/);
});
test('nonfinite PCM and out-of-range intervals fail', () => {
  const { wide, narrow, offset } = fixture();
  assert.throws(() => compareEncodedWaveform(wide, narrow, 9000, timeBase));
  assert.throws(() => compareEncodedWaveform(wide, narrow, -1, timeBase));
  narrow[0] = NaN;
  assert.throws(() => compareEncodedWaveform(wide, narrow, offset, timeBase));
});
