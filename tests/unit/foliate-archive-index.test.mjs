/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { foliateArchiveEntryIndex } from '../../apps/web/src/lib/foliate-epub/open-foliate-epub.ts';

test('Foliate archive aliases resolve decoded EPUB resource names', () => {
  const index = foliateArchiveEntryIndex(
    new Map([
      ['OPS/%E7%B5%B5.png', {}],
      ['OPS/chapter.xhtml', {}]
    ])
  );
  assert.equal(index.get('OPS/%E7%B5%B5.png'), 'OPS/%E7%B5%B5.png');
  assert.equal(index.get('OPS/絵.png'), 'OPS/%E7%B5%B5.png');
});

test('Foliate archive aliases reject ambiguous decoded resource names', () => {
  assert.throws(
    () =>
      foliateArchiveEntryIndex(
        new Map([
          ['OPS/%E7%B5%B5.png', {}],
          ['OPS/絵.png', {}]
        ])
      ),
    /Ambiguous EPUB resource path/
  );
});
