/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  packEpubResources,
  readEpubPublication,
  epubResourceContents,
  epubPublicationManifest,
  assertEpubManifest,
  rewriteEpubPublication
} from '../../apps/web/src/lib/foliate-epub/publication-data.ts';

const resources = () =>
  [0, 1, 2].map((spineIndex) => ({
    href: spineIndex === 1 ? 'EPUB/notes.xhtml' : 'EPUB/chapter.xhtml',
    spineIndex,
    sectionId: `ttu-epub-${spineIndex}`,
    html: `<div id="ttu-epub-${spineIndex}">漢字𠮷 ${spineIndex}</div>`,
    styleSheet: spineIndex === 1 ? 'p{color:blue}' : 'p{color:red}'
  }));

test('packed EPUB resources share the existing text buffer and deduplicate styles', () => {
  const original = resources();
  const { epubPublication, elementHtml } = packEpubResources(original);
  assert.equal(elementHtml, original.map((resource) => resource.html).join(''));
  assert.deepEqual(epubPublication.styleSheets, ['p{color:red}', 'p{color:blue}']);
  assert.ok(epubPublication.resources.every((resource) => !('html' in resource)));
  assert.deepEqual(epubResourceContents(epubPublication, elementHtml), original);
});

test('a repeated resource keeps each distinct spine occurrence and clean locator identity', () => {
  const { epubPublication } = packEpubResources(resources());
  const manifest = epubPublicationManifest(epubPublication);
  assert.equal(manifest.resources[0].href, manifest.resources[2].href);
  assert.notEqual(manifest.resources[0].spineIndex, manifest.resources[2].spineIndex);
  assert.deepEqual(Object.keys(manifest.resources[0]).sort(), ['href', 'sectionId', 'spineIndex']);
  assertEpubManifest(epubPublication, manifest);
  manifest.resources[2].href = 'different.xhtml';
  assert.throws(() => assertEpubManifest(epubPublication, manifest), /manifest/);
});

test('rewriting serialized chapters rebuilds every subsequent boundary without moving identities', () => {
  const original = resources();
  const before = packEpubResources(original);
  const after = rewriteEpubPublication(before.epubPublication, before.elementHtml, (resource) => ({
    ...resource,
    html: resource.html.replace('漢字𠮷', '漢字'),
    styleSheet: ''
  }));
  assert.deepEqual(
    epubResourceContents(after.epubPublication, after.elementHtml),
    original.map((resource) => ({
      ...resource,
      html: resource.html.replace('漢字𠮷', '漢字'),
      styleSheet: ''
    }))
  );
  assert.deepEqual(
    epubPublicationManifest(after.epubPublication),
    epubPublicationManifest(before.epubPublication)
  );
  assert.deepEqual(after.epubPublication.styleSheets, ['']);
  assert.throws(
    () => readEpubPublication(before.epubPublication, after.elementHtml),
    /range|source/
  );
});

test('content transforms cannot silently reassign a publication location', () => {
  const before = packEpubResources(resources());
  assert.throws(
    () =>
      rewriteEpubPublication(before.epubPublication, before.elementHtml, (resource) => ({
        ...resource,
        spineIndex: 0
      })),
    /identity/
  );
});

test('restored ranges reject gaps, overlap, fractional coordinates and missing stylesheet entries', () => {
  const before = packEpubResources(resources());
  for (const edit of [
    (value) => {
      value.resources[1].start++;
    },
    (value) => {
      value.resources[1].start--;
    },
    (value) => {
      value.resources[0].end = 1.5;
    },
    (value) => {
      value.resources[2].end--;
    },
    (value) => {
      value.resources[0].style = 4;
    },
    (value) => {
      value.resources[1].sectionId = value.resources[0].sectionId;
    },
    (value) => {
      value.resources[0].spineIndex = 2;
    }
  ]) {
    const value = globalThis.structuredClone(before.epubPublication);
    edit(value);
    assert.throws(() => readEpubPublication(value, before.elementHtml));
  }
});

test('resolved publication resources reject unsafe URL and path aliases', () => {
  const before = packEpubResources(resources());
  for (const href of [
    'https://example.test/a',
    '/absolute',
    '../escape',
    'a/../b',
    'a//b',
    'a\\b',
    'a\0b'
  ]) {
    const value = globalThis.structuredClone(before.epubPublication);
    value.resources[0].href = href;
    assert.throws(() => readEpubPublication(value, before.elementHtml), /identity/);
  }
});

test('untrusted publication metadata is copied by allowlist, not spread into application state', () => {
  const before = packEpubResources(resources());
  before.epubPublication.untrusted = true;
  before.epubPublication.resources[0].html = '<script>bad</script>';
  const read = readEpubPublication(before.epubPublication, before.elementHtml);
  assert.equal('untrusted' in read, false);
  assert.equal('html' in read.resources[0], false);
  before.epubPublication.styleSheets[0] = 'changed';
  assert.equal(read.styleSheets[0], 'p{color:red}');
});

test('publication packing rejects empty books and oversized stylesheet catalogs', () => {
  assert.throws(() => packEpubResources([]));
  const original = resources();
  original[0].styleSheet = ' '.repeat(4 * 1024 * 1024 + 1);
  assert.throws(() => packEpubResources(original), /size limit/);
});

test('resolved names retain literal reserved punctuation without a second URL decode', () => {
  const original = resources();
  original[0].href = 'EPUB/part#1?.xhtml';
  original[1].href = 'EPUB/part%23.xhtml';
  const packed = packEpubResources(original);
  assert.deepEqual(epubResourceContents(packed.epubPublication, packed.elementHtml), original);
});
