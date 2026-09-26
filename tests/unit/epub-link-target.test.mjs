/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEpubLinkTarget } from '../../apps/web/src/lib/functions/file-loaders/epub/epub-link-target.ts';

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
