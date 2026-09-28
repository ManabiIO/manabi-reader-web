import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dimensionExtent,
  dimensionLabel,
  dimensionLimits,
  dimensionPercentage,
  dimensionPixels
} from '../../apps/web/src/lib/components/settings/dimension-presets.ts';

for (const [vertical, first, expected] of [
  [true, true, 1200], [true, false, 800], [false, true, 800], [false, false, 1200]
]) {
  test(`size axis for vertical=${vertical}, margins=${first}`, () => {
    assert.equal(dimensionExtent(vertical, first, 1200, 800), expected);
  });
}

test('unavailable and non-finite viewports cannot produce a size', () => {
  for (const extent of [0, -1, NaN, Infinity, -Infinity]) {
    assert.equal(dimensionExtent(true, true, extent, 800), 0);
    assert.equal(dimensionPixels(50, extent, false), null);
    assert.ok(Number.isFinite(dimensionPercentage(40, extent, false)));
  }
});

test('margin percentage is shared between both sides', () => {
  assert.equal(dimensionPixels(25, 1200, true), 150);
  assert.equal(dimensionPixels(50, 800, true), 200);
  assert.equal(dimensionPixels(75, 800, false), 600);
});

test('presets retain the existing integer pixel rounding', () => {
  assert.equal(dimensionPixels(25, 801, true), 101);
  assert.equal(dimensionPixels(95, 801, false), 761);
});

test('invalid, off-step and unsafe sizes reject instead of clamping', () => {
  for (const value of [NaN, Infinity, -5, 0, 24, 52, 100])
    assert.equal(dimensionPixels(value, 800, true), null);
  assert.equal(dimensionPixels(50, Number.MAX_VALUE, false), null);
});

test('automatic and exact pixel settings only choose a preview thumb', () => {
  assert.equal(dimensionPercentage(0, 800, false), 95);
  assert.equal(dimensionPercentage(137, 900, true), 30);
  assert.equal(dimensionPercentage(2000, 800, false), 95);
  assert.equal(dimensionPercentage(0, 800, true), 5);
});

test('malformed saved values give a finite preview without persisting a substitute', () => {
  for (const value of [undefined, NaN, Infinity, -1]) {
    assert.equal(dimensionPercentage(value, 800, true), 5);
    assert.equal(dimensionPercentage(value, 800, false), 95);
  }
});

test('labels describe the real axis and bounds remain unchanged', () => {
  assert.equal(dimensionLabel(true, true), 'Left and right margins');
  assert.equal(dimensionLabel(false, true), 'Top and bottom margins');
  assert.equal(dimensionLabel(true, false), 'Maximum page height');
  assert.equal(dimensionLabel(false, false), 'Maximum page width');
  assert.deepEqual(dimensionLimits(true), { min: 5, max: 50, step: 5 });
  assert.deepEqual(dimensionLimits(false), { min: 50, max: 95, step: 5 });
});
