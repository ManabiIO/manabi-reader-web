/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { repairEpubHtml } from '../../apps/web/src/lib/foliate-epub/html-repair.ts';

for (const source of [
  '<p>&#60;em&#62;literal&#60;/em&#62;</p>',
  '<p>&#x3c;script&#x3e;literal&#x3c;/script&#x3e;</p>',
  '<p title="before&#34; hidden=&#34;after">visible</p>',
  "<p title='before&#39; hidden=&#39;after'>visible</p>",
  '<p>&#38;#60; &#x26;#60; &#x26;lt;</p>',
  '<p>&#128; &#x80; &#13; &#10; &#x20000;</p>'
]) {
  test(`Extended repair preserves numeric references for the HTML parser: ${source}`, () => {
    assert.equal(repairEpubHtml(source, 'Extended', false), source);
  });
}

test('invalid references are repaired without promoting adjacent escaped markup', () => {
  assert.equal(
    repairEpubHtml('<p>&#0;&#xD800;&#1114112;&#x110000;&#38;#60;</p>', 'Extended', false),
    '<p>\uFFFD\uFFFD\uFFFD\uFFFD&#38;#60;</p>'
  );
});

test('Off and Standard retain their established numeric-reference policy', () => {
  const source = '<p>&#0;&#x20000;&#60;literal&#62;</p>';
  assert.equal(repairEpubHtml(source, 'Off', false), source);
  assert.equal(repairEpubHtml(source, 'Standard', false), source);
});
