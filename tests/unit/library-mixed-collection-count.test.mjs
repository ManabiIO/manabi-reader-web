/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectionContains,
  collectionItemCount
} from '../../apps/web/src/lib/library/want-to-read.ts';

const book = (key, aliases = []) => ({
  organizationKey: key,
  organizationAliases: [key, ...aliases]
});

test('mixed collection counts books and active snippet identities once each', () => {
  const collection = {
    id: 'study',
    name: 'Study',
    members: [
      'content:book-a',
      'legacy:book-a',
      'snippet:10000000-0000-4000-8000-000000000001',
      'snippet:10000000-0000-4000-8000-000000000001'
    ]
  };
  const books = [book('content:book-a', ['legacy:book-a']), book('content:book-b')];
  const snippets = new Set(['snippet:10000000-0000-4000-8000-000000000001']);
  assert.equal(collectionContains(collection, books[0]), true);
  assert.equal(collectionContains(collection, books[1]), false);
  assert.equal(collectionItemCount(collection, books, snippets), 2);
});

test('trashed or otherwise hidden snippets are excluded by the caller-provided active set', () => {
  const collection = {
    id: 'study',
    name: 'Study',
    members: [
      'snippet:10000000-0000-4000-8000-000000000001',
      'snippet:20000000-0000-4000-8000-000000000002'
    ]
  };
  assert.equal(
    collectionItemCount(collection, [], new Set(['snippet:10000000-0000-4000-8000-000000000001'])),
    1
  );
});

test('book alias membership counts one logical book, not every matching alias', () => {
  const collection = {
    id: 'study',
    name: 'Study',
    members: ['content:book-a', 'legacy:book-a', 'source:book-a']
  };
  assert.equal(
    collectionItemCount(
      collection,
      [book('content:book-a', ['legacy:book-a', 'source:book-a'])],
      new Set()
    ),
    1
  );
});
