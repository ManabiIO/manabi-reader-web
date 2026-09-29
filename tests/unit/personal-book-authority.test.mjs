import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  livePersonalCopies,
  planPersonalBookClaims
} from '../../apps/web/src/lib/manabi/personal-book-authority.ts';

const hash = 'a'.repeat(64);
const bookKey = 'content:' + hash;

function index(entries) {
  return {
    async openKeyCursor() {
      const cursor = (position) =>
        position >= entries.length
          ? null
          : {
              key: entries[position][0],
              primaryKey: entries[position][1],
              continue: async () => cursor(position + 1)
            };
      return cursor(0);
    }
  };
}

function stores({ books, scopes = [], ownerEntries } = {}) {
  const titles = books.map((book) => [book.title, book.id]);
  const hashes = books.map((book) => [book.contentHash, book.id]);
  const owners =
    ownerEntries ??
    books.flatMap((book) => (book.libraryOwner === undefined ? [] : [[book.libraryOwner, book.id]]));
  return {
    data: {
      index(name) {
        return index(name === 'title' ? titles : name === 'contentHash' ? hashes : owners);
      }
    },
    scopes: { getAll: async () => globalThis.structuredClone(scopes) }
  };
}

const candidate = (id, changes = {}) => ({
  id,
  title: 'Copy ' + id,
  contentHash: hash,
  ...changes
});

test('live personal authority keeps the sync-start copies while account evidence is unchanged', async () => {
  const expected = [candidate(1), candidate(2)];
  const fixture = stores({
    books: expected,
    scopes: [
      { bookId: 1, accountId: 'alice' },
      { bookId: 2, accountId: 'alice' }
    ]
  });
  assert.deepEqual(
    await livePersonalCopies(bookKey, expected, fixture.data, fixture.scopes, 'alice', () => {}),
    expected
  );
});

test('a newly foreign exact copy invalidates stale personal-sync authority', async () => {
  const expected = [candidate(1)];
  const fixture = stores({
    books: [...expected, candidate(2, { libraryOwner: 'bob' })],
    scopes: [{ bookId: 1, accountId: 'alice' }]
  });
  await assert.rejects(
    livePersonalCopies(bookKey, expected, fixture.data, fixture.scopes, 'alice', () => {}),
    /ownership changed/
  );
});

test('a sync-start copy reassigned to another account cannot be read or written', async () => {
  const expected = [candidate(1)];
  const fixture = stores({
    books: expected,
    scopes: [{ bookId: 1, accountId: 'bob' }]
  });
  await assert.rejects(
    livePersonalCopies(bookKey, expected, fixture.data, fixture.scopes, 'alice', () => {}),
    /ownership changed/
  );
});

test('deleting every sync-start copy does not turn local absence into a personal-state deletion', async () => {
  const expected = [candidate(1)];
  const fixture = stores({ books: [], scopes: [] });
  await assert.rejects(
    livePersonalCopies(bookKey, expected, fixture.data, fixture.scopes, 'alice', () => {}),
    /No reading state was changed/
  );
});

test('a newly discovered unowned exact copy does not invalidate the already scoped copy', async () => {
  const expected = [candidate(1)];
  const fixture = stores({
    books: [...expected, candidate(2)],
    scopes: [{ bookId: 1, accountId: 'alice' }]
  });
  assert.deepEqual(
    await livePersonalCopies(bookKey, expected, fixture.data, fixture.scopes, 'alice', () => {}),
    expected
  );
});

test('invalid persistent owner evidence fails closed', async () => {
  const expected = [candidate(1)];
  const fixture = stores({
    books: [...expected, candidate(2)],
    scopes: [{ bookId: 1, accountId: 'alice' }],
    ownerEntries: [[42, 2]]
  });
  await assert.rejects(
    livePersonalCopies(bookKey, expected, fixture.data, fixture.scopes, 'alice', () => {}),
    /ownership changed/
  );
});

test('authority assertions run while the index inventory is being read', async () => {
  const expected = [candidate(1)];
  const fixture = stores({
    books: expected,
    scopes: [{ bookId: 1, accountId: 'alice' }]
  });
  let calls = 0;
  await assert.rejects(
    livePersonalCopies(bookKey, expected, fixture.data, fixture.scopes, 'alice', () => {
      calls += 1;
      if (calls === 2) throw new Error('account revoked');
    }),
    /account revoked/
  );
  assert.equal(calls, 2);
});

test('scope planning claims all unowned exact copies for one account in one plan', () => {
  const metadata = [candidate(1), candidate(2)];
  const alice = planPersonalBookClaims(metadata, [], 'alice');
  assert.deepEqual(alice.books, metadata);
  assert.deepEqual(alice.scopesToCreate, [
    { bookId: 1, accountId: 'alice' },
    { bookId: 2, accountId: 'alice' }
  ]);

  const bob = planPersonalBookClaims(metadata, alice.scopesToCreate, 'bob');
  assert.deepEqual(bob.books, []);
  assert.deepEqual(bob.scopesToCreate, []);
});

test('one pre-existing foreign scope blocks claiming every exact copy for another account', () => {
  const metadata = [candidate(1), candidate(2)];
  const plan = planPersonalBookClaims(
    metadata,
    [{ bookId: 1, accountId: 'bob' }],
    'alice'
  );
  assert.deepEqual(plan.books, []);
  assert.deepEqual(plan.scopesToCreate, []);
});

test('mixed existing owners remain unclaimable for either account', () => {
  const metadata = [candidate(1), candidate(2)];
  const scopes = [
    { bookId: 1, accountId: 'alice' },
    { bookId: 2, accountId: 'bob' }
  ];
  assert.deepEqual(planPersonalBookClaims(metadata, scopes, 'alice').books, []);
  assert.deepEqual(planPersonalBookClaims(metadata, scopes, 'bob').books, []);
});
