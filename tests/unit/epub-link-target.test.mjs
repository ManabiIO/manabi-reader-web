/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveEpubLinkTarget,
  resolveEpubNavigationHref
} from '../../apps/web/src/lib/functions/file-loaders/epub/epub-link-target.ts';

test('EPUB links preserve resource identity when fragment IDs repeat', () => {
  const resources = [
    { href: 'OPS/a/chapter.xhtml', spineIndex: 0, sectionId: 'a' },
    { href: 'OPS/b/chapter.xhtml', spineIndex: 1, sectionId: 'b' },
    { href: 'OPS/notes.xhtml', spineIndex: 2, sectionId: 'notes' }
  ];
  assert.deepEqual(
    resolveEpubLinkTarget('OPS/a/chapter.xhtml', '../b/chapter.xhtml#note', resources, 0),
    { spineIndex: 1, fragment: 'note' }
  );
  assert.deepEqual(resolveEpubLinkTarget('OPS/a/chapter.xhtml', '#note', resources, 0), {
    spineIndex: 0,
    fragment: 'note'
  });
});

test('same-resource links stay on the current repeated spine occurrence', () => {
  const resources = [
    { href: 'OPS/chapter.xhtml', spineIndex: 0, sectionId: 'first' },
    { href: 'OPS/chapter.xhtml', spineIndex: 4, sectionId: 'repeat' }
  ];
  assert.deepEqual(resolveEpubLinkTarget('OPS/chapter.xhtml', '#note', resources, 4), {
    spineIndex: 4,
    fragment: 'note'
  });
});

test('EPUB links reject traversal outside the archive', () => {
  const resources = [{ href: 'OPS/chapter.xhtml', spineIndex: 0, sectionId: 'chapter' }];
  assert.equal(
    resolveEpubLinkTarget('OPS/chapter.xhtml', '../../escape.xhtml#x', resources, 0),
    undefined
  );
});

test('navigation URIs encode literal resource punctuation before splitting fragments', () => {
  const owner = 'OPS/nav.xhtml';
  assert.equal(
    resolveEpubNavigationHref(owner, 'part%231%3F.xhtml?ignored=yes#%E6%B3%A8'),
    'OPS/part%231%3F.xhtml#%E6%B3%A8'
  );
  assert.equal(resolveEpubNavigationHref(owner, 'part%2523.xhtml#note'), 'OPS/part%2523.xhtml#note');
  assert.equal(resolveEpubNavigationHref('OPS/part#1.xhtml', '#note'), 'OPS/part%231.xhtml#note');
  const resources = [{ href: 'OPS/part#1?.xhtml', spineIndex: 0, sectionId: 'part' }];
  assert.deepEqual(
    resolveEpubLinkTarget(owner, 'part%231%3F.xhtml#%E6%B3%A8', resources),
    { spineIndex: 0, fragment: '注' }
  );
});

test('navigation normalization never converts external URLs to archive paths', () => {
  assert.equal(
    resolveEpubNavigationHref('OPS/nav.xhtml', 'https://example.test/book#note'),
    'https://example.test/book#note'
  );
  assert.throws(() => resolveEpubNavigationHref('OPS/nav.xhtml', '../../escape.xhtml'));
});
