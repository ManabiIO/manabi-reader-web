/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { makeLocator, rangeAt, resolveLocator } from '../../apps/web/src/lib/reader-location.ts';

const bookKey = `content:${'a'.repeat(64)}`;
const source = () => ({
  resource: { href: 'chapter.xhtml', spineIndex: 2, sectionId: 'ttu-chapter' },
  text: 'あ𠮷いうえお'
});
function digestGate(t) {
  let release;
  t.mock.method(globalThis.crypto.subtle, 'digest', async (_algorithm, bytes) => {
    const result = createHash('sha256').update(bytes).digest();
    await new Promise((resolve) => {
      release = resolve;
    });
    return result;
  });
  return () => release();
}

test('capturing a locator owns the resource identity before asynchronous hashing', async (t) => {
  const projected = source();
  const release = digestGate(t);
  const pending = makeLocator(bookKey, projected, 1, 3);
  projected.resource.href = 'other.xhtml';
  projected.resource.spineIndex = 9;
  release();
  const locator = await pending;
  assert.equal(locator.resource.href, 'chapter.xhtml');
  assert.equal(locator.resource.spineIndex, 2);
  assert.notEqual(locator.resource, projected.resource);
  assert.equal(locator.quote, '𠮷い');
});

test('mutating a returned locator does not change the publication descriptor', async () => {
  const projected = source();
  const locator = await makeLocator(bookKey, projected, 1);
  locator.resource.href = 'other.xhtml';
  assert.equal(projected.resource.href, 'chapter.xhtml');
});

test('resolution owns caller coordinates and witnesses across the digest await', async (t) => {
  const projected = source();
  const locator = await makeLocator(bookKey, projected, 1, 3);
  const release = digestGate(t);
  const pending = resolveLocator(locator, projected, bookKey);
  locator.start = 4;
  locator.end = 5;
  locator.quote = 'え';
  locator.prefix = '';
  locator.suffix = '';
  release();
  assert.deepEqual(await pending, { start: 1, end: 3 });
});

test('resolution rejects a source whose text changes while its digest is pending', async (t) => {
  const projected = source();
  const locator = await makeLocator(bookKey, projected, 1, 3);
  const release = digestGate(t);
  const pending = resolveLocator(locator, projected, bookKey);
  projected.text = '全く異なる本文';
  release();
  assert.equal(await pending, undefined);
});

test('resolution rejects a spine retarget during hashing', async (t) => {
  const projected = source();
  const locator = await makeLocator(bookKey, projected, 1, 3);
  const release = digestGate(t);
  const pending = resolveLocator(locator, projected, bookKey);
  projected.resource.spineIndex = 3;
  release();
  assert.equal(await pending, undefined);
});

test('malformed coordinates reject before digest or witness recovery', async (t) => {
  const projected = source();
  const locator = await makeLocator(bookKey, projected, 1, 3);
  t.mock.method(globalThis.crypto.subtle, 'digest', () =>
    assert.fail('Invalid locators must not be hashed')
  );
  for (const values of [
    { start: 0.5 },
    { end: 3.5 },
    { start: -1 },
    { start: NaN },
    { end: Infinity },
    { start: 4, end: 2 },
    { projectionVersion: 0 }
  ]) {
    assert.equal(await resolveLocator({ ...locator, ...values }, projected, bookKey), undefined);
  }
});

test('a malformed identity or text witness is unresolved rather than throwing', async () => {
  const projected = source();
  const locator = await makeLocator(bookKey, projected, 1, 3);
  for (const value of [
    null,
    { ...locator, resource: undefined },
    { ...locator, prefix: null },
    { ...locator, suffix: 1 },
    { ...locator, quote: {} },
    { ...locator, resource: { ...locator.resource, spineIndex: 0.5 } }
  ]) {
    assert.equal(await resolveLocator(value, projected, bookKey), undefined);
  }
});

test('resolution rejects locator projections newer than this reader understands', async (t) => {
  const projected = source();
  const locator = await makeLocator(bookKey, projected, 1, 3);
  t.mock.method(globalThis.crypto.subtle, 'digest', () =>
    assert.fail('Unsupported locator versions must not be hashed')
  );
  assert.equal(
    await resolveLocator({ ...locator, projectionVersion: 999 }, projected, bookKey),
    undefined
  );
});

test('rangeAt refuses invalid points instead of clamping them to unrelated text', () => {
  const projected = {
    ...source(),
    runs: [],
    element: { ownerDocument: { createRange: () => assert.fail('Invalid point') } }
  };
  const node = {
    data: projected.text,
    ownerDocument: { createRange: () => assert.fail('Invalid point must not reveal a glyph') }
  };
  projected.runs = [{ node, start: 0, end: 6 }];
  for (const [start, end] of [
    [-1, -1],
    [7, 7],
    [0.5, 0.5],
    [1, 2.5],
    [3, 2],
    [NaN, NaN],
    [0, Infinity]
  ]) {
    assert.equal(rangeAt(projected, start, end), undefined);
  }
});

test('valid points and textless resources retain their existing reveal behavior', () => {
  const boundaries = [];
  const document = {
    createRange: () => ({
      setStart: (_node, offset) => boundaries.push(['start', offset]),
      setEnd: (_node, offset) => boundaries.push(['end', offset]),
      selectNodeContents: (node) => boundaries.push(['contents', node])
    })
  };
  const projected = source();
  const node = { data: projected.text, ownerDocument: document };
  projected.runs = [{ node, start: 0, end: 6 }];
  assert.ok(rangeAt(projected, 1));
  assert.deepEqual(boundaries.splice(0), [
    ['start', 1],
    ['end', 3]
  ]);
  assert.ok(rangeAt(projected, 6));
  assert.deepEqual(boundaries.splice(0), [
    ['start', 6],
    ['end', 7]
  ]);
  const imagePage = { text: '', runs: [], element: { ownerDocument: document } };
  assert.ok(rangeAt(imagePage, 0));
  assert.deepEqual(boundaries, [['contents', imagePage.element]]);
});
