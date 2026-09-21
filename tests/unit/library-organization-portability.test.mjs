import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPortableOrganization,
  isPortableBookKey,
  portableOrganization
} from '../../apps/web/src/lib/library/organization-portability.ts';

const first = `content:${'a'.repeat(64)}`;
const second = `content:${'b'.repeat(64)}`;
const source = 'source:[null,"local-device-a","","book.txt"]';
const details = (title, modifiedAt = 1) => ({ title, modifiedAt });
const organization = (books = {}, members = []) => ({
  version: 1,
  books,
  collections: [{ id: 'collection-1', name: 'Study', members }]
});

test('only canonical full content hashes are portable book identities', () => {
  assert.equal(isPortableBookKey(first), true);
  for (const key of [
    'book:1',
    source,
    'book.txt',
    'content:a',
    `content:${'A'.repeat(64)}`,
    `${first}\n`
  ]) {
    assert.equal(isPortableBookKey(key), false, key);
  }
});

test('exports content identities without numeric book IDs or source locators', () => {
  const local = organization(
    {
      'book:1': details('Local only'),
      [source]: details('Folder only'),
      [first]: details('Shared')
    },
    ['book:1', source, first, first]
  );
  const before = globalThis.structuredClone(local);
  assert.deepEqual(
    portableOrganization(local),
    organization({ [first]: details('Shared') }, [first])
  );
  assert.deepEqual(local, before);
});

test('a remote book:1 can never overwrite this installation’s unrelated book:1', () => {
  const deviceB = organization(
    { 'book:1': details('B’s own book'), [source]: details('B’s source') },
    ['book:1', source]
  );
  const deviceA = organization(
    {
      'book:1': details('A’s unrelated book', 999),
      [source]: details('A’s source', 999),
      [first]: details('Shared book')
    },
    ['book:1', source, first]
  );
  const result = applyPortableOrganization(deviceB, deviceA);
  assert.deepEqual(result.books['book:1'], deviceB.books['book:1']);
  assert.deepEqual(result.books[source], deviceB.books[source]);
  assert.deepEqual(result.books[first], deviceA.books[first]);
  assert.deepEqual(result.collections[0].members, [first, 'book:1', source]);
});

test('legacy remote locators cannot create local presentations or memberships', () => {
  const remote = organization(
    { 'book:1': details('Wrong book'), [source]: details('Wrong source') },
    ['book:1', source]
  );
  assert.deepEqual(applyPortableOrganization(organization(), remote), organization());
});

test('missing shared books retain portable titles, covers and collection references', () => {
  const remote = organization(
    {
      [first]: {
        ...details('Not downloaded yet'),
        cover: 'data:image/png;base64,AA==',
        direction: 'rtl'
      }
    },
    [first]
  );
  const result = applyPortableOrganization(organization(), remote);
  assert.deepEqual(result, remote);
  result.books[first].title = 'Changed locally';
  result.collections[0].members.push(second);
  assert.equal(remote.books[first].title, 'Not downloaded yet');
  assert.deepEqual(remote.collections[0].members, [first]);
});

test('shared deletions apply without erasing unrelated local book presentation', () => {
  const local = organization({ 'book:1': details('Local'), [first]: details('Shared override') }, [
    'book:1',
    first
  ]);
  const remote = { version: 1, books: {}, collections: [] };
  assert.deepEqual(applyPortableOrganization(local, remote), {
    version: 1,
    books: { 'book:1': details('Local') },
    collections: []
  });
});

test('accepted shared memberships replace removed content but preserve local-only members', () => {
  const local = organization({}, ['book:1', first]);
  const remote = organization({}, [second]);
  assert.deepEqual(applyPortableOrganization(local, remote).collections[0].members, [
    second,
    'book:1'
  ]);
});

test('repeated application is stable and local-only state never re-enters the export', () => {
  const local = organization({ 'book:1': details('Local') }, ['book:1']);
  const remote = organization({ [first]: details('Shared') }, [first]);
  const applied = applyPortableOrganization(local, remote);
  assert.deepEqual(applyPortableOrganization(applied, remote), applied);
  assert.deepEqual(portableOrganization(applied), remote);
});

test('promotion to a verified content key makes formerly local details portable', () => {
  const presentation = details('My title');
  assert.deepEqual(
    portableOrganization(organization({ 'book:1': presentation }, ['book:1'])).books,
    {}
  );
  const promoted = organization({ [first]: presentation }, [first]);
  assert.deepEqual(portableOrganization(promoted), promoted);
});
