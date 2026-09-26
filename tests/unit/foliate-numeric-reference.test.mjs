/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { epubNumericReference } from '../../apps/web/src/lib/foliate-epub/numeric-reference.ts';

test('numeric-reference repair retains supplementary Unicode scalars', () => {
  assert.equal(epubNumericReference('20000', 16), '𠀀');
  assert.equal(epubNumericReference('131072', 10), '𠀀');
  assert.equal(epubNumericReference('10ffff', 16), String.fromCodePoint(0x10ffff));
  assert.equal(epubNumericReference('10', 10), '\n');
});

test('invalid numeric references do not abort an entire Extended EPUB import', () => {
  for (const value of ['0', 'd800', 'dfff', '110000', 'f'.repeat(400)])
    assert.equal(epubNumericReference(value, 16), '\uFFFD', value);
  for (const value of ['0', '55296', '57343', '1114112', '9'.repeat(400)])
    assert.equal(epubNumericReference(value, 10), '\uFFFD', value);
});
