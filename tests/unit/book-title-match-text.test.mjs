/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookTitleMatchIndex,
  bookTitleMatchDetail,
  bookTitleSearchFields,
  buildBookTitleSearchSnapshot,
  queryBookTitleSearchSnapshot
} from '../../apps/web/src/lib/search/book-title-match-text.ts';

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

test('query-independent snapshot preserves direct and contextual matching semantics', () => {
  const a = {
    ...book('book:a', ['book:a', 'content:a']),
    title: 'Dog guide',
    canonicalTitle: 'Original dog title',
    creators: [{ name: 'Cat Author' }]
  };
  const b = {
    ...book('book:b', ['book:b']),
    title: 'Bird guide',
    canonicalTitle: 'Bird guide',
    creators: []
  };
  const tree = [
    {
      kind: 'series',
      id: 'folder',
      directoryId: 'folder',
      name: 'Cat Folder',
      books: [b],
      children: [{ kind: 'book', id: b.key, book: b }]
    }
  ];
  const collections = [
    { id: 'cats', name: 'Cat Archive', members: ['content:a'] },
    { id: 'dogs', name: 'Dog Archive', members: ['book:b'] }
  ];
  const snapshot = buildBookTitleSearchSnapshot([a, b], tree, collections);

  const cats = queryBookTitleSearchSnapshot(snapshot, 'cat');
  assert.deepEqual([...cats.matchedKeys], ['book:a', 'book:b']);
  assert.deepEqual(cats.textByBook, {
    'book:a': [{ text: 'Cat Archive', detail: 'Collection · Cat Archive' }],
    'book:b': [{ text: 'Cat Folder', detail: 'Folder · Cat Folder' }]
  });

  const original = queryBookTitleSearchSnapshot(snapshot, 'original');
  assert.deepEqual([...original.matchedKeys], ['book:a']);
  assert.deepEqual(original.textByBook, {});

  const dogs = queryBookTitleSearchSnapshot(snapshot, 'dog');
  assert.deepEqual([...dogs.matchedKeys], ['book:a', 'book:b']);
  assert.deepEqual(dogs.textByBook, {
    'book:b': [{ text: 'Dog Archive', detail: 'Collection · Dog Archive' }]
  });
});

test('nested folder index stores each leaf key once while parent matches admit descendants', () => {
  const item = {
    ...book('book:leaf'),
    title: 'Leaf',
    canonicalTitle: 'Leaf',
    creators: []
  };
  const inner = {
    kind: 'series',
    id: 'inner',
    directoryId: 'inner',
    name: 'Inner Cats',
    books: [item],
    children: [{ kind: 'book', id: item.key, book: item }]
  };
  const outer = {
    kind: 'series',
    id: 'outer',
    directoryId: 'outer',
    name: 'Outer Cats',
    books: [item],
    children: [inner]
  };
  const snapshot = buildBookTitleSearchSnapshot([item], [outer], []);
  const storedKeys = (groups) =>
    groups.reduce(
      (count, group) => count + group.bookKeys.length + storedKeys(group.children),
      0
    );
  assert.equal(storedKeys(snapshot.contexts), 1);
  assert.deepEqual([...queryBookTitleSearchSnapshot(snapshot, 'outer').matchedKeys], ['book:leaf']);
  assert.deepEqual(queryBookTitleSearchSnapshot(snapshot, 'outer').textByBook, {
    'book:leaf': [{ text: 'Outer Cats', detail: 'Folder · Outer Cats' }]
  });
  assert.deepEqual(queryBookTitleSearchSnapshot(snapshot, 'inner').textByBook, {
    'book:leaf': [{ text: 'Inner Cats', detail: 'Folder · Inner Cats' }]
  });
});

test('snapshot queries do not depend on later mutation of source metadata', () => {
  const item = {
    ...book('book:a'),
    title: 'Cat guide',
    canonicalTitle: 'Cat guide',
    creators: []
  };
  const snapshot = buildBookTitleSearchSnapshot([item], [], []);
  item.title = 'Dog guide';
  item.canonicalTitle = 'Dog guide';
  assert.deepEqual([...queryBookTitleSearchSnapshot(snapshot, 'cat').matchedKeys], ['book:a']);
  assert.deepEqual([...queryBookTitleSearchSnapshot(snapshot, 'dog').matchedKeys], []);
});

test('query-independent snapshot admits direct series metadata without shelf context', () => {
  const item = {
    ...book('book:series'),
    title: 'Dog guide',
    canonicalTitle: 'Dog guide',
    creators: [],
    series: { name: 'Cat Studies' }
  };
  const snapshot = buildBookTitleSearchSnapshot([item], [], []);
  const result = queryBookTitleSearchSnapshot(snapshot, 'cat');
  assert.deepEqual([...result.matchedKeys], ['book:series']);
  assert.equal(bookTitleMatchDetail(item, result.textByBook[item.key] ?? [], 'cat'), 'Series · Cat Studies');
});

test('book title match context is empty without a query', () => {
  const result = bookTitleMatchIndex([book('book:a')], [], [], '');
  assert.deepEqual(result.textByBook, {});
  assert.deepEqual([...result.matchedKeys], []);
});

test('metadata-only book matches explain their strongest matching field', () => {
  const item = {
    title: 'Dog guide',
    canonicalTitle: 'Copycat',
    creators: [{ name: 'Cat Author' }]
  };
  assert.equal(
    bookTitleMatchDetail(item, [{ text: 'cat', detail: 'Collection · cat' }], 'cat'),
    'Collection · cat'
  );
  assert.deepEqual(bookTitleSearchFields(item, []), {
    primary: ['Dog guide'],
    secondary: ['Copycat', 'Cat Author']
  });
  assert.equal(bookTitleMatchDetail({ ...item, title: 'Cat guide' }, [], 'cat'), 'Cat Author');
});

test('metadata explanation honors field precedence within the winning relevance tier', () => {
  const item = {
    title: 'Dog guide',
    canonicalTitle: 'Dog guide',
    creators: [{ name: 'Cat Author With A Long Name' }]
  };
  const contexts = [{ text: 'Cat Box', detail: 'Collection · Cat Box' }];
  assert.equal(bookTitleMatchDetail(item, contexts, 'cat'), 'Author · Cat Author With A Long Name');
  assert.equal(
    bookTitleMatchDetail(item, [{ text: 'cat', detail: 'Collection · cat' }], 'cat'),
    'Collection · cat'
  );
});

test('personal series is ranked and explained even without a shelf-tree context', () => {
  const item = { title: 'Dog guide', canonicalTitle: 'Dog guide', series: { name: 'Cat Studies' } };
  assert.deepEqual(bookTitleSearchFields(item, []), {
    primary: ['Dog guide'],
    secondary: ['Cat Studies']
  });
  assert.equal(bookTitleMatchDetail(item, [], 'cat'), 'Series · Cat Studies');
  assert.equal(bookTitleMatchDetail(item, [], 'dog'), undefined);
});
