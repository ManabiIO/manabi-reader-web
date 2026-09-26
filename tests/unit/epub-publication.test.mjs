import assert from 'node:assert/strict';
import test from 'node:test';

import {
  makeEpubPublicationDescriptor,
  normalizeEpubNavigation
} from '../../apps/web/src/lib/functions/file-loaders/epub/epub-publication.ts';

test('EPUB publication descriptor preserves nested navigation and primitive rendition values', () => {
  const descriptor = makeEpubPublicationDescriptor({
    parser: 'foliate',
    toc: [
      {
        label: 'Part 1',
        href: 'OPS/ch1.xhtml',
        subitems: [{ label: 'Section', href: 'OPS/ch1.xhtml#s1' }]
      }
    ],
    pageList: [{ label: '1', href: 'OPS/ch1.xhtml#page1' }],
    landmarks: [{ label: 'Body', href: 'OPS/ch1.xhtml', type: ['bodymatter'] }],
    rendition: {
      layout: 'reflowable',
      spread: 'auto',
      orientation: 'auto',
      ignoredObject: { bad: true }
    }
  });

  assert.equal(descriptor.engine, 'foliate-epub-v1');
  assert.equal(descriptor.parser, 'foliate');
  assert.equal(descriptor.toc[0].subitems?.[0].href, 'OPS/ch1.xhtml#s1');
  assert.equal(descriptor.pageList[0].label, '1');
  assert.deepEqual(descriptor.landmarks[0].type, ['bodymatter']);
  assert.deepEqual(descriptor.rendition, {
    layout: 'reflowable',
    spread: 'auto',
    orientation: 'auto'
  });
});

test('EPUB navigation normalization bounds recursion and rejects unusable records', () => {
  const root = { label: 'root', subitems: [] };
  let cursor = root;
  for (let index = 0; index < 40; index += 1) {
    const child = { label: `level-${index}`, subitems: [] };
    cursor.subitems.push(child);
    cursor = child;
  }
  const normalized = normalizeEpubNavigation([null, {}, root]);
  assert.equal(normalized.length, 1);
  let depth = 0;
  let item = normalized[0];
  while (item.subitems?.length) {
    depth += 1;
    item = item.subitems[0];
  }
  assert.ok(depth <= 33);
});

test('EPUB navigation normalization bounds top-level item count', () => {
  const input = Array.from({ length: 20050 }, (_, index) => ({
    label: String(index),
    href: `chapter-${index}.xhtml`
  }));
  assert.equal(normalizeEpubNavigation(input).length, 20000);
});
