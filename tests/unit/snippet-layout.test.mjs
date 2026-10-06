/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const sass = require('sass');
const postcss = require('postcss');
const directory = new URL('../../apps/web/src/snippets-react/', import.meta.url);
const source = new URL('snippets.scss', directory);
const css = readFileSync(new URL('snippets.css', directory), 'utf8');
const stylesheet = postcss.parse(css);

function declarations(selector, media) {
  const values = {};
  stylesheet.walkRules(selector, (rule) => {
    const condition = rule.parent.type === 'atrule' ? rule.parent.params : undefined;
    if (condition !== media) return;
    rule.walkDecls((declaration) => (values[declaration.prop] = declaration.value));
  });
  return values;
}

test('the active Snippets CSS is compiled from its scoped Sass source', () => {
  assert.equal(css, sass.compile(source.pathname).css);
});

test('the Snippets workspace fits an Expo flex screen without shrinking to intrinsic content', () => {
  const workspace = declarations('.snippet-workspace.snippet-scope-workspace');
  assert.equal(workspace.width, '100%');
  assert.equal(workspace['min-width'], '0');
  const brand = declarations('.brand.snippet-scope-workspace', '(max-width: 640px)');
  assert.notEqual(brand['white-space'], 'nowrap');
});

test('vertical snippet spacing does not add horizontal margins outside its bounded scrollport', () => {
  const reader = declarations('.snippet-reading.snippet-scope-reader');
  const vertical = declarations('.snippet-reading.vertical.snippet-scope-reader');
  const narrow = declarations('.snippet-reading.snippet-scope-reader', '(max-width: 640px)');
  assert.equal(reader.margin, '1.5rem auto');
  assert.equal(vertical['writing-mode'], 'vertical-rl');
  assert.equal(vertical['max-width'], '100%');
  assert.equal(vertical.overflow, 'auto');
  assert.equal(vertical['margin-inline'], undefined);
  assert.equal(narrow['margin-block'], undefined);
  assert.equal(narrow['margin-top'], '20px');
  assert.equal(narrow['margin-bottom'], '20px');
});

test('annotation fields can shrink and wrap inside the enlarged-text toolbar', () => {
  const label = declarations('label.snippet-scope-editor');
  assert.equal(label['grid-template-columns'], 'minmax(0, 1fr)');
  assert.equal(label['min-width'], '0');
  assert.equal(label['max-width'], '100%');
  assert.equal(label['overflow-wrap'], 'anywhere');
});
