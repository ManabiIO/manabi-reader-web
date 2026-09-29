/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSupportedEpubRendition,
  normalizeEpubSpineLinear
} from '../../apps/web/src/lib/foliate-epub/epub-import-policy.ts';

test('EPUB spine linearity defaults to sequential and preserves explicit auxiliary items', () => {
  assert.equal(normalizeEpubSpineLinear('no'), 'no');
  for (const value of ['yes', undefined, null, '', 'NO', false, 0])
    assert.equal(normalizeEpubSpineLinear(value), 'yes');
});

test('pre-paginated EPUB packages fail closed instead of entering the reflow engine', () => {
  for (const layout of ['pre-paginated', ' PRE-PAGINATED '])
    assert.throws(
      () => assertSupportedEpubRendition({ layout }),
      /Fixed-layout EPUBs are not supported/i
    );
  for (const value of [
    undefined,
    null,
    {},
    { layout: 'reflowable' },
    { layout: '' },
    { layout: 1 },
    []
  ])
    assert.doesNotThrow(() => assertSupportedEpubRendition(value));
});
