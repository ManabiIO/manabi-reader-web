/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readerNodeLocalName,
  readerTraversalNodeIsVisible
} from '../../apps/web/src/lib/reader-dom-core.ts';

function element(localName, attributes = []) {
  const names = new Set(attributes);
  return {
    nodeType: 1,
    localName,
    hasAttribute(name) {
      return names.has(name);
    }
  };
}

test('Reader DOM predicates handle XHTML-style names without realm constructors', () => {
  assert.equal(readerNodeLocalName(element('RT')), 'rt');
  assert.equal(readerTraversalNodeIsVisible(element('rt')), false);
  assert.equal(readerTraversalNodeIsVisible(element('span', ['aria-hidden'])), false);
  assert.equal(readerTraversalNodeIsVisible(element('span', ['hidden'])), false);
  assert.equal(readerTraversalNodeIsVisible(element('span')), true);
  assert.equal(readerTraversalNodeIsVisible({ nodeType: 3 }), true);
});
