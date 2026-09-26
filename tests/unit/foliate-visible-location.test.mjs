/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { VisibleReaderLocation } from '../../apps/web/src/lib/foliate-epub/visible-reader-location.ts';

const resource = { href: 'chapter.xhtml', spineIndex: 0, sectionId: 'chapter' };
function fixture(value = '前半𠮷後半') {
  const node = { nodeType: 3, textContent: value, data: value };
  const content = {
    childNodes: value ? [node] : [],
    isConnected: true,
    contains: (n) => n === node
  };
  const range = (start, end) => ({
    commonAncestorContainer: node,
    startContainer: node,
    endContainer: node,
    startOffset: start,
    endOffset: end,
    intersectsNode: (n) => n === node,
    cloneRange() {
      return { ...this };
    }
  });
  return { node, content, range };
}

test('captures the later-page visible range rather than the start of its iframe', async () => {
  const state = new VisibleReaderLocation();
  const { content, range } = fixture();
  state.update(content, resource, range(4, 6));
  const result = await state.capture('book');
  assert.equal(result.start, 3);
  assert.equal(result.end, 3);
  assert.equal(result.prefix, '前半𠮷');
  assert.equal(result.suffix, '後半');
});

test('a new relocation while hashing invalidates the previous captured point', async () => {
  const state = new VisibleReaderLocation();
  const { content, range } = fixture();
  state.update(content, resource, range(0, 2));
  const first = state.capture('book');
  state.update(content, resource, range(4, 6));
  assert.equal(await first, undefined);
  assert.equal((await state.capture('book')).start, 3);
});

test('unload and destruction do not return a point owned by the old document', async () => {
  const state = new VisibleReaderLocation();
  const { content, range } = fixture();
  state.update(content, resource, range(0, 2));
  const pending = state.capture('book');
  state.clear();
  assert.equal(await pending, undefined);
  state.update(content, resource, range(0, 2));
  content.isConnected = false;
  assert.equal(await state.capture('book'), undefined);
});

test('missing or foreign visible text does not silently become an offset-zero point', async () => {
  const state = new VisibleReaderLocation();
  const { content, range } = fixture();
  state.update(content, resource);
  assert.equal(await state.capture('book'), undefined);
  const other = fixture();
  state.update(other.content, resource, range(0, 2));
  assert.equal(await state.capture('book'), undefined);
});

test('textless pages still retain their exact repeated spine occurrence', async () => {
  const state = new VisibleReaderLocation();
  const { content } = fixture('');
  const repeated = { ...resource, spineIndex: 5 };
  state.update(content, repeated);
  repeated.spineIndex = 99;
  const result = await state.capture('book');
  assert.equal(result.resource.spineIndex, 5);
  assert.equal(result.start, 0);
});
