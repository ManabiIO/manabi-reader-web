/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readerMenuPosition } from '../../apps/web/src/reader-react/menu-position.ts';

test('enlarged Reading tools is contained in 320px, including visual viewport offsets', () => {
  for (const offset of [0, 60]) {
    const position = readerMenuPosition(
      { right: 308 + offset, top: 12 + offset, bottom: 56 + offset },
      { width: 512, height: 720 },
      { left: offset, top: offset, width: 320, height: 320 }
    );
    assert.deepEqual(position, {
      left: offset + 8,
      top: offset + 64,
      maxWidth: 304,
      maxHeight: 248
    });
  }
});

test('a bottom trigger uses available space above and an offscreen trigger remains bounded', () => {
  const viewport = { left: 0, top: 0, width: 320, height: 180 };
  assert.deepEqual(
    readerMenuPosition(
      { right: 308, top: 128, bottom: 172 },
      { width: 256, height: 720 },
      viewport
    ),
    {
      left: 52,
      top: 8,
      maxWidth: 304,
      maxHeight: 112
    }
  );
  const position = readerMenuPosition(
    { right: 999, top: 800, bottom: 844 },
    { width: 256, height: 720 },
    viewport
  );
  assert.equal(position.left, 56);
  assert.equal(position.top, 8);
  assert.equal(position.maxHeight, 164);
});
