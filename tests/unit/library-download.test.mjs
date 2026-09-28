import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBookDownloadSize } from '../../apps/web/src/lib/library/book-download.ts';

const maximum = 128 * 1024 * 1024;

test('cloud downloads validate selected sizes without rejecting unknown sizes', () => {
  for (const size of [0, 1, maximum]) {
    validateBookDownloadSize(size);
    validateBookDownloadSize(size, size);
    validateBookDownloadSize(undefined, size);
  }
});

test('a short or growing download is not a complete copy of the selected file', () => {
  assert.throws(() => validateBookDownloadSize(20, 10), /does not match/);
  assert.throws(() => validateBookDownloadSize(10, 20), /does not match/);
});

test('invalid listing sizes and oversized bodies fail before book creation', () => {
  for (const size of [-1, NaN, Infinity, '12', null, 1.5, maximum + 1])
    assert.throws(() => validateBookDownloadSize(size));
  for (const size of [-1, NaN, Infinity, 1.5, maximum + 1])
    assert.throws(() => validateBookDownloadSize(undefined, size));
});
