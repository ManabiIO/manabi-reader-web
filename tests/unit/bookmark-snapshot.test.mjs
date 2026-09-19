import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBookmarkSnapshot } from '../../apps/web/src/lib/components/book-reader/bookmark-snapshot.ts';

test('not-ready measurements cannot overwrite a saved bookmark', () => {
  const cases = [
    [-1, 4410],
    [NaN, 4],
    [4, NaN],
    [Infinity, 4],
    [1, 0],
    [4, 3],
    [0, -1]
  ];
  for (const [count, total] of cases) {
    assert.equal(createBookmarkSnapshot(1, count, total), undefined);
  }
  assert.equal(createBookmarkSnapshot(0, 0, 1), undefined);
  assert.equal(createBookmarkSnapshot(1, 1, 2, { scrollX: NaN }), undefined);
});

test('ready positions retain signed vertical scroll and fractional progress', () => {
  const value = createBookmarkSnapshot(7, 150, 1000, { scrollX: -45 });
  assert.equal(value.dataId, 7);
  assert.equal(value.exploredCharCount, 150);
  assert.equal(value.progress, 0.15);
  assert.equal(value.scrollX, -45);
  assert.ok(Number.isFinite(value.lastBookmarkModified));
});

test('an illustration-only book has finite zero progress', () => {
  assert.equal(createBookmarkSnapshot(1, 0, 0).progress, 0);
});
