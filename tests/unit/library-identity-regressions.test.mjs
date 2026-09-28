import assert from 'node:assert/strict';
import test from 'node:test';
import { allBooks, buildShelf } from '../../apps/web/src/lib/library/view-model.ts';
import {
  bookKey,
  contentBookKey,
  sourceBookKey
} from '../../apps/web/src/lib/library/organization-keys.ts';

const a = 'a'.repeat(64);
const b = 'b'.repeat(64);
const disk = { id: 'disk', owner: null, root: '', name: 'Disk', provider: 'local' };
const card = (id, contentHash = a) => ({
  id,
  contentHash,
  title: `Saved ${id}`,
  imagePath: `cover-${id}`,
  characters: 100,
  lastBookModified: 1,
  lastBookOpen: 2,
  progress: id / 10,
  lastBookmarkModified: 3,
  isPlaceholder: false,
  pageDirection: { value: 'ltr', source: 'spine' }
});
const link = (bookId, fileId, contentHash = a) => ({
  id: `${bookId}-${fileId}-${contentHash}`,
  bookId,
  sourceId: disk.id,
  owner: null,
  root: '',
  fileId,
  contentHash,
  name: fileId,
  title: `Saved ${bookId}`,
  syncEnabled: false
});
function build(cards, links, hash = a, organization = { version: 1, collections: [], books: {} }) {
  const key = sourceBookKey(disk, 'book.epub');
  const previews =
    hash === null
      ? {}
      : {
          [key]: {
            key,
            scannedAt: 100,
            metadataVersion: 2,
            contentHash: hash,
            title: 'Current file',
            pageDirection: { value: 'rtl', source: 'spine' }
          }
        };
  const catalogs = [
    {
      source: disk,
      scannedAt: 100,
      names: {},
      entries: [{ id: 'book.epub', parent: '', name: 'book.epub', kind: 'file' }]
    }
  ];
  return allBooks(buildShelf(cards, links, catalogs, [disk], organization, previews));
}
const physical = (books) => books.find((book) => book.file?.id === 'book.epub');

test('fresh replacement bytes cannot inherit the old path progress or completion', () => {
  const old = {
    ...card(1),
    completion: { state: 'finished', finishedOn: '2026-01-01', modifiedAt: 10 }
  };
  const books = build([old], [link(1, 'book.epub')], b);
  assert.equal(physical(books).bookId, undefined);
  assert.equal(physical(books).progress, 0);
  assert.equal(physical(books).completion, undefined);
  assert.equal(physical(books).contentHash, b);
  assert.equal(physical(books).title, 'Current file');
  assert.equal(books.find((book) => book.bookId === 1).progress, 0.1);
});

test('a replaced source keeps the prior cached book without a false physical locator', () => {
  const books = build([card(1)], [link(1, 'book.epub')], b);
  const retained = books.find((book) => book.bookId === 1);
  assert.ok(retained);
  assert.equal(retained.file, undefined);
  assert.equal(retained.contentHash, a);
});

test('multiple revisions at the same file select only the verified revision, in either order', () => {
  const links = [link(1, 'book.epub'), link(2, 'book.epub', b)];
  for (const order of [links, [...links].reverse()]) {
    assert.equal(physical(build([card(1), card(2, b)], order, a)).bookId, 1);
    assert.equal(physical(build([card(1), card(2, b)], order, b)).bookId, 2);
  }
});

test('multiple live histories at the same exact file are not resolved by iteration order', () => {
  const links = [link(1, 'book.epub'), link(2, 'book.epub')];
  for (const order of [links, [...links].reverse()])
    assert.equal(physical(build([card(1), card(2)], order)).bookId, undefined);
});

test('deleted browser rows cannot make a valid exact-copy match ambiguous', () => {
  const books = build([card(1)], [link(1, 'old.epub'), link(999, 'deleted.epub')]);
  assert.equal(physical(books).bookId, 1);
  assert.equal(books.length, 1);
});

test('a link hash cannot impersonate different content actually stored under that bookId', () => {
  const books = build([card(1, b)], [link(1, 'book.epub')]);
  assert.equal(physical(books).bookId, undefined);
  assert.equal(physical(books).contentHash, a);
  assert.equal(books.find((book) => book.bookId === 1).contentHash, b);
});

test('replacement content cannot inherit source-alias title, cover or collection membership', () => {
  const alias = sourceBookKey(disk, 'book.epub');
  const organization = {
    version: 1,
    collections: [{ id: 'old', name: 'Original', members: [alias] }],
    books: { [alias]: { title: 'Private old title', cover: 'old-cover', modifiedAt: 100 } }
  };
  const result = physical(build([card(1)], [link(1, 'book.epub')], b, organization));
  assert.equal(result.title, 'Current file');
  assert.notEqual(result.imagePath, 'old-cover');
  assert.equal(result.organizationAliases.includes(alias), false);
  assert.equal(result.organizationKey, contentBookKey(b));
});

test('unknown historical link hashes cannot outrank current preview content identity', () => {
  const result = physical(build([], [link(999, 'book.epub', 'not-a-hash')], a));
  assert.equal(result.contentHash, a);
  assert.equal(result.organizationKey, contentBookKey(a));
});

test('an unchanged exact copy preserves all progress and the original input objects', () => {
  const cards = [card(1)];
  const links = [link(1, 'before.epub')];
  const before = globalThis.structuredClone({ cards, links });
  const result = physical(build(cards, links));
  assert.equal(result.bookId, 1);
  assert.equal(result.key, bookKey(1));
  assert.equal(result.progress, 0.1);
  assert.deepEqual({ cards, links }, before);
});
