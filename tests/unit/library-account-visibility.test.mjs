import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleLibraryEntries } from '../../apps/web/src/lib/library/account-visibility.ts';

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
