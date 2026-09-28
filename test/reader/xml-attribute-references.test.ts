/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeXmlAttributeReferences as decode } from '../../apps/web/src/lib/functions/file-loaders/utils/xml-attribute-references';

for (const [input, expected] of [
  ['Books/A&amp;B.opf', 'Books/A&B.opf'],
  ['a&lt;b&gt;c&quot;d&apos;e', 'a<b>c"d\'e'],
  ['Text/&#26412;&#x8A9E;.xhtml', 'Text/本語.xhtml'],
  ['Text/&#x20000;.xhtml', 'Text/𠀀.xhtml'],
  ['&#9;&#10;&#13;', '\t\n\r'],
  ['&#00065;&#x000041;', 'AA'],
  ['a&amp;lt;b', 'a&lt;b'],
  ['a&#38;lt;b', 'a&lt;b'],
  ['&custom;&nbsp;&AMP;&#X41;&#xZZ;&amp', '&custom;&nbsp;&AMP;&#X41;&#xZZ;&amp'],
  ['Text/a%20b%23c.xhtml#part', 'Text/a%20b%23c.xhtml#part'],
  ['', '']
]) {
  test(`decodes XML attribute references once: ${JSON.stringify(input)}`, () => {
    assert.equal(decode(input), expected);
  });
}

for (const invalid of [
  '&#0;',
  '&#1;',
  '&#xD800;',
  '&#xDFFF;',
  '&#xFFFE;',
  '&#xFFFF;',
  '&#x110000;',
  `&#${'9'.repeat(400)};`
]) {
  test(`rejects XML-invalid numeric reference ${invalid.slice(0, 20)}`, () => {
    assert.throws(() => decode(invalid), /Invalid XML character reference/);
  });
}

test('many references remain a single non-recursive pass', () => {
  assert.equal(decode('&amp;lt;'.repeat(10000)), '&lt;'.repeat(10000));
});
