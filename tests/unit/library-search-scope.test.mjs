/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  librarySearchQueryWithinLimit,
  librarySearchScopePlan,
  librarySearchScopes,
  libraryShelfSearchQuery,
  MAX_LIBRARY_SEARCH_CODEPOINTS,
  parseLibrarySearchScope
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
  assert.equal(parseLibrarySearchScope('books'), 'books');
  assert.equal(parseLibrarySearchScope('snippets'), 'snippets');
  assert.equal(parseLibrarySearchScope('everything'), 'everything');
  assert.equal(parseLibrarySearchScope('all'), 'everything');
  assert.equal(parseLibrarySearchScope('unknown'), 'everything');
  assert.equal(parseLibrarySearchScope(null), 'everything');
});

test('unified search suppresses hidden shelf filtering until selection mode owns the shelf', () => {
  assert.equal(libraryShelfSearchQuery('猫', false), '');
  assert.equal(libraryShelfSearchQuery('猫', true), '猫');
  assert.equal(libraryShelfSearchQuery('', false), '');
  assert.equal(libraryShelfSearchQuery('', true), '');
});

test('unified search query limit counts Unicode code points without UTF-16 inflation', () => {
  assert.equal(MAX_LIBRARY_SEARCH_CODEPOINTS, 512);
  assert.equal(librarySearchQueryWithinLimit('𠮷'.repeat(512)), true);
  assert.equal(librarySearchQueryWithinLimit('𠮷'.repeat(513)), false);
});
