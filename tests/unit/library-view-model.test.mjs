import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allBooks, buildShelf, visibleShelf } from '../../apps/web/src/lib/library/view-model.ts';
import {
  bookKey,
  contentBookKey,
  sourceBookKey,
  sourceKey
} from '../../apps/web/src/lib/library/organization-keys.ts';

const hash = 'a'.repeat(64);
const source = (id = 'disk', owner = null, root = '') => ({ id, owner, root });
const card = (id, changes = {}) => ({
  id,
  title: `Saved ${id}`,
  imagePath: '',
  characters: 1000,
  lastBookModified: 10,
  lastBookOpen: 20,
  progress: 0.4,
  lastBookmarkModified: 30,
  isPlaceholder: false,
  contentHash: hash,
  ...changes
});
const link = (bookId, storage, fileId, contentHash = hash) => ({
  bookId,
  sourceId: storage.id,
  owner: storage.owner,
  root: storage.root,
  fileId,
  name: fileId,
  contentHash
});
const catalog = (storage, files, scannedAt = 100) => ({
  source: storage,
  scannedAt,
  names: {},
  entries: files.map((id) => ({ id, parent: storage.root, name: id, kind: 'file' }))
});
const previewsFor = (catalogs, contentHash = hash) =>
  Object.fromEntries(
    catalogs.flatMap((scan) =>
      scan.entries.map((entry) => {
        const key = sourceBookKey(scan.source, entry.id);
        return [
          key,
          {
            key,
            scannedAt: scan.scannedAt,
            metadataVersion: 2,
            contentHash,
            title: entry.name,
            pageDirection: { value: 'unknown', source: 'unknown' }
          }
        ];
      })
    )
  );
const emptyOrganization = () => ({ version: 1, collections: [], books: {} });
function shelf(cards, links, catalogs, previews = previewsFor(catalogs), organization) {
  return buildShelf(
    cards,
    links,
    catalogs,
    catalogs.map((scan) => scan.source),
    organization ?? emptyOrganization(),
    previews
  );
}
const atFile = (books, storage, fileId) =>
  books.find(
    (book) =>
      book.source && sourceKey(book.source) === sourceKey(storage) && book.file?.id === fileId
  );
const physicalBooks = (nodes) =>
  nodes.flatMap((node) => (node.kind === 'book' ? [node.book] : physicalBooks(node.children)));

// These fixtures call the same production projection used by the library, not a
// second implementation of its matching/sorting rules or mocked database reads.
test('an unambiguous moved file retains its saved identity, progress and presentation', () => {
  const storage = source();
  const saved = card(1);
  const links = [link(1, storage, 'before.epub')];
  const scans = [catalog(storage, ['after.epub'])];
  const organization = emptyOrganization();
  organization.books[bookKey(1)] = { title: 'My title', modifiedAt: 40 };
  const inputs = globalThis.structuredClone({ saved, links, scans, organization });
  const books = allBooks(shelf([saved], links, scans, undefined, organization));
  assert.equal(books.length, 1);
  assert.equal(books[0].bookId, 1);
  assert.equal(books[0].file.id, 'after.epub');
  assert.equal(books[0].key, bookKey(1));
  assert.equal(books[0].progress, saved.progress);
  assert.equal(books[0].title, 'My title');
  assert.equal(books[0].organizationKey, contentBookKey(hash));
  assert.ok(books[0].organizationAliases.includes(sourceBookKey(storage, 'after.epub')));
  assert.deepEqual({ saved, links, scans, organization }, inputs);
});

test('identical destinations share one reading identity while remaining separate physical copies', () => {
  const storage = source();
  for (const files of [
    ['a.epub', 'b.epub'],
    ['b.epub', 'a.epub']
  ]) {
    const scans = [catalog(storage, files)];
    const nodes = shelf([card(1)], [link(1, storage, 'old.epub')], scans);
    const copies = physicalBooks(nodes);
    assert.equal(copies.length, 2);
    assert.equal(allBooks(nodes).length, 1, 'aggregate views count one logical book');
    for (const file of files) {
      const book = atFile(copies, storage, file);
      assert.equal(book.bookId, 1);
      assert.equal(book.key, bookKey(1));
      assert.equal(book.progress, 0.4);
    }
  }
});

test('personal series deduplicate multiple physical copies of one logical book', () => {
  const storage = source();
  const scans = [catalog(storage, ['a.epub', 'b.epub'])];
  const organization = emptyOrganization();
  organization.books[contentBookKey(hash)] = {
    modifiedAt: 40,
    series: { name: 'Series', index: 2 }
  };
  const nodes = shelf([card(1)], [link(1, storage, 'old.epub')], scans, undefined, organization);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].kind, 'series');
  assert.equal(nodes[0].personal, true);
  assert.equal(nodes[0].books.length, 1);
  assert.equal(nodes[0].children.length, 1);
  assert.equal(nodes[0].books[0].key, bookKey(1));
  assert.equal(physicalBooks(nodes).length, 1, 'presentation must expose one logical row');
});

test('two missing saved copies cannot arbitrarily donate one identity to a destination', () => {
  const storage = source();
  const first = link(1, storage, 'old-a.epub');
  const second = link(2, storage, 'old-b.epub');
  for (const links of [
    [first, second],
    [second, first]
  ]) {
    const books = allBooks(
      shelf([card(1), card(2, { progress: 0.8 })], links, [catalog(storage, ['new.epub'])])
    );
    assert.equal(books.length, 3);
    assert.equal(atFile(books, storage, 'new.epub').bookId, undefined);
    assert.equal(books.find((book) => book.bookId === 1).progress, 0.4);
    assert.equal(books.find((book) => book.bookId === 2).progress, 0.8);
  }
});

test('multiple physical links to the same logical book are not a history conflict', () => {
  const first = source('first');
  const second = source('second');
  const third = source('third');
  const scans = [catalog(first, []), catalog(second, []), catalog(third, ['copy.epub'])];
  const books = allBooks(
    shelf([card(1)], [link(1, first, 'old-a.epub'), link(1, second, 'old-b.epub')], scans)
  );
  assert.equal(books.length, 1);
  assert.equal(atFile(books, third, 'copy.epub').bookId, 1);
  assert.equal(atFile(books, third, 'copy.epub').progress, 0.4);
});

test('identical destinations in different local sources share progress but keep both locators', () => {
  const first = source('first');
  const second = source('second');
  const scans = [catalog(first, ['new-a.epub']), catalog(second, ['new-b.epub'])];
  for (const order of [scans, [...scans].reverse()]) {
    const nodes = shelf([card(1)], [link(1, first, 'old.epub')], order);
    const copies = physicalBooks(nodes);
    assert.equal(copies.length, 2);
    assert.equal(allBooks(nodes).length, 1);
    assert.equal(atFile(copies, first, 'new-a.epub').bookId, 1);
    assert.equal(atFile(copies, second, 'new-b.epub').bookId, 1);
  }
});

test('a unique move between scanned local sources still keeps its saved identity', () => {
  const first = source('first');
  const second = source('second');
  const scans = [catalog(first, []), catalog(second, ['new.epub'])];
  const books = allBooks(shelf([card(1)], [link(1, first, 'old.epub')], scans));
  assert.equal(books.length, 1);
  assert.equal(atFile(books, second, 'new.epub').bookId, 1);
});

test('same bytes in different accounts do not make either account ambiguous', () => {
  const alice = source('cloud', 'alice', 'root');
  const bob = source('cloud', 'bob', 'root');
  const scans = [catalog(alice, ['new.epub']), catalog(bob, ['new.epub'])];
  const books = allBooks(
    shelf([card(1), card(2)], [link(1, alice, 'old.epub'), link(2, bob, 'old.epub')], scans)
  );
  assert.equal(books.length, 2);
  assert.equal(atFile(books, alice, 'new.epub').bookId, 1);
  assert.equal(atFile(books, bob, 'new.epub').bookId, 2);
});

test('a move is never inferred across an account boundary', () => {
  const alice = source('cloud', 'alice');
  const bob = source('cloud', 'bob');
  const scans = [catalog(alice, []), catalog(bob, ['new.epub'])];
  const books = allBooks(shelf([card(1)], [link(1, alice, 'old.epub')], scans));
  assert.equal(books.length, 2);
  assert.equal(atFile(books, bob, 'new.epub').bookId, undefined);
});

test('an exact-byte copy can reuse established progress even while the original source is unscanned', () => {
  const original = source('offline');
  const target = source('online');
  const scans = [catalog(target, ['copy.epub'])];
  const books = allBooks(shelf([card(1)], [link(1, original, 'old.epub')], scans));
  assert.equal(books.length, 1);
  assert.equal(atFile(books, target, 'copy.epub').bookId, 1);
});

test('a browser-only book shares progress with an exact local-folder copy without a title heuristic', () => {
  const local = source('folder');
  const saved = card(1, { title: 'My renamed browser copy' });
  const scans = [catalog(local, ['different-name.epub'])];
  const books = allBooks(shelf([saved], [], scans));
  assert.equal(books.length, 1);
  assert.equal(atFile(books, local, 'different-name.epub').bookId, 1);
  assert.equal(atFile(books, local, 'different-name.epub').progress, 0.4);
  assert.equal(atFile(books, local, 'different-name.epub').title, 'My renamed browser copy');
});

test('stale previews cannot identify a move or make a fresh target ambiguous', () => {
  const storage = source();
  const scans = [catalog(storage, ['fresh.epub', 'stale.epub'])];
  const previews = previewsFor(scans);
  previews[sourceBookKey(storage, 'stale.epub')].scannedAt--;
  const books = allBooks(shelf([card(1)], [link(1, storage, 'old.epub')], scans, previews));
  assert.equal(books.length, 2);
  assert.equal(atFile(books, storage, 'fresh.epub').bookId, 1);
  assert.equal(atFile(books, storage, 'stale.epub').bookId, undefined);
});

test('an exact link remains valid when another same-content history makes an unlinked copy ambiguous', () => {
  const storage = source();
  const scans = [catalog(storage, ['new.epub', 'existing.epub'])];
  const books = allBooks(
    shelf(
      [card(1), card(2)],
      [link(1, storage, 'old.epub'), link(2, storage, 'existing.epub')],
      scans
    )
  );
  assert.equal(books.length, 3);
  assert.equal(atFile(books, storage, 'new.epub').bookId, undefined);
  assert.equal(atFile(books, storage, 'existing.epub').bookId, 2);
  assert.equal(books.find((book) => book.bookId === 1).progress, 0.4);
});

test('a still-present original and its identical copy share progress without hiding either locator', () => {
  const storage = source();
  const scans = [catalog(storage, ['old.epub', 'copy.epub'])];
  const nodes = shelf([card(1)], [link(1, storage, 'old.epub')], scans);
  const copies = physicalBooks(nodes);
  assert.equal(copies.length, 2);
  assert.equal(allBooks(nodes).length, 1);
  assert.equal(atFile(copies, storage, 'old.epub').bookId, 1);
  assert.equal(atFile(copies, storage, 'copy.epub').bookId, 1);
});

const shelfBook = (key, creators) => ({
  ...card(1),
  key,
  organizationKey: key,
  organizationAliases: [key],
  canonicalTitle: key,
  title: key,
  creators,
  direction: 'unknown'
});
const bookNode = (key, creators) => ({ kind: 'book', id: key, book: shelfBook(key, creators) });
const series = (id, creators) => {
  const children = [bookNode(`${id}-1`, creators), bookNode(`${id}-2`, creators)];
  return {
    kind: 'series',
    id,
    directoryId: id,
    name: id,
    source: source(),
    children,
    books: children.map((node) => node.book)
  };
};
const atwood = [{ name: 'Margaret Atwood', sortAs: 'Atwood, Margaret' }];
const camus = [{ name: 'Albert Camus', sortAs: 'Camus, Albert' }];
const sortAuthors = (nodes, direction = 'asc', include = () => true) =>
  visibleShelf(nodes, include, { property: 'author', direction });

for (const direction of ['asc', 'desc']) {
  test(`series author sorting honors file-as just like individual books (${direction})`, () => {
    const nodes = [series('atwood', atwood), series('camus', camus)];
    const expected = direction === 'asc' ? ['atwood', 'camus'] : ['camus', 'atwood'];
    assert.deepEqual(
      sortAuthors(nodes, direction).map((node) => node.id),
      expected
    );
    const standalone = [bookNode('atwood', atwood), bookNode('camus', camus)];
    assert.deepEqual(
      sortAuthors(standalone, direction).map((node) => node.id),
      expected
    );
  });
}

test('unknown and mixed-author series remain last in both directions', () => {
  const mixed = series('mixed', atwood);
  mixed.books[1].creators = camus;
  for (const direction of ['asc', 'desc']) {
    const nodes = [series('unknown', []), mixed, series('known', atwood)];
    assert.deepEqual(
      sortAuthors(nodes, direction).map((node) => node.id),
      ['known', 'mixed', 'unknown']
    );
  }
});

test('author sorting uses visible members without mutating the original series', () => {
  const mixed = series('mixed', camus);
  mixed.books[0].creators = atwood;
  const other = series('other', camus);
  const before = globalThis.structuredClone([mixed, other]);
  const sorted = sortAuthors([mixed, other], 'asc', (book) => book.key !== 'mixed-2');
  assert.deepEqual(
    sorted.map((node) => node.id),
    ['mixed', 'other']
  );
  assert.equal(sorted[0].books.length, 1);
  assert.deepEqual([mixed, other], before);
});

test('library key encodings remain compatible and distinguish opaque source components', () => {
  assert.equal(bookKey(12), 'book:12');
  assert.equal(contentBookKey(hash), `content:${hash}`);
  assert.equal(sourceKey(source('disk')), '[null,"disk",""]');
  assert.equal(sourceBookKey(source('disk'), 'a/b'), 'source:[null,"disk","","a/b"]');
  assert.notEqual(
    sourceBookKey(source('a', null, 'b'), 'c'),
    sourceBookKey(source('a', null, ''), 'b/c')
  );
  assert.notEqual(sourceKey(source('disk')), sourceKey(source('disk', 'null')));
});
