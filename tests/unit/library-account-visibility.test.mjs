import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readerAccessOwners,
  visibleLibraryEntries
} from '../../apps/web/src/lib/library/account-visibility.ts';

const cards = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
const hash = 'a'.repeat(64);
const staleHash = 'b'.repeat(64);
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
    [1, 3]
  );
  assert.deepEqual(
    visibleLibraryEntries(cards, links, 'account-b').cards.map((card) => card.id),
    [2, 3]
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

test('personal reading-data scope does not hide an otherwise public local book', () => {
  const scoped = { id: 9 };
  assert.deepEqual(visibleLibraryEntries([scoped], [], 'account-a').cards, [scoped]);
  assert.deepEqual(visibleLibraryEntries([scoped], [], 'account-b').cards, [scoped]);
  assert.deepEqual(visibleLibraryEntries([scoped], [], null).cards, [scoped]);
  assert.deepEqual(readerAccessOwners({}, { accountId: 'account-a' }, []), []);
});

test('content ownership outranks links and contradictory private claims fail closed', () => {
  assert.deepEqual(
    readerAccessOwners({ contentHash: hash }, { accountId: 'account-a' }, [
      { owner: null, contentHash: hash },
      { owner: 'account-b', contentHash: hash }
    ]),
    []
  );
  assert.equal(
    readerAccessOwners({ libraryOwner: 'account-a' }, { accountId: 'account-b' }, [
      { owner: 'account-a' }
    ]),
    undefined
  );
  assert.equal(
    readerAccessOwners({}, undefined, [{ owner: 'account-a' }, { owner: 'account-b' }]),
    undefined
  );
  assert.deepEqual(readerAccessOwners({}, undefined, [{ owner: null }]), []);
  assert.deepEqual(
    readerAccessOwners({ contentHash: hash }, undefined, [
      { owner: null, contentHash: hash },
      { owner: 'account-a', contentHash: hash },
      { owner: 'account-b', contentHash: hash }
    ]),
    []
  );
});

test('a public local link keeps a legacy multi-account book public', () => {
  const mixedLinks = [
    { bookId: 7, owner: null, contentHash: hash },
    { bookId: 7, owner: 'account-a', contentHash: hash },
    { bookId: 7, owner: 'account-b', contentHash: hash }
  ];
  const card = { id: 7, contentHash: hash };
  assert.deepEqual(visibleLibraryEntries([card], mixedLinks, 'account-a').cards, [card]);
  assert.deepEqual(visibleLibraryEntries([card], mixedLinks, 'account-b').cards, [card]);
  assert.deepEqual(visibleLibraryEntries([card], mixedLinks, null).cards, [card]);
});

test('a stale public link cannot expose a multi-account legacy history', () => {
  const card = { id: 7, contentHash: hash };
  const mixedLinks = [
    { bookId: 7, owner: null, contentHash: staleHash },
    { bookId: 7, owner: 'account-a', contentHash: hash },
    { bookId: 7, owner: 'account-b', contentHash: hash }
  ];
  for (const viewer of [null, 'account-a', 'account-b'])
    assert.deepEqual(visibleLibraryEntries([card], mixedLinks, viewer), { cards: [], links: [] });
  assert.equal(readerAccessOwners(card, undefined, mixedLinks), undefined);
});

test('a stale private link cannot grant the current account access to a foreign row', () => {
  const card = { id: 8, contentHash: hash };
  const mixedLinks = [
    { bookId: 8, owner: 'account-a', contentHash: hash },
    { bookId: 8, owner: 'account-b', contentHash: staleHash }
  ];
  assert.deepEqual(visibleLibraryEntries([card], mixedLinks, 'account-a').cards, [card]);
  assert.deepEqual(visibleLibraryEntries([card], mixedLinks, 'account-b').cards, []);
  assert.deepEqual(readerAccessOwners(card, undefined, mixedLinks), ['account-a']);
});
