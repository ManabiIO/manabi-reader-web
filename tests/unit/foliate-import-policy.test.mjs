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

test('pre-paginated EPUB packages and per-spine overrides fail closed', () => {
  for (const layout of ['pre-paginated', ' PRE-PAGINATED '])
    assert.throws(
      () => assertSupportedEpubRendition({ layout }),
      /Fixed-layout EPUBs are not supported/i
    );
  assert.throws(
    () =>
      assertSupportedEpubRendition({ layout: 'reflowable' }, [
        { properties: ['rendition:layout-pre-paginated'] }
      ]),
    /Fixed-layout EPUBs are not supported/i
  );
  for (const [value, spine] of [
    [undefined, []],
    [null, []],
    [{}, []],
    [{ layout: 'reflowable' }, []],
    [{ layout: '' }, [{ properties: ['rendition:layout-reflowable'] }]],
    [{ layout: 1 }, [{ properties: ['rendition:flow-paginated'] }]],
    [[], []]
  ])
    assert.doesNotThrow(() => assertSupportedEpubRendition(value, spine));
});
