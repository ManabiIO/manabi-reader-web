/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceMediaSearchRevisions,
  projectedArrayRevision,
  referenceRevision,
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


test('reference revisions advance only when immutable snapshots are replaced', () => {
  const revisionFor = referenceRevision();
  const first = [];
  const second = [];
  assert.equal(revisionFor(first), 1);
  assert.equal(revisionFor(first), 1);
  assert.equal(revisionFor(second), 2);
  assert.equal(revisionFor(second), 2);
});

test('projected array revisions avoid deep query-time serialization and ignore equal replacements', () => {
  let reads = 0;
  const revisionFor = projectedArrayRevision((item) => {
    reads++;
    return [item.id, item.revision];
  });
  const first = [{ id: 'a', revision: 1 }, { id: 'b', revision: 1 }];
  const equivalent = [{ id: 'a', revision: 1 }, { id: 'b', revision: 1 }];
  const changed = [{ id: 'a', revision: 2 }, { id: 'b', revision: 1 }];

  assert.equal(revisionFor(first), 1);
  assert.equal(reads, 2);
  assert.equal(revisionFor(first), 1);
  assert.equal(reads, 2, 'same snapshot must not rerun the corpus projector');

  assert.equal(revisionFor(equivalent), 1);
  assert.equal(reads, 4, 'replacement snapshot is compared exactly once');
  assert.equal(revisionFor(changed), 2);
  assert.equal(reads, 6);
});
