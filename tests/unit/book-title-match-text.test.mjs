/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bookTitleMatchText } from '../../apps/web/src/lib/search/book-title-match-text.ts';

const book = (key, aliases = [key]) => ({ key, organizationAliases: aliases });

test('book title match context retains nested series and overlapping collection names', () => {
  const a = book('book:a', ['book:a', 'content:a']);
  const b = book('book:b', ['book:b']);
  const tree = [
    {
      kind: 'series',
      id: 'outer',
      directoryId: 'outer',
      name: 'Outer Shelf',
      books: [a, b],
      children: [
        { kind: 'book', id: a.key, book: a },
        {
          kind: 'series',
          id: 'inner',
          directoryId: 'inner',
          name: 'Cat Studies',
          books: [a],
          children: [{ kind: 'book', id: a.key, book: a }]
        },
        { kind: 'book', id: b.key, book: b }
      ]
    }
  ];
  const collections = [
    { id: 'one', name: 'Cat Studies', members: ['content:a'] },
    { id: 'two', name: 'Cat Archive', members: ['book:a', 'book:b'] },
    { id: 'other', name: 'Dogs', members: ['book:a'] }
  ];

  assert.deepEqual(bookTitleMatchText([a, b], tree, collections, 'cat'), {
    'book:a': [
      { text: 'Cat Studies', detail: 'Series · Cat Studies' },
      { text: 'Cat Studies', detail: 'Collection · Cat Studies' },
      { text: 'Cat Archive', detail: 'Collection · Cat Archive' }
    ],
    'book:b': [{ text: 'Cat Archive', detail: 'Collection · Cat Archive' }]
  });
});

test('book title match context is empty without a query', () => {
  assert.deepEqual(bookTitleMatchText([book('book:a')], [], [], ''), {});
});
