/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveEpubLinkTarget } from '../../apps/web/src/lib/functions/file-loaders/epub/epub-link-target';

const resources = [
  { href: 'OPS/a/chapter.xhtml', spineIndex: 0, sectionId: 'a' },
  { href: 'OPS/b/chapter.xhtml', spineIndex: 1, sectionId: 'b' },
  { href: 'OPS/notes.xhtml', spineIndex: 2, sectionId: 'notes' }
];

test('resource-aware EPUB links distinguish duplicate fragment IDs in different spine resources', () => {
  assert.deepEqual(
    resolveEpubLinkTarget('OPS/a/chapter.xhtml', '../b/chapter.xhtml#note', resources),
    { spineIndex: 1, fragment: 'note' }
  );
  assert.deepEqual(resolveEpubLinkTarget('OPS/a/chapter.xhtml', '#note', resources), {
    spineIndex: 0,
    fragment: 'note'
  });
});

test('resource-aware EPUB links ignore query strings for archive identity and decode fragments', () => {
  assert.deepEqual(
    resolveEpubLinkTarget('OPS/a/chapter.xhtml', '../notes.xhtml?view=1#注%201', resources),
    { spineIndex: 2, fragment: '注 1' }
  );
});

test('resource-aware EPUB links refuse traversal outside the archive', () => {
  assert.equal(
    resolveEpubLinkTarget('OPS/a/chapter.xhtml', '../../../escape.xhtml#x', resources),
    undefined
  );
});


test('same-resource EPUB links stay on the current repeated spine occurrence', () => {
  const repeated = [
    { href: 'OPS/chapter.xhtml', spineIndex: 0, sectionId: 'first' },
    { href: 'OPS/chapter.xhtml', spineIndex: 4, sectionId: 'repeat' }
  ];
  assert.deepEqual(resolveEpubLinkTarget('OPS/chapter.xhtml', '#note', repeated, 4), {
    spineIndex: 4,
    fragment: 'note'
  });
});

test('cross-resource EPUB links choose the nearest repeated target occurrence', () => {
  const repeated = [
    { href: 'OPS/a.xhtml', spineIndex: 0, sectionId: 'a' },
    { href: 'OPS/notes.xhtml', spineIndex: 1, sectionId: 'notes-early' },
    { href: 'OPS/chapter.xhtml', spineIndex: 2, sectionId: 'chapter' },
    { href: 'OPS/notes.xhtml', spineIndex: 3, sectionId: 'notes-late' }
  ];
  assert.deepEqual(resolveEpubLinkTarget('OPS/chapter.xhtml', 'notes.xhtml#note', repeated, 2), {
    spineIndex: 1,
    fragment: 'note'
  });
});
