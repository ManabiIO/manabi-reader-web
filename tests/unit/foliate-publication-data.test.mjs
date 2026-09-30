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

test('non-linear spine hints survive persistence without entering locator identity', () => {
  const original = resources();
  original[1].linear = 'no';
  const packed = packEpubResources(original);
  assert.equal(packed.epubPublication.resources[1].linear, 'no');
  assert.equal('linear' in packed.epubPublication.resources[0], false);
  assert.deepEqual(epubResourceContents(packed.epubPublication, packed.elementHtml), original);
  assert.deepEqual(
    Object.keys(epubPublicationManifest(packed.epubPublication).resources[1]).sort(),
    ['href', 'sectionId', 'spineIndex']
  );
});

test('restored publication rejects unknown linearity and content rewrites cannot change it', () => {
  const original = resources();
  original[1].linear = 'no';
  const packed = packEpubResources(original);
  const invalid = globalThis.structuredClone(packed.epubPublication);
  invalid.resources[1].linear = 'maybe';
  assert.throws(() => readEpubPublication(invalid, packed.elementHtml), /identity|range/);
  assert.throws(
    () =>
      rewriteEpubPublication(packed.epubPublication, packed.elementHtml, (resource) => ({
        ...resource,
        linear: resource.linear === 'no' ? undefined : resource.linear
      })),
    /spine semantics/
  );
});

test('navigation hierarchy, page list, landmarks and rendition survive resource rewrites', () => {
  const packed = packEpubResources(resources(), {
    navigation: {
      toc: [
        {
          label: 'Part',
          subitems: [
            { label: 'Chapter', href: 'EPUB/chapter.xhtml#start' },
            { label: 'Notes', href: 'EPUB/notes.xhtml' }
          ]
        }
      ],
      pageList: [{ label: '12', href: 'EPUB/chapter.xhtml#page-12' }],
      landmarks: [
        {
          label: 'Body',
          href: 'EPUB/chapter.xhtml',
          type: ['bodymatter']
        }
      ]
    },
    rendition: {
      layout: 'reflowable',
      flow: 'paginated',
      spread: 'auto',
      orientation: 'auto',
      ignored: 'not persisted'
    }
  });
  assert.deepEqual(packed.epubPublication.navigation, {
    toc: [
      {
        label: 'Part',
        subitems: [
          { label: 'Chapter', href: 'EPUB/chapter.xhtml#start' },
          { label: 'Notes', href: 'EPUB/notes.xhtml' }
        ]
      }
    ],
    pageList: [{ label: '12', href: 'EPUB/chapter.xhtml#page-12' }],
    landmarks: [
      {
        label: 'Body',
        href: 'EPUB/chapter.xhtml',
        type: ['bodymatter']
      }
    ]
  });
  assert.deepEqual(packed.epubPublication.rendition, {
    layout: 'reflowable',
    flow: 'paginated',
    spread: 'auto',
    orientation: 'auto'
  });

  const rewritten = rewriteEpubPublication(
    packed.epubPublication,
    packed.elementHtml,
    (resource) => ({ ...resource, html: resource.html.replace('漢字𠮷', '本文') })
  );
  assert.deepEqual(rewritten.epubPublication.navigation, packed.epubPublication.navigation);
  assert.deepEqual(rewritten.epubPublication.rendition, packed.epubPublication.rendition);
});

test('restored navigation is bounded by depth, entry count and string sizes', () => {
  const packed = packEpubResources(resources());
  const deep = globalThis.structuredClone(packed.epubPublication);
  let items = [{ label: 'root' }];
  deep.navigation = { toc: items };
  for (let depth = 0; depth < 66; depth++) {
    items[0].subitems = [{ label: String(depth) }];
    items = items[0].subitems;
  }
  assert.throws(() => readEpubPublication(deep, packed.elementHtml), /navigation/i);

  const many = globalThis.structuredClone(packed.epubPublication);
  many.navigation = {
    toc: Array.from({ length: 20001 }, (_, index) => ({ label: String(index) }))
  };
  assert.throws(() => readEpubPublication(many, packed.elementHtml), /navigation|size/i);

  const long = globalThis.structuredClone(packed.epubPublication);
  long.navigation = { toc: [{ href: 'x'.repeat(4097) }] };
  assert.throws(() => readEpubPublication(long, packed.elementHtml), /navigation/i);

  const aggregate = globalThis.structuredClone(packed.epubPublication);
  aggregate.navigation = {
    toc: Array.from({ length: 1025 }, () => ({ label: '文'.repeat(4096) }))
  };
  assert.throws(() => readEpubPublication(aggregate, packed.elementHtml), /navigation|size/i);
});

test('restored rendition retains only bounded supported scalar hints', () => {
  const packed = packEpubResources(resources());
  const value = globalThis.structuredClone(packed.epubPublication);
  value.rendition = {
    layout: 'reflowable',
    spread: 'auto',
    unknown: 'discard me'
  };
  assert.deepEqual(readEpubPublication(value, packed.elementHtml).rendition, {
    layout: 'reflowable',
    spread: 'auto'
  });

  value.rendition = { layout: 'x'.repeat(129) };
  assert.throws(() => readEpubPublication(value, packed.elementHtml), /navigation text|rendition/i);
});


test('persisted fixed-layout rendition cannot bypass the reflow-only import gate', () => {
  const packed = packEpubResources(resources(), {
    rendition: { layout: 'reflowable' }
  });
  const restored = globalThis.structuredClone(packed.epubPublication);
  restored.rendition.layout = 'pre-paginated';
  assert.throws(
    () => readEpubPublication(restored, packed.elementHtml),
    /Fixed-layout EPUBs are not supported/i
  );
});
