import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readerAccessOwners,
  visibleLibraryEntries
} from '../../apps/web/src/lib/library/account-visibility.ts';

const cards = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
const links = [
  { bookId: 1, owner: 'account-a' },
  { bookId: 2, owner: 'account-b' },
  { bookId: 3, owner: null },
  { bookId: 4, owner: 'account-a' },
  { bookId: 4, owner: 'account-b' }
];

test('another account’s linked books cannot fall back to browser imports', () => {
  assert.deepEqual(
    visibleLibraryEntries(cards, links, 'account-a').cards.map((card) => card.id),
    [1, 3, 4]
  );
  assert.deepEqual(
    visibleLibraryEntries(cards, links, 'account-b').cards.map((card) => card.id),
    [2, 3, 4]
  );
  assert.deepEqual(
    visibleLibraryEntries(cards, links, null).cards.map((card) => card.id),
    [3]
  );
});

test('direct imports remain visible and links must load before saved cards appear', () => {
  const direct = { id: 5 };
  assert.deepEqual(
    visibleLibraryEntries([...cards, direct], links, 'account-a').cards.at(-1),
    direct
  );
  assert.deepEqual(visibleLibraryEntries([...cards, direct], null, 'account-a'), {
    cards: [],
    links: []
  });
});

test('an account-scoped book remains private if link publication was interrupted', () => {
  const pending = { id: 6, libraryOwner: 'account-a' };
  assert.deepEqual(visibleLibraryEntries([pending], [], 'account-a').cards, [pending]);
  assert.deepEqual(visibleLibraryEntries([pending], [], 'account-b').cards, []);
  assert.deepEqual(visibleLibraryEntries([pending], [], null).cards, []);
});

test('personal reading scope hides a local book from every other profile', () => {
  const scoped = { id: 9, readerOwner: 'account-a' };
  assert.deepEqual(visibleLibraryEntries([scoped], [], 'account-a').cards, [scoped]);
  assert.deepEqual(visibleLibraryEntries([scoped], [], 'account-b').cards, []);
  assert.deepEqual(visibleLibraryEntries([scoped], [], null).cards, []);
});

test('durable reader ownership outranks links and contradictory claims fail closed', () => {
  assert.deepEqual(
    readerAccessOwners({}, { accountId: 'account-a' }, [{ owner: null }, { owner: 'account-b' }]),
    ['account-a']
  );
  assert.equal(
    readerAccessOwners({ libraryOwner: 'account-a' }, { accountId: 'account-b' }, [
      { owner: 'account-a' }
    ]),
    undefined
  );
  assert.deepEqual(
    readerAccessOwners({}, undefined, [{ owner: 'account-a' }, { owner: 'account-b' }]),
    ['account-a', 'account-b']
  );
  assert.deepEqual(readerAccessOwners({}, undefined, [{ owner: null }]), []);
});
