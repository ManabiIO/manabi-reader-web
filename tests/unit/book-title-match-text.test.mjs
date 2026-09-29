/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bookTitleMatchIndex } from '../../apps/web/src/lib/search/book-title-match-text.ts';

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
          personal: true,
          books: [a],
          children: [{ kind: 'book', id: a.key, book: a }]
        },
        {
          kind: 'series',
          id: 'folder',
          directoryId: 'folder',
          name: 'Cat Folder',
          books: [b],
          children: [{ kind: 'book', id: b.key, book: b }]
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

  const result = bookTitleMatchIndex([a, b], tree, collections, 'cat');
  assert.deepEqual(result.textByBook, {
    'book:a': [
      { text: 'Cat Studies', detail: 'Series · Cat Studies' },
      { text: 'Cat Studies', detail: 'Collection · Cat Studies' },
      { text: 'Cat Archive', detail: 'Collection · Cat Archive' }
    ],
    'book:b': [
      { text: 'Cat Folder', detail: 'Folder · Cat Folder' },
      { text: 'Cat Archive', detail: 'Collection · Cat Archive' }
    ]
  });
  assert.deepEqual([...result.matchedKeys], ['book:a', 'book:b']);
});

test('book title match context is empty without a query', () => {
  const result = bookTitleMatchIndex([book('book:a')], [], [], '');
  assert.deepEqual(result.textByBook, {});
  assert.deepEqual([...result.matchedKeys], []);
});
