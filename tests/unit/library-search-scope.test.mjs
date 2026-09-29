/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  librarySearchScopePlan,
  librarySearchScopes
} from '../../apps/web/src/lib/search/library-search-scope.ts';

test('library search scopes define one orthogonal corpus plan', () => {
  assert.deepEqual(
    librarySearchScopes.map((item) => item.id),
    ['everything', 'books', 'snippets']
  );
  assert.deepEqual(librarySearchScopePlan('everything'), {
    books: true,
    snippets: true,
    dictionary: true
  });
  assert.deepEqual(librarySearchScopePlan('books'), {
    books: true,
    snippets: false,
    dictionary: false
  });
  assert.deepEqual(librarySearchScopePlan('snippets'), {
    books: false,
    snippets: true,
    dictionary: false
  });
});
