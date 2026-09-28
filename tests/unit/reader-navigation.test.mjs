/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ReaderNavigation } from '../../apps/web/src/lib/reader-navigation.ts';

const bookKey = `content:${'a'.repeat(64)}`;
const point = (start, href = 'chapter.xhtml') => ({
  version: 1,
  bookKey,
  resource: { href, spineIndex: 0, sectionId: 'ttu-epub-0' },
  projectionVersion: 2,
  resourceDigest: 'b'.repeat(64),
  start,
  end: start,
  quote: '',
  prefix: '前',
  suffix: '後'
});

test('preview history owns locator values instead of caller objects', () => {
  const navigation = new ReaderNavigation();
  const origin = point(1);
  const target = point(9);
  navigation.preview(origin, target);
  origin.start = 100;
  origin.resource.href = 'mutated.xhtml';
  target.start = 200;
  target.resource.spineIndex = 8;

  assert.equal(navigation.returnPoint.start, 1);
  assert.equal(navigation.returnPoint.resource.href, 'chapter.xhtml');
  assert.equal(navigation.visiblePoint.start, 9);
  assert.equal(navigation.visiblePoint.resource.spineIndex, 0);

  const exposed = navigation.visiblePoint;
  exposed.start = 777;
  exposed.resource.href = 'again.xhtml';
  assert.equal(navigation.visiblePoint.start, 9);
  assert.equal(navigation.visiblePoint.resource.href, 'chapter.xhtml');
});

test('a newer preview request supersedes older post-await route work', () => {
  const navigation = new ReaderNavigation();
  const first = navigation.beginRequest();
  assert.equal(first.isCurrent(), true);
  const second = navigation.beginRequest();
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
});

test('return, continue and clear invalidate pending preview requests', () => {
  for (const finish of ['return', 'continue', 'clear']) {
    const navigation = new ReaderNavigation();
    navigation.preview(point(1), point(9));
    const request = navigation.beginRequest();
    if (finish === 'return') navigation.returnToOrigin();
    else if (finish === 'continue') navigation.continueHere();
    else navigation.clear();
    assert.equal(request.isCurrent(), false, finish);
  }
});

test('preview rejects unsupported future locator projections before storing them', () => {
  const navigation = new ReaderNavigation();
  assert.throws(
    () => navigation.preview(point(1), { ...point(9), projectionVersion: 999 }),
    /invalid reader location/i
  );
  assert.equal(navigation.previewing, false);
});
