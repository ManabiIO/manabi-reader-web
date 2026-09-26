/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  epubRootSelector,
  scopedEpubSelector
} from '../../apps/web/src/lib/foliate-epub/epub-root-selectors.ts';

const html = 'div:where(.ttu-book-html-wrapper)';
const body = 'div:where(.ttu-book-body-wrapper)';
test('EPUB root selectors remain scoped to their synthetic document roots', () => {
  assert.equal(
    epubRootSelector('html > body p, :root .title'),
    `${html} > ${body} p, .ttu-book-html-wrapper .title`
  );
  assert.equal(epubRootSelector(':is(html, body) > p'), `:is(${html}, ${body}) > p`);
  assert.equal(epubRootSelector('BODY.vertical > ruby'), `${body}.vertical > ruby`);
});

test('root rewriting does not change classes, IDs, attribute strings or qualified elements', () => {
  for (const selector of [
    '.body #html p',
    '[title="html body"]',
    '[data-x=body]',
    'bodyguard p',
    'body-content p',
    'svg|body',
    '*|html',
    '[title="a, body"] p'
  ]) {
    assert.equal(epubRootSelector(selector), selector);
  }
});

test('compound root selectors retain their target without leaving :root on a div', () => {
  assert.equal(epubRootSelector('html:root.foo'), `${html}.ttu-book-html-wrapper.foo`);
  assert.equal(epubRootSelector('*:root'), '*.ttu-book-html-wrapper');
});

test('each selector is scoped separately; nested and quoted commas stay inside their selector', () => {
  assert.equal(scopedEpubSelector('p, #special', '#book'), '#book p,#book #special');
  assert.equal(
    scopedEpubSelector(':is(p, span), [title="one,two"] > body', '#book'),
    `#book :is(p, span),#book [title="one,two"] > ${body}`
  );
});
