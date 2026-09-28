/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { clipReaderHighlightRect } from '../../apps/web/src/lib/components/book-reader/reader-highlight-geometry.ts';

const rect = (left, top, right, bottom) => ({ left, top, right, bottom });

test('framed highlights are clipped to the actual iframe instead of bleeding into adjacent UI', () => {
  assert.deepEqual(
    clipReaderHighlightRect(rect(-80, 10, 20, 30), {
      offsetLeft: 100,
      offsetTop: 50,
      outerClip: rect(100, 50, 400, 350),
      viewportWidth: 800,
      viewportHeight: 600
    }),
    { left: 100, top: 60, width: 20, height: 20 }
  );
});

test('off-frame glyph rectangles never create a visible fixed overlay', () => {
  assert.equal(
    clipReaderHighlightRect(rect(-200, 10, -100, 30), {
      offsetLeft: 100,
      offsetTop: 50,
      outerClip: rect(100, 50, 400, 350),
      viewportWidth: 800,
      viewportHeight: 600
    }),
    undefined
  );
});

test('same-document highlights respect the reader scrollport as well as the window', () => {
  assert.deepEqual(
    clipReaderHighlightRect(rect(20, 20, 220, 80), {
      localClip: rect(50, 0, 180, 60),
      viewportWidth: 200,
      viewportHeight: 100
    }),
    { left: 50, top: 20, width: 130, height: 40 }
  );
});

test('iframe and local content clipping compose in top-level coordinates', () => {
  assert.deepEqual(
    clipReaderHighlightRect(rect(0, 0, 200, 100), {
      offsetLeft: 300,
      offsetTop: 100,
      localClip: rect(25, 10, 150, 80),
      outerClip: rect(300, 100, 500, 200),
      viewportWidth: 1000,
      viewportHeight: 800
    }),
    { left: 325, top: 110, width: 125, height: 70 }
  );
});

test('subpixel and non-finite boxes are discarded rather than painted', () => {
  assert.equal(
    clipReaderHighlightRect(rect(0, 0, 0.5, 20), {
      viewportWidth: 100,
      viewportHeight: 100
    }),
    undefined
  );
  assert.equal(
    clipReaderHighlightRect(rect(Number.NaN, 0, 20, 20), {
      viewportWidth: 100,
      viewportHeight: 100
    }),
    undefined
  );
});
