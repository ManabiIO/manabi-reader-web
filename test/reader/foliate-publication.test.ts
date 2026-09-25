import assert from 'node:assert/strict';
import test from 'node:test';

import { foliateArchiveEntryIndex } from '../../apps/web/src/lib/foliate/web-epub-publication';

test('Foliate archive adapter exposes decoded href spellings without losing literal ZIP keys', () => {
  const entries = new Map<string, { uncompressedSize: number }>([
    ['META-INF/container.xml', { uncompressedSize: 1 }],
    ['OPS/chapter%201.xhtml', { uncompressedSize: 2 }]
  ]);
  const index = foliateArchiveEntryIndex(entries);
  assert.equal(index.get('OPS/chapter%201.xhtml'), 'OPS/chapter%201.xhtml');
  assert.equal(index.get('OPS/chapter 1.xhtml'), 'OPS/chapter%201.xhtml');
});

test('Foliate archive adapter rejects ambiguous decoded resource names', () => {
  const entries = new Map<string, { uncompressedSize: number }>([
    ['OPS/chapter%201.xhtml', { uncompressedSize: 1 }],
    ['OPS/chapter 1.xhtml', { uncompressedSize: 1 }]
  ]);
  assert.throws(() => foliateArchiveEntryIndex(entries), /Ambiguous EPUB resource path/);
});
