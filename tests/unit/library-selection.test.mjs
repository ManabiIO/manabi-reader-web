import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LibrarySelection,
  adjacentSelection,
  librarySelectionScopeKey,
  marqueeSelection,
  reconcileSelectionEligibility
} from '../../apps/web/src/lib/library/selection.ts';
const items = ['a', 'b', 'c', 'd', 'e'].map((key, i) => ({ key, ids: [i + 1] }));
const ids = (value) => [...value].sort((a, b) => a - b);
test('plain click selects exactly one; command/control toggles independent books', () => {
  const selection = new LibrarySelection();
  assert.deepEqual(ids(selection.choose('a', items)), [1]);
  assert.deepEqual(ids(selection.choose('d', items, { toggle: true })), [1, 4]);
  assert.deepEqual(ids(selection.choose('a', items, { toggle: true })), [4]);
  assert.deepEqual(ids(selection.choose('c', items)), [3]);
});
test('shift expands and contracts an anchored range, in either direction', () => {
  const selection = new LibrarySelection();
  selection.choose('b', items);
  assert.deepEqual(ids(selection.choose('e', items, { shift: true })), [2, 3, 4, 5]);
  assert.deepEqual(ids(selection.choose('c', items, { shift: true })), [2, 3]);
  assert.deepEqual(ids(selection.choose('a', items, { shift: true })), [1, 2]);
});
test('range retains independent command selections without retaining stale range extensions', () => {
  const selection = new LibrarySelection();
  selection.choose('a', items);
  selection.choose('c', items, { toggle: true });
  selection.choose('e', items, { shift: true });
  assert.deepEqual(ids(selection.choose('d', items, { shift: true })), [1, 3, 4]);
});
test('range uses current visible sort order rather than numeric IDs', () => {
  const selection = new LibrarySelection();
  selection.choose('a', items);
  assert.deepEqual(
    ids(selection.choose('c', [items[0], items[4], items[2]], { shift: true })),
    [1, 3, 5]
  );
});
test('external selection supplies an anchor, and disappearing items cannot remain selected', () => {
  const selection = new LibrarySelection();
  selection.sync(new Set([2]), items);
  assert.deepEqual(ids(selection.choose('d', items, { shift: true })), [2, 3, 4]);
  selection.sync(selection.selected, [items[0], items[3]]);
  assert.deepEqual(ids(selection.selected), [4]);
  selection.reset();
  assert.equal(selection.selected.size, 0);
  assert.equal(selection.anchor, undefined);
});
test('series tiles toggle only their eligible visible saved books', () => {
  const grouped = [
    { key: 'series', ids: [1, 2] },
    { key: 'other', ids: [3] },
    { key: 'unimported', ids: [] }
  ];
  const selection = new LibrarySelection();
  assert.deepEqual(ids(selection.choose('series', grouped)), [1, 2]);
  assert.deepEqual(ids(selection.choose('series', grouped, { toggle: true })), []);
  assert.deepEqual(ids(selection.all(grouped)), [1, 2, 3]);
});
test('marquee replacement, additive and toggle all use the gesture baseline', () => {
  const hits = new Set(['b', 'c']);
  assert.deepEqual(ids(marqueeSelection(items, hits, new Set([1, 2]), {})), [2, 3]);
  assert.deepEqual(ids(marqueeSelection(items, hits, new Set([1, 2]), { shift: true })), [1, 2, 3]);
  assert.deepEqual(ids(marqueeSelection(items, hits, new Set([1, 2]), { toggle: true })), [1, 3]);
  assert.deepEqual(ids(marqueeSelection(items, new Set(), new Set([1]), {})), []);
});
test('keyboard geometry follows responsive rows, wrapping labels and bounds', () => {
  const rects = [
    { key: 'a', left: 0, right: 100, top: 0, bottom: 180 },
    { key: 'b', left: 120, right: 220, top: 0, bottom: 210 },
    { key: 'c', left: 0, right: 100, top: 240, bottom: 420 },
    { key: 'd', left: 120, right: 220, top: 240, bottom: 450 },
    { key: 'e', left: 0, right: 100, top: 480, bottom: 660 }
  ];
  assert.equal(adjacentSelection(rects, 'b', 'ArrowDown'), 'd');
  assert.equal(adjacentSelection(rects, 'd', 'ArrowDown'), 'e');
  assert.equal(adjacentSelection(rects, 'd', 'ArrowUp'), 'b');
  assert.equal(adjacentSelection(rects, 'a', 'ArrowLeft'), 'a');
  assert.equal(adjacentSelection(rects, 'c', 'Home'), 'a');
  assert.equal(adjacentSelection(rects, undefined, 'End'), 'e');
  assert.equal(adjacentSelection([], undefined, 'ArrowDown'), undefined);
});
test('external Select All replaces the old range baseline while equal UI echoes retain it', () => {
  const selection = new LibrarySelection();
  selection.choose('b', items);
  selection.choose('d', items, { shift: true });
  selection.sync(new Set(selection.selected), items);
  assert.deepEqual(ids(selection.choose('c', items, { shift: true })), [2, 3]);
  selection.sync(new Set([1, 2, 3, 4, 5]), items);
  assert.deepEqual(ids(selection.choose('b', items, { shift: true })), [1, 2, 3, 4, 5]);
});

test('selection scope identity cannot collide across delimiter-shaped values', () => {
  const a = librarySelectionScopeKey({
    viewerId: 'user:one',
    collectionId: 'books',
    seriesId: 'series',
    unfinished: false,
    searchScope: 'everything',
    search: '猫:books'
  });
  const b = librarySelectionScopeKey({
    viewerId: 'user',
    collectionId: 'one:books',
    seriesId: 'series',
    unfinished: false,
    searchScope: 'everything',
    search: '猫:books'
  });
  assert.notEqual(a, b);
  assert.equal(
    a,
    librarySelectionScopeKey({
      viewerId: 'user:one',
      collectionId: 'books',
      seriesId: 'series',
      unfinished: false,
      searchScope: 'everything',
      search: '猫:books'
    })
  );
});

test('visible-scope reconciliation clears selection when search scope changes', () => {
  const result = reconcileSelectionEligibility(
    'local:books::all:everything:',
    { key: 'local:books::all:books:parity 1', ids: [2], previews: ['preview-b'] },
    new Set([1]),
    new Set(['preview-a'])
  );
  assert.equal(result.scope, 'local:books::all:books:parity 1');
  assert.deepEqual([...result.ids], []);
  assert.deepEqual([...result.previews], []);
});

test('visible-scope reconciliation trims only unavailable items inside one scope', () => {
  const result = reconcileSelectionEligibility(
    'local:books::all:everything:',
    { key: 'local:books::all:everything:', ids: [2, 3], previews: ['preview-b'] },
    new Set([1, 2, 3]),
    new Set(['preview-a', 'preview-b'])
  );
  assert.deepEqual([...result.ids], [2, 3]);
  assert.deepEqual([...result.previews], ['preview-b']);
});

test('rendered string identities select unopened previews without manufacturing browser IDs', () => {
  const model = new LibrarySelection();
  const entries = [
    { key: 'saved', ids: ['book:1'] },
    { key: 'preview', ids: ['source:opaque'] },
    { key: 'series', ids: ['source:two', 'book:2'] }
  ];
  assert.deepEqual([...model.choose('preview', entries)], ['source:opaque']);
  assert.deepEqual(
    [...model.choose('series', entries, { shift: true })],
    ['source:opaque', 'source:two', 'book:2']
  );
  model.sync(new Set(['source:opaque', 'missing']), entries);
  assert.deepEqual([...model.selected], ['source:opaque']);
});
