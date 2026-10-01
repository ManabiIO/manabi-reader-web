/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  paginatedPageRtl,
  reversesPhysicalPageTurns
} from '../../apps/web/src/lib/foliate-epub/page-direction.ts';

test('explicit horizontal page progression outranks content bidi direction', () => {
  assert.equal(
    paginatedPageRtl({
      flow: 'paginated',
      vertical: false,
      bookDirection: 'rtl',
      contentRtl: false
    }),
    true
  );
  assert.equal(
    paginatedPageRtl({
      flow: 'paginated',
      vertical: false,
      bookDirection: 'ltr',
      contentRtl: true
    }),
    false
  );
});

test('missing horizontal progression uses authored content direction', () => {
  assert.equal(
    paginatedPageRtl({
      flow: 'paginated',
      vertical: false,
      contentRtl: true
    }),
    true
  );
  assert.equal(
    paginatedPageRtl({
      flow: 'paginated',
      vertical: false,
      bookDirection: 'default',
      contentRtl: false
    }),
    false
  );
});

test('vertical and scrolled flows retain content direction rather than forcing horizontal progression', () => {
  for (const input of [
    { flow: 'paginated', vertical: true, bookDirection: 'ltr', contentRtl: true },
    { flow: 'paginated', vertical: true, bookDirection: 'rtl', contentRtl: false },
    { flow: 'scrolled', vertical: false, bookDirection: 'rtl', contentRtl: false },
    { flow: 'scrolled', vertical: false, bookDirection: 'ltr', contentRtl: true }
  ])
    assert.equal(paginatedPageRtl(input), input.contentRtl);
});

test('legacy physical keys and swipes follow the same horizontal page direction contract', () => {
  assert.equal(reversesPhysicalPageTurns(false, 'rtl'), true);
  assert.equal(reversesPhysicalPageTurns(false, 'ltr'), false);
  assert.equal(reversesPhysicalPageTurns(false, 'unknown'), false);
  assert.equal(reversesPhysicalPageTurns(true, 'ltr'), true);
  assert.equal(reversesPhysicalPageTurns(true, 'unknown'), true);
});
