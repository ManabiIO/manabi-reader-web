import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveEpubTarget } from '../../apps/web/src/lib/functions/file-loaders/epub/epub-navigation.ts';

const manifest = {
  version: 1,
  resources: [
    { href: 'OPS/ch1.xhtml', spineIndex: 0, sectionId: 's0' },
    { href: 'OPS/notes.xhtml', spineIndex: 1, sectionId: 's1' },
    { href: 'OPS/repeated.xhtml', spineIndex: 2, sectionId: 's2' },
    { href: 'OPS/repeated.xhtml', spineIndex: 3, sectionId: 's3' }
  ]
};

test('same-resource fragment keeps the current spine occurrence', () => {
  const target = resolveEpubTarget(manifest, {
    sourceSpineIndex: 3,
    href: '#local'
  });
  assert.equal(target?.resource.spineIndex, 3);
  assert.equal(target?.fragment, 'local');
});

test('cross-resource EPUB href resolves relative to the source resource', () => {
  const target = resolveEpubTarget(manifest, {
    sourceSpineIndex: 0,
    href: 'notes.xhtml#n1'
  });
  assert.equal(target?.resource.spineIndex, 1);
  assert.equal(target?.resource.href, 'OPS/notes.xhtml');
  assert.equal(target?.fragment, 'n1');
});

test('repeated spine resources resolve to the closest occurrence', () => {
  assert.equal(
    resolveEpubTarget(manifest, { sourceSpineIndex: 1, href: 'repeated.xhtml#x' })?.resource
      .spineIndex,
    2
  );
});

test('unresolvable, rooted and external targets are rejected', () => {
  assert.equal(
    resolveEpubTarget(manifest, { sourceSpineIndex: 0, href: 'missing.xhtml#x' }),
    undefined
  );
  assert.equal(
    resolveEpubTarget(manifest, { sourceSpineIndex: 0, href: '/OPS/notes.xhtml#x' }),
    undefined
  );
  assert.equal(
    resolveEpubTarget(manifest, { sourceSpineIndex: 0, href: 'https://example.com/#x' }),
    undefined
  );
});
