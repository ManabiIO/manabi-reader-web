/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupLineRects,
  visibleLineRects
} from '../../apps/web/src/lib/components/book-reader/line-guide-geometry.ts';

const run = (left, top, right, bottom, vertical = false) => ({
  rect: { left, top, right, bottom },
  vertical
});

test('aligned text in two horizontal columns remains separate and follows DOM reading order', () => {
  const lines = groupLineRects([
    run(10, 10, 90, 30),
    run(90, 10, 200, 30),
    run(10, 40, 200, 60),
    run(260, 10, 450, 30),
    run(260, 40, 450, 60)
  ]);
  assert.equal(lines.length, 4);
  assert.deepEqual(
    lines.map((x) => [x.rect.left, x.rect.top]),
    [
      [10, 10],
      [10, 40],
      [260, 10],
      [260, 40]
    ]
  );
  assert.equal(lines[0].rect.right, 200);
  assert.deepEqual(visibleLineRects(lines, 1, 3), [lines[0].rect, lines[1].rect]);
});

test('vertical lines in separate page rows never create a full-height aperture', () => {
  const lines = groupLineRects([
    run(100, 10, 120, 100, true),
    run(100, 100, 120, 200, true),
    run(70, 10, 90, 200, true),
    run(100, 260, 120, 450, true)
  ]);
  assert.equal(lines.length, 3);
  assert.deepEqual(visibleLineRects(lines, 1, 3), [lines[0].rect, lines[1].rect]);
});

test('adjacent ruby/base-font runs join despite different line box sizes', () => {
  const lines = groupLineRects([run(0, 10, 40, 30), run(40, 5, 90, 35)]);
  assert.deepEqual(lines, [run(0, 5, 90, 35)]);
});

test('mixed writing modes stay separate and absent active lines return no aperture', () => {
  const lines = groupLineRects([run(0, 0, 100, 20), run(0, 0, 20, 100, true)]);
  assert.equal(lines.length, 2);
  assert.deepEqual(visibleLineRects(lines, 0, 3), [lines[0].rect]);
  assert.deepEqual(visibleLineRects(lines, 9, 3), []);
});
