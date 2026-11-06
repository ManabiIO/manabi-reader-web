/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  attachReaderDictionaryInteraction,
  readerDictionarySelection,
  openReaderDictionaryLookup,
  closeReaderDictionaryLookup,
  dismissReaderDictionaryLookup
} from '../../apps/web/src/lib/search/reader-dictionary-interaction.ts';

function fixture(t) {
  const dom = new JSDOM('<article><p>猫と学校</p></article><aside>外</aside>');
  const document = dom.window.document;
  const root = document.querySelector('article');
  const abort = new AbortController();
  const detach = attachReaderDictionaryInteraction(root, {
    bookKey: 'book',
    chapterID: 'one',
    signal: abort.signal
  });
  t.after(() => {
    detach();
    closeReaderDictionaryLookup();
    dom.window.close();
  });
  return {
    document,
    root,
    abort,
    detach,
    select(start, end, node = root.querySelector('p').firstChild) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      range.getBoundingClientRect = () => ({ left: 12, top: 20, bottom: 42 });
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new dom.window.Event('selectionchange'));
    }
  };
}
test('explicit selection offers bounded dictionary lookup without changing prose or opening storage', (t) => {
  const f = fixture(t);
  const html = f.root.innerHTML;
  f.select(0, 1);
  assert.equal(readerDictionarySelection.getSnapshot().query, '猫');
  assert.equal(readerDictionarySelection.getSnapshot().open, false);
  openReaderDictionaryLookup();
  assert.equal(readerDictionarySelection.getSnapshot().open, true);
  assert.equal(f.root.innerHTML, html);
  f.abort.abort();
  assert.equal(readerDictionarySelection.getSnapshot(), null);
  assert.equal(f.root.hasAttribute('data-reader-dictionary-attached'), false);
});
test('dialog dismissal retains a connected selection trigger, but chapter retirement removes it', (t) => {
  const f = fixture(t);
  f.select(0, 1);
  openReaderDictionaryLookup();
  dismissReaderDictionaryLookup();
  assert.equal(readerDictionarySelection.getSnapshot().open, false);
  assert.equal(readerDictionarySelection.getSnapshot().query, '猫');
  f.abort.abort();
  assert.equal(readerDictionarySelection.getSnapshot(), null);
});
test('outside selection, empty selection and overlong selections do not become lookups', (t) => {
  const f = fixture(t);
  f.select(0, 1);
  f.select(0, 1, f.document.querySelector('aside').firstChild);
  assert.equal(readerDictionarySelection.getSnapshot(), null);
  f.root.querySelector('p').textContent = '字'.repeat(257);
  f.select(0, 257);
  assert.equal(readerDictionarySelection.getSnapshot(), null);
  f.select(0, 0);
  assert.equal(readerDictionarySelection.getSnapshot(), null);
});
test('retired chapter cannot retain a popup or publish a later selection', (t) => {
  const f = fixture(t);
  f.select(0, 1);
  openReaderDictionaryLookup();
  f.detach();
  assert.equal(readerDictionarySelection.getSnapshot(), null);
  f.select(0, 1);
  assert.equal(readerDictionarySelection.getSnapshot(), null);
});
test('manual dictionary opening can start empty and closing keeps the chapter owner available', (t) => {
  const f = fixture(t);
  openReaderDictionaryLookup();
  assert.equal(readerDictionarySelection.getSnapshot().owner.root, f.root);
  assert.equal(readerDictionarySelection.getSnapshot().query, '');
  closeReaderDictionaryLookup();
  f.select(0, 1);
  assert.equal(readerDictionarySelection.getSnapshot().query, '猫');
});
