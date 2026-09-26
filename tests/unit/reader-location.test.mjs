/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  codePointLength,
  makeLocator,
  resolveLocator,
  utf16OffsetAtCodePoint
} from '../../apps/web/src/lib/reader-location.ts';

const resource = { href: 'chapter.xhtml', spineIndex: 2, sectionId: 'chapter-2' };
const bookKey = `content:${'a'.repeat(64)}`;

test('locators count Unicode code points while the DOM uses UTF-16', async () => {
  const text = 'あ𠮷か\u3099虹';
  assert.equal(codePointLength(text), 5);
  assert.equal(utf16OffsetAtCodePoint(text, 2), 3);
  const locator = await makeLocator(bookKey, { resource, text }, 1, 4);
  assert.equal(locator.quote, '𠮷か\u3099');
  assert.deepEqual(await resolveLocator(locator, { resource, text }, bookKey), {
    start: 1,
    end: 4
  });
});

test('changed resource recovers only a unique quote with its witness', async () => {
  const text = `${'a'.repeat(48)} / distinct target / final passage`;
  const start = codePointLength(text.slice(0, text.indexOf('distinct')));
  const locator = await makeLocator(bookKey, { resource, text }, start, start + 8);
  const changed = { resource, text: `preface ${text}` };
  assert.deepEqual(await resolveLocator(locator, changed, bookKey), {
    start: start + 8,
    end: start + 16
  });
  assert.equal(
    await resolveLocator(locator, { resource, text: `${text} ${text}` }, bookKey),
    undefined
  );
  assert.equal(await resolveLocator(locator, changed, `content:${'b'.repeat(64)}`), undefined);
  assert.equal(
    await resolveLocator(locator, { resource: { ...resource, spineIndex: 3 }, text }, bookKey),
    undefined
  );
});

test('an older zero-length point remains resolvable when projected text is unchanged', async () => {
  const projected = { resource, text: 'Opening 𠮷 paragraph' };
  const locator = await makeLocator(bookKey, projected, 9);
  assert.equal(locator.quote, '');
  assert.deepEqual(await resolveLocator({ ...locator, projectionVersion: 1 }, projected, bookKey), {
    start: 9,
    end: 9
  });
});
