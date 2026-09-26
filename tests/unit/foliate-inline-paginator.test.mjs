import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inlineAnchorPosition,
  inlineLastPagePosition,
  inlinePageCount,
  inlinePageForPosition,
  inlinePageSize,
  inlinePageTarget
} from '../../apps/web/src/lib/components/book-reader/book-reader-paginated/foliate-inline-paginator.ts';

const metrics = { viewport: 1000, extent: 2500, gap: 40 };

test('Foliate inline geometry models CSS-column logical pages', () => {
  assert.equal(inlinePageSize(metrics), 1040);
  assert.equal(inlinePageCount(metrics), 3);
  assert.equal(inlineLastPagePosition(metrics), 2080);
  assert.equal(inlinePageForPosition(metrics, 0), 0);
  assert.equal(inlinePageForPosition(metrics, 1040), 1);
  assert.equal(inlinePageForPosition(metrics, 2080), 2);
});

test('Foliate inline page targets distinguish movement from section boundaries', () => {
  assert.deepEqual(inlinePageTarget(metrics, 0, -1), {
    position: 0,
    page: 0,
    pages: 3,
    moved: false,
    boundary: -1
  });
  assert.deepEqual(inlinePageTarget(metrics, 0, 1), {
    position: 1040,
    page: 1,
    pages: 3,
    moved: true,
    boundary: 0
  });
  assert.deepEqual(inlinePageTarget(metrics, 2080, 1), {
    position: 2080,
    page: 2,
    pages: 3,
    moved: false,
    boundary: 1
  });
});

test('Foliate inline geometry keeps a logical final partial page', () => {
  const partial = { viewport: 1000, extent: 1500, gap: 40 };
  assert.equal(inlinePageCount(partial), 2);
  assert.equal(inlineLastPagePosition(partial), 1040);
});

test('Foliate inline anchors snap source ranges to the containing logical page', () => {
  assert.equal(inlineAnchorPosition(metrics, 0, 1200), 1040);
  assert.equal(inlineAnchorPosition(metrics, 1040, 1200), 2080);
  assert.equal(inlineAnchorPosition(metrics, 2080, 9999), 2080);
});
