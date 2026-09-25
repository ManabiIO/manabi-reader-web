/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { getParagraphNodes } from '../../apps/web/src/lib/components/book-reader/get-paragraph-nodes.ts';

function text(value) {
  return {
    nodeType: 3,
    nodeName: '#text',
    textContent: value,
    childNodes: [],
    hasChildNodes: () => false
  };
}

function element(localName, children = [], attributes = []) {
  const names = new Set(attributes);
  return {
    nodeType: 1,
    nodeName: localName,
    localName,
    textContent: children.map((child) => child.textContent ?? '').join(''),
    childNodes: children,
    classList: [],
    hasAttribute(name) {
      return names.has(name);
    },
    hasChildNodes() {
      return this.childNodes.length > 0;
    }
  };
}

test('paragraph enumeration is stable for XHTML and foreign DOM realms', () => {
  const visible = text('漢字');
  const reading = text('かんじ');
  const hidden = text('secret');
  const root = element('body', [
    element('p', [element('ruby', [visible, element('rt', [reading])])]),
    element('span', [hidden], ['aria-hidden'])
  ]);

  assert.deepEqual(getParagraphNodes(root), [visible]);
});
