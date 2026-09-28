/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOfflineModule } from './fixtures/offline-module.mjs';

// Execute the complete production progress/traversal/counter graph; only the
// DOM transport is controlled here. Native DOM/CSS cases are separate evidence.
const {
  api: { FoliateCharacterProgress }
} = loadOfflineModule('apps/web/src/lib/foliate-epub/foliate-character-progress.ts');
const text = (value) => ({
  nodeType: 3,
  textContent: value,
  data: value,
  childNodes: [],
  hasChildNodes: () => false
});
const element = (localName, childNodes = [], attributes = {}) => ({
  nodeType: 1,
  localName,
  childNodes,
  classList: [],
  hasChildNodes: () => childNodes.length > 0,
  hasAttribute: (name) => Object.hasOwn(attributes, name)
});
function range(nodes, first, last, startOffset = 0, endOffset = nodes[last].data.length) {
  return {
    collapsed: first === last && startOffset === endOffset,
    startContainer: nodes[first],
    startOffset,
    endContainer: nodes[last],
    endOffset,
    intersectsNode: (node) => nodes.indexOf(node) >= first && nodes.indexOf(node) <= last
  };
}

function bookmarkFixture(children) {
  const content = element('div', children);
  const contains = (parent, candidate) =>
    parent === candidate || parent.childNodes.some((child) => contains(child, candidate));
  content.contains = (node) => contains(content, node);
  content.ownerDocument = {
    createRange: () => ({
      startContainer: undefined,
      startOffset: undefined,
      collapsed: false,
      setStart(node, offset) {
        this.startContainer = node;
        this.startOffset = offset;
      },
      selectNodeContents(node) {
        this.startContainer = node;
        this.startOffset = 0;
      },
      collapse(toStart) {
        this.collapsed = true;
        this.collapsedToStart = toStart;
      }
    })
  };
  return { content, progress: new FoliateCharacterProgress([content]) };
}

for (const [label, makeExcluded] of [
  ['ruby annotation', (node) => element('rt', [node])],
  ['hidden text', (node) => element('span', [node], { hidden: '' })],
  ['ARIA-hidden text', (node) => element('span', [node], { 'aria-hidden': 'true' })]
]) {
  test(`bookmark prefix cannot count ${label} omitted by reader traversal`, () => {
    const before = text('漢'),
      excluded = text('よみかた'),
      after = text('字文');
    const { content, progress } = bookmarkFixture([
      element('p', [before, makeExcluded(excluded), after])
    ]);
    const visible = range([before, excluded, after], 1, 2, 2, 1);
    assert.equal(progress.bookCharacterCount, 3);
    assert.equal(progress.exploredCharacterCount(0, content, visible), 1);
    assert.equal(progress.bookmarkCharacterCount(0, content, visible), 1);
    const restored = progress.rangeForCharacterCount(0, content, 1);
    assert.equal(restored.startContainer, after);
    assert.equal(restored.startOffset, 0);
  });
}

test('a range entirely in excluded ruby retains the no-intersection fallback', () => {
  const base = text('漢'),
    annotation = text('かん'),
    after = text('字');
  const { content, progress } = bookmarkFixture([
    element('ruby', [base, element('rt', [annotation])]),
    after
  ]);
  const visible = range([base, annotation, after], 1, 1, 1, 2);
  assert.equal(progress.bookmarkCharacterCount(0, content, visible), 0);
});

test('excluded prefix cannot inflate a repeated spine occurrence', () => {
  const before = text('漢'),
    annotation = text('かん'),
    after = text('字');
  const { content } = bookmarkFixture([
    element('ruby', [before, element('rt', [annotation])]),
    after
  ]);
  const progress = new FoliateCharacterProgress([content, content]);
  const visible = range([before, annotation, after], 1, 2, 1, 1);
  assert.equal(progress.bookmarkCharacterCount(1, content, visible), 3);
});

for (const value of ['abcd', '𠮷あ𠮷い']) {
  test(`collapsed text-end bookmark counts its complete prefix (${value})`, () => {
    const node = text(value);
    const { content, progress } = bookmarkFixture([element('p', [node])]);
    const caret = range([node], 0, 0, value.length, value.length);
    assert.equal(progress.exploredCharacterCount(0, content, caret), 0);
    assert.equal(progress.bookmarkCharacterCount(0, content, caret), 4);
    const restored = progress.rangeForCharacterCount(0, content, 4);
    assert.equal(restored.startContainer, node);
    assert.equal(restored.startOffset, value.length);
    assert.equal(caret.startOffset, value.length);
    assert.equal(caret.collapsed, true);
  });
}

test('collapsed text end includes the preceding chapter exactly once', () => {
  const first = bookmarkFixture([text('abc')]);
  const node = text('字文');
  const second = bookmarkFixture([node]);
  const progress = new FoliateCharacterProgress([first.content, second.content]);
  assert.equal(progress.bookmarkCharacterCount(1, second.content, range([node], 0, 0, 2, 2)), 5);
});

test('a noncollapsed range starting at the previous text end does not double-count it', () => {
  const first = text('abcd'),
    second = text('次文');
  const { content, progress } = bookmarkFixture([first, second]);
  assert.equal(progress.bookmarkCharacterCount(0, content, range([first, second], 0, 1, 4, 1)), 4);
});

for (const requested of [4, 5, 1000]) {
  test(`restoring ${requested} at or beyond the final count reaches the final text end`, () => {
    const node = text('abcd');
    const { content, progress } = bookmarkFixture([element('p', [node])]);
    const restored = progress.rangeForCharacterCount(0, content, requested);
    assert.equal(restored.startContainer, node);
    assert.equal(restored.startOffset, 4);
    assert.equal(restored.collapsed, true);
  });
}

test('restoring section end includes trailing uncounted text without changing the total', () => {
  const reading = text('漢字'),
    punctuation = text('。！？');
  const { content, progress } = bookmarkFixture([reading, punctuation]);
  const restored = progress.rangeForCharacterCount(0, content, 2);
  assert.equal(progress.bookCharacterCount, 2);
  assert.equal(restored.startContainer, punctuation);
  assert.equal(restored.startOffset, 3);
});

test('section-end restoration subtracts the preceding section count', () => {
  const first = bookmarkFixture([text('abc')]);
  const node = text('𠮷い');
  const second = bookmarkFixture([node]);
  const progress = new FoliateCharacterProgress([first.content, second.content]);
  const restored = progress.rangeForCharacterCount(1, second.content, 5);
  assert.equal(restored.startContainer, node);
  assert.equal(restored.startOffset, 3);
});

for (const value of [NaN, Infinity, -Infinity]) {
  test(`nonfinite saved count ${value} cannot fabricate a DOM anchor`, () => {
    const { content, progress } = bookmarkFixture([text('abcd')]);
    assert.equal(progress.rangeForCharacterCount(0, content, value), undefined);
  });
}

test('legacy zero and negative values still resolve to the original text start', () => {
  const node = text('、𠮷あ');
  const { content, progress } = bookmarkFixture([node]);
  for (const value of [0, -1]) {
    const restored = progress.rangeForCharacterCount(0, content, value);
    assert.equal(restored.startContainer, node);
    assert.equal(restored.startOffset, 0);
  }
});

test('interior counted positions preserve supplementary code points and ignored punctuation', () => {
  const node = text('𠮷、あ𠮷い');
  const { content, progress } = bookmarkFixture([node]);
  for (const [count, offset] of [
    [1, 2],
    [2, 4],
    [3, 6]
  ]) {
    const restored = progress.rangeForCharacterCount(0, content, count);
    assert.equal(restored.startContainer, node);
    assert.equal(restored.startOffset, offset);
  }
});

test('legacy fractional positions retain their existing forward character boundary', () => {
  const node = text('abcd');
  const { content, progress } = bookmarkFixture([node]);
  assert.equal(progress.rangeForCharacterCount(0, content, 1.5).startOffset, 2);
});

test('gaiji remains an atomic count and a DOM-element anchor', () => {
  const image = element('img');
  image.classList = ['gaiji'];
  const { content, progress } = bookmarkFixture([text('字'), image]);
  assert.equal(progress.bookCharacterCount, 2);
  assert.equal(progress.rangeForCharacterCount(0, content, 1).startContainer, image);
});

test('missing and foreign bookmark ranges retain the current section fallback', () => {
  const { content, progress } = bookmarkFixture([text('abcd')]);
  assert.equal(progress.bookmarkCharacterCount(0, content), 0);
  const foreign = text('別の文章');
  assert.equal(progress.bookmarkCharacterCount(0, content, range([foreign], 0, 0, 1, 2)), 0);
});

test('an empty section still has no fabricated restoration range', () => {
  const { content, progress } = bookmarkFixture([]);
  assert.equal(progress.rangeForCharacterCount(0, content, 0), undefined);
});
