import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WANT_TO_READ_ID,
  wantToReadCollection,
  collectionContains,
  changeWantToRead
} from '../../apps/web/src/lib/library/want-to-read.ts';
import {
  applyPortableOrganization,
  portableOrganization
} from '../../apps/web/src/lib/library/organization-portability.ts';

const first = `content:${'a'.repeat(64)}`;
const second = `content:${'b'.repeat(64)}`;
const book = (key, aliases = []) => ({
  organizationKey: key,
  organizationAliases: [key, ...aliases]
});
const empty = () => ({ version: 1, collections: [], books: {} });

test('Want to Read exists empty without mutating settings or claiming a same-named custom collection', () => {
  const value = empty();
  value.collections.push({ id: 'user-collection', name: 'Want to Read', members: [first] });
  const before = globalThis.structuredClone(value);
  assert.deepEqual(wantToReadCollection(value), {
    id: WANT_TO_READ_ID,
    name: 'Want to Read',
    members: []
  });
  changeWantToRead(value, [], false);
  assert.deepEqual(value, before);
});

test('adding and removing multiple books preserves other collections and overrides', () => {
  const value = empty();
  value.collections.push({ id: 'study', name: 'Study', members: [first, second] });
  value.books[first] = { title: 'My title', modifiedAt: 10 };
  const original = globalThis.structuredClone(value);
  changeWantToRead(value, [book(first), book(second)], true);
  changeWantToRead(value, [book(first), book(second)], true);
  assert.deepEqual(wantToReadCollection(value).members, [first, second]);
  changeWantToRead(value, [book(first)], false);
  assert.deepEqual(wantToReadCollection(value).members, [second]);
  assert.deepEqual(value.collections[0], original.collections[0]);
  assert.deepEqual(value.books, original.books);
});

test('all old aliases are removed so a saved book cannot resurrect after a move or reimport', () => {
  const value = empty();
  value.collections.push({
    id: WANT_TO_READ_ID,
    name: 'Want to Read',
    members: ['book:1', 'source:old', first, second]
  });
  const moved = book(first, ['book:1', 'source:old', 'source:new']);
  assert.equal(collectionContains(wantToReadCollection(value), moved), true);
  changeWantToRead(value, [moved], false);
  assert.deepEqual(wantToReadCollection(value).members, [second]);
  assert.equal(collectionContains(wantToReadCollection(value), moved), false);
  changeWantToRead(value, [moved], true);
  assert.deepEqual(wantToReadCollection(value).members, [second, first]);
});

test('unavailable references survive sync and count only when their content becomes available', () => {
  const deviceA = empty();
  changeWantToRead(deviceA, [book(first), book(second), book('book:3')], true);
  const remote = portableOrganization(deviceA);
  assert.deepEqual(wantToReadCollection(remote).members, [first, second]);
  const deviceB = applyPortableOrganization(empty(), remote);
  const available = [book(first, ['book:99', 'source:moved'])];
  assert.equal(
    available.filter((item) => collectionContains(wantToReadCollection(deviceB), item)).length,
    1
  );
  assert.deepEqual(wantToReadCollection(deviceB).members, [first, second]);
  assert.equal(collectionContains(wantToReadCollection(deviceB), book('book:3')), false);
  changeWantToRead(deviceB, [book(first)], false);
  assert.deepEqual(
    wantToReadCollection(applyPortableOrganization(deviceA, portableOrganization(deviceB))).members,
    [second, 'book:3']
  );
});

test('clearing the list keeps an explicit empty built-in record for shared removals', () => {
  const local = empty();
  changeWantToRead(local, [book(first)], true);
  const other = applyPortableOrganization(empty(), portableOrganization(local));
  changeWantToRead(local, [book(first)], false);
  assert.deepEqual(
    wantToReadCollection(applyPortableOrganization(other, portableOrganization(local))).members,
    []
  );
  assert.equal(local.collections.length, 1);
});
