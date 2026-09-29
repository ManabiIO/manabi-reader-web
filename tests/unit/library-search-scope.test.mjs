/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  librarySearchScopes,
  scopeIncludesBooks,
  scopeIncludesDictionary,
  scopeIncludesSnippets
} from '../../apps/web/src/lib/search/library-search-scope.ts';

test('library search scopes are orthogonal item scopes', () => {
  assert.deepEqual(
    librarySearchScopes.map((item) => item.id),
    ['everything', 'books', 'snippets']
  );
  assert.equal(scopeIncludesBooks('everything'), true);
  assert.equal(scopeIncludesSnippets('everything'), true);
  assert.equal(scopeIncludesDictionary('everything'), true);
  assert.equal(scopeIncludesBooks('books'), true);
  assert.equal(scopeIncludesSnippets('books'), false);
  assert.equal(scopeIncludesDictionary('books'), false);
  assert.equal(scopeIncludesBooks('snippets'), false);
  assert.equal(scopeIncludesSnippets('snippets'), true);
  assert.equal(scopeIncludesDictionary('snippets'), false);
});
