/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceMediaSearchRevisions,
  searchResultPlan
} from '../../apps/web/src/lib/search/invalidation.ts';

test('result filters admit only the sections they actually render', () => {
  assert.deepEqual(searchResultPlan('all'), { titles: true, content: true });
  assert.deepEqual(searchResultPlan('titles'), { titles: true, content: false });
  assert.deepEqual(searchResultPlan('content'), { titles: false, content: true });
  assert.deepEqual(searchResultPlan('dictionary'), { titles: false, content: false });
});

test('caption invalidation refreshes Content without invalidating Titles', () => {
  assert.deepEqual(advanceMediaSearchRevisions({ titles: 4, content: 7 }, true, false), {
    titles: 4,
    content: 8
  });
});

test('video metadata invalidation refreshes both Titles and Content', () => {
  assert.deepEqual(advanceMediaSearchRevisions({ titles: 4, content: 7 }, false, true), {
    titles: 5,
    content: 8
  });
  assert.deepEqual(advanceMediaSearchRevisions({ titles: 4, content: 7 }, true, true), {
    titles: 5,
    content: 8
  });
});

test('irrelevant media notifications leave search revisions unchanged', () => {
  assert.deepEqual(advanceMediaSearchRevisions({ titles: 4, content: 7 }, false, false), {
    titles: 4,
    content: 7
  });
});
