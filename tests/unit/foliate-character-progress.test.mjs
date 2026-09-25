/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exploredCountAtParagraph,
  sectionIndexForCharacterCount
} from '../../apps/web/src/lib/foliate-epub/foliate-character-progress-core.ts';

test('Foliate progress preserves global TTU section boundaries', () => {
  const ends = [100, 240, 300];
  assert.equal(sectionIndexForCharacterCount(ends, 0), 0);
  assert.equal(sectionIndexForCharacterCount(ends, 99), 0);
  assert.equal(sectionIndexForCharacterCount(ends, 100), 1);
  assert.equal(sectionIndexForCharacterCount(ends, 239), 1);
  assert.equal(sectionIndexForCharacterCount(ends, 999), 2);
});

test('Foliate visible paragraphs map back to the old explored-character contract', () => {
  assert.equal(exploredCountAtParagraph(100, [25, 60, 90], 0), 100);
  assert.equal(exploredCountAtParagraph(100, [25, 60, 90], 1), 125);
  assert.equal(exploredCountAtParagraph(100, [25, 60, 90], 2), 160);
});
