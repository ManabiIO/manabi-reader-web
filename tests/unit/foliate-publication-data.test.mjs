/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateEpubPublication,
  epubPublicationManifest,
  epubPublicationHtml
} from '../../apps/web/src/lib/foliate-epub/publication-data.ts';
import {
  encodeEpubPublication,
  decodeEpubPublication
} from '../../apps/web/src/lib/foliate-epub/publication-wire.ts';
import { localCssImports } from '../../apps/web/src/lib/foliate-epub/css-imports.ts';
import {
  repairEpubHtml,
  decodeEpubNumericEntity
} from '../../apps/web/src/lib/foliate-epub/import-fixes.ts';

const publication = () => ({
  version: 1,
  resources: [0, 1].map((index) => ({
    href: 'OPS/chapter.xhtml',
    spineIndex: index,
    sectionId: `ttu-epub-${index}`,
    html: `<div id="ttu-epub-${index}"><p>日本語𠮷</p></div>`,
    styleSheet: `.resource-${index}{color:red}`,
    characters: 4
  }))
});

test('repeated resource bytes keep distinct reading-order occurrences', () => {
  const data = publication();
  validateEpubPublication(data, epubPublicationManifest(data));
  assert.equal(epubPublicationManifest(data).resources.length, 2);
  assert.equal(epubPublicationHtml(data), data.resources.map((resource) => resource.html).join(''));
});

test('resource descriptors reject malformed identity, paths, counts and fields before rendering', () => {
  for (const field of [
    { spineIndex: 1 },
    { sectionId: 'unowned' },
    { href: '../a' },
    { href: 'https://a' },
    { href: 'a\\b' },
    { href: 'a\u0000b' },
    { html: '' },
    { characters: -1 },
    { characters: 1.5 },
    { html: {} },
    { styleSheet: null },
    { unexpected: true }
  ]) {
    const data = publication();
    Object.assign(data.resources[0], field);
    assert.throws(() => validateEpubPublication(data), /Invalid EPUB/);
  }
  const data = publication();
  data.resources[1].sectionId = data.resources[0].sectionId;
  assert.throws(() => validateEpubPublication(data), /Invalid EPUB/);
});

test('resource identity must agree with the separately persisted manifest', () => {
  const data = publication();
  const manifest = epubPublicationManifest(data);
  manifest.resources[1].href = 'other.xhtml';
  assert.throws(() => validateEpubPublication(data, manifest), /do not match/);
});

test('TTU backup retains one HTML/CSS copy and exactly round-trips resource identity', () => {
  const data = publication();
  const html = epubPublicationHtml(data),
    css = data.resources.map((r) => r.styleSheet).join('\n');
  const wire = JSON.parse(JSON.stringify(encodeEpubPublication(data, html, css)));
  assert.equal(wire.encoding, 'html-slices');
  assert.equal(wire.resources[0].html, undefined);
  assert.deepEqual(decodeEpubPublication(wire, html, css), data);
  assert.deepEqual(decodeEpubPublication(data, html, css), data);
  assert.throws(() => encodeEpubPublication(data, html + 'changed', css), /trailing/);
});

test('restored slices reject overlaps, gaps, out-of-bounds and extra fields', () => {
  const data = publication();
  const html = epubPublicationHtml(data),
    css = data.resources.map((r) => r.styleSheet).join('\n');
  for (const field of [
    { htmlStart: -1 },
    { htmlEnd: html.length + 1 },
    { cssStart: 1 },
    { htmlStart: 0.5 },
    { other: 1 }
  ]) {
    const wire = encodeEpubPublication(data, html, css);
    Object.assign(wire.resources[0], field);
    assert.throws(() => decodeEpubPublication(wire, html, css), /Invalid EPUB/);
  }
  const wire = encodeEpubPublication(data, html, css);
  wire.resources[1].htmlStart--;
  assert.throws(() => decodeEpubPublication(wire, html, css), /boundary/);
});

test('local CSS import discovery ignores nested/string content and print-only imports', () => {
  assert.deepEqual(
    localCssImports(
      `/* prefix */ @charset "utf-8"; @import "one.css"; @import url('../two.css') screen; @import "print.css" print; p{content:'@import "bad.css";'} @import "late.css";`
    ),
    ['one.css', '../two.css']
  );
  assert.deepEqual(localCssImports(`p{content:'@import "bad.css";'}`), []);
  assert.deepEqual(localCssImports('@import "unfinished'), []);
  assert.throws(() => localCssImports('@import "a.css";'.repeat(65)), /too many/);
});

test('explicit import repair preserves rare kanji and replaces invalid scalar references', () => {
  assert.equal(decodeEpubNumericEntity('20000', 16), '𠀀');
  assert.equal(decodeEpubNumericEntity('131072', 10), '𠀀');
  for (const value of ['0', 'D800', '110000', 'FFFFFFFF'])
    assert.equal(decodeEpubNumericEntity(value, 16), '\uFFFD');
  assert.equal(
    repairEpubHtml('<p>&#x20000;&#131072;</p>', { mode: 'extended', anchorsOnly: false }),
    '<p>𠀀𠀀</p>'
  );
  assert.equal(
    repairEpubHtml('<a id="x"/><p id="y"/>', { mode: 'basic', anchorsOnly: true }),
    '<a id="x"></a><p id="y"/>'
  );
  assert.equal(repairEpubHtml('<p id="y"/>', { mode: 'off', anchorsOnly: false }), '<p id="y"/>');
});
