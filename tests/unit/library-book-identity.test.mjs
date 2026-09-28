import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BookIdentityIndex,
  normalizedContentHash as normalize,
  organizationIdentityReplacements as replacementsFor,
  resolveImportedBook as resolve,
  selectBookLink as select
} from '../../apps/web/src/lib/library/book-identity.ts';
import {
  bookKey,
  contentBookKey,
  sourceBookKey
} from '../../apps/web/src/lib/library/organization-keys.ts';

const hash = 'a'.repeat(64);
const other = 'b'.repeat(64);
const source = { id: 'disk', owner: null, root: '' };
const record = (id, contentHash = hash) => ({ id, contentHash });
const link = (bookId, fileId = 'old.epub', changes = {}) => ({
  id: `link-${bookId}`,
  bookId,
  sourceId: source.id,
  owner: null,
  root: '',
  fileId,
  contentHash: hash,
  name: fileId,
  title: 'Book',
  syncEnabled: false,
  ...changes
});

test('content identity normalization accepts only exact SHA-256 encodings', () => {
  assert.equal(normalize(hash.toUpperCase()), hash);
  for (const value of [null, undefined, 42, '', 'g'.repeat(64), hash + ' ', hash.slice(1)])
    assert.equal(normalize(value), undefined);
});

test('a moved row ID is not a locator and cannot be overwritten when the old path is reused', () => {
  const moved = link(1, 'Series/book.epub', {
    id: 'old-path-id',
    syncEnabled: true,
    base: { keep: 1 }
  });
  const desired = link(1, 'book.epub', { id: 'old-path-id' });
  const before = globalThis.structuredClone(moved);
  const result = select([moved], desired, new Set([1]), 'fresh-id');
  assert.equal(result.id, 'fresh-id');
  assert.equal(result.fileId, 'book.epub');
  assert.deepEqual(moved, before);
  assert.equal(result.bookId, moved.bookId);
});

test('actual locator lookup reuses the moved row and preserves its sync consent and baseline', () => {
  const moved = link(1, 'Series/book.epub', {
    id: 'old-path-id',
    syncEnabled: true,
    base: { keep: 1 }
  });
  const desired = link(1, 'Series/book.epub', { id: 'computed-new-path' });
  const result = select([moved], desired, new Set([1]), 'fresh');
  assert.equal(result, moved);
  assert.equal(result.syncEnabled, true);
  assert.deepEqual(result.base, { keep: 1 });
});

test('even an occupied fallback fails instead of replacing another link', () => {
  const links = [
    link(1, 'elsewhere.epub', { id: 'occupied' }),
    link(2, 'other.epub', { id: 'fallback' })
  ];
  const proposed = link(1, 'new.epub', { id: 'occupied' });
  assert.throws(() => select(links, proposed, new Set([1]), 'fallback'), /changed/);
  assert.deepEqual(
    links.map((item) => item.fileId),
    ['elsewhere.epub', 'other.epub']
  );
});

test('link publication rejects a new live exact-locator conflict', () => {
  assert.throws(() => select([link(2)], link(1), new Set([1, 2]), 'fresh'), /conflicting/);
});

test('retained links to deleted books do not block publishing a reimport', () => {
  const stale = link(1, 'old.epub');
  const result = select([stale], link(2, 'old.epub', { id: stale.id }), new Set([2]), 'fresh');
  assert.equal(result.id, 'fresh');
  assert.equal(result.bookId, 2);
});

test('browser-only duplicates participate in conflicts even with a requested bookId', () => {
  const forward = [record(1), record(2)];
  for (const records of [forward, [...forward].reverse()]) {
    assert.throws(() => resolve(records, [], source, 'copy.epub', hash), /multiple saved/);
    assert.throws(() => resolve(records, [], source, 'copy.epub', hash, 1), /multiple saved/);
  }
});

test('an expected numeric ID cannot grant another account ownership of equal bytes', () => {
  const alice = { ...source, owner: 'alice' };
  const links = [link(1, 'original.epub', { owner: 'bob' })];
  assert.throws(() => resolve([record(1)], links, alice, 'copy.epub', hash, 1), /changed/);
  assert.equal(resolve([record(1)], links, alice, 'copy.epub', hash), undefined);
});

test('unlinked local books are not silently adopted by the current cloud account', () => {
  const alice = { ...source, owner: 'alice' };
  assert.equal(resolve([record(1)], [], alice, 'copy.epub', hash), undefined);
  assert.equal(resolve([record(1)], [], source, 'copy.epub', hash), 1);
});

test('the exact physical copy remains selectable without merging independent same-byte histories', () => {
  const links = [link(1, 'one.epub'), link(2, 'two.epub')];
  assert.equal(resolve([record(1), record(2)], links, source, 'one.epub', hash), 1);
  assert.equal(resolve([record(1), record(2)], links, source, 'two.epub', hash), 2);
  assert.throws(
    () => resolve([record(1), record(2)], links, source, 'copy.epub', hash),
    /multiple saved/
  );
});

test('multiple revisions sharing a locator are selected by actual hash, not link order', () => {
  const links = [link(1), link(2, 'old.epub', { contentHash: other })];
  for (const ordered of [links, [...links].reverse()]) {
    assert.equal(resolve([record(1), record(2, other)], ordered, source, 'old.epub', hash), 1);
    assert.equal(resolve([record(1), record(2, other)], ordered, source, 'old.epub', other), 2);
  }
});

test('a stale link cannot override the live row hash, with or without an expected ID', () => {
  assert.equal(resolve([record(1, other)], [link(1)], source, 'old.epub', hash), undefined);
  assert.throws(
    () => resolve([record(1, other)], [link(1)], source, 'old.epub', hash, 1),
    /changed/
  );
});

test('deleted saved rows cannot manufacture a conflict or satisfy an expected identity', () => {
  assert.equal(resolve([record(1)], [link(1), link(2)], source, 'copy.epub', hash), 1);
  assert.equal(resolve([], [link(1), link(2)], source, 'copy.epub', hash), undefined);
  assert.throws(() => resolve([], [link(1)], source, 'copy.epub', hash, 1), /changed/);
});

test('multiple physical links to one live book are not multiple reading histories', () => {
  const links = Array.from({ length: 1000 }, (_, i) => link(1, `copy-${i}.epub`));
  assert.equal(resolve([record(1)], links, source, 'next.epub', hash), 1);
});

test('hashless legacy rows are retained but do not acquire a guessed byte identity', () => {
  assert.equal(resolve([{ id: 1 }], [link(1)], source, 'old.epub', hash), undefined);
});

test('index owns its matching snapshot instead of observing later caller mutations', () => {
  const records = [record(1)];
  const links = [link(1)];
  const index = new BookIdentityIndex(records, links);
  records[0].contentHash = other;
  links[0].fileId = 'different.epub';
  links[0].bookId = 9;
  assert.deepEqual(index.resolve(source, 'old.epub', hash), { kind: 'matched', bookId: 1 });
});

test('invalid import identities fail without producing a selected record', () => {
  assert.throws(() => resolve([record(1)], [], source, 'copy', 'invalid'), /invalid/);
  for (const id of [0, -1, 0.5, NaN, Infinity])
    assert.throws(() => resolve([record(1)], [], source, 'copy', hash, id), /invalid/);
});

test('source alias promotion refuses a reused path with competing revision claims', () => {
  const links = [link(1), link(2, 'old.epub', { contentHash: other })];
  for (const order of [links, [...links].reverse()]) {
    const replacements = replacementsFor(order, [record(1), record(2, other)]);
    assert.equal(replacements.has(sourceBookKey(source, 'old.epub')), false);
    assert.equal(replacements.get(bookKey(1)), contentBookKey(hash));
    assert.equal(replacements.get(bookKey(2)), contentBookKey(other));
  }
});

test('conflicting hashes for one saved book do not arbitrarily migrate its legacy metadata', () => {
  const links = [link(1, 'a.epub'), link(1, 'b.epub', { contentHash: other })];
  for (const order of [links, [...links].reverse()])
    assert.equal(replacementsFor(order, [record(1)]).has(bookKey(1)), false);
});

test('duplicate and uppercase claims still promote unchanged aliases compatibly', () => {
  const claims = [link(1), link(1, 'old.epub', { contentHash: hash.toUpperCase() })];
  const replacements = replacementsFor(claims, [record(1)]);
  assert.equal(replacements.get(bookKey(1)), contentBookKey(hash));
  assert.equal(replacements.get(sourceBookKey(source, 'old.epub')), contentBookKey(hash));
});

test('invalid historical hash claims never manufacture portable content keys', () => {
  const claims = [link(1, 'old.epub', { contentHash: 'bad' })];
  assert.equal(replacementsFor(claims, [record(1)]).size, 0);
});

test('stale claims cannot move a live replacement book’s legacy metadata to old content', () => {
  const replacements = replacementsFor([link(1)], [record(1, other)]);
  assert.equal(replacements.has(bookKey(1)), false);
});
