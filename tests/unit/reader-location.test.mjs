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
  projectResource,
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

function projectedText(value) {
  return { nodeType: 3, data: value, textContent: value, childNodes: [] };
}

function projectedElement(localName, childNodes = [], attributes = {}) {
  return {
    nodeType: 1,
    localName,
    tagName: localName,
    childNodes,
    hasAttribute(name) {
      return Object.hasOwn(attributes, name);
    },
    getAttribute(name) {
      return attributes[name] ?? null;
    }
  };
}

test('canonical projection is stable for framed/XHTML-style lowercase DOM nodes', () => {
  // Deliberately use structural nodes rather than this realm's Element
  // constructor. Foliate renders EPUB resources in child documents, and XHTML
  // parsers expose lowercase local names.
  const root = projectedElement('body', [
    projectedElement('p', [
      projectedElement('ruby', [
        projectedText('漢'),
        projectedElement('rt', [projectedText('かん')])
      ]),
      projectedText('字')
    ]),
    projectedElement('p', [projectedText('次')])
  ]);

  const projected = projectResource(root, resource);
  assert.equal(projected.text, '漢字\n次');
  assert.equal(projected.runs.length, 3);
});

test('canonical projection still excludes hidden content without realm-specific Elements', () => {
  const root = projectedElement('body', [
    projectedElement('p', [projectedText('visible')]),
    projectedElement('span', [projectedText('hidden')], { 'aria-hidden': 'true' }),
    projectedElement('div', [projectedText('also hidden')], { style: 'display:none!important' })
  ]);

  assert.equal(projectResource(root, resource).text, 'visible');
});

test('collapsed locators recover only from unique surrounding context', async () => {
  const projected = { resource, text: '甲乙丙丁' };
  const locator = {
    version: 1,
    bookKey,
    resource,
    projectionVersion: 2,
    resourceDigest: 'stale',
    start: 0,
    end: 0,
    quote: '',
    prefix: '甲乙',
    suffix: '丙丁'
  };
  assert.deepEqual(await resolveLocator(locator, projected, bookKey), { start: 2, end: 2 });

  assert.equal(
    await resolveLocator(
      { ...locator, prefix: '甲', suffix: '乙' },
      { resource, text: '甲乙丙甲乙丙' },
      bookKey
    ),
    undefined
  );
});
