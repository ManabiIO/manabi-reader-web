/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { isNodeGaiji } from '$lib/functions/is-node-gaiji';
import { READER_TEXT_NODE, readerTraversalNodeIsVisible } from '$lib/reader-dom-core';

export function getParagraphNodes(node: Node) {
  return getTextNodeOrGaijiNodes(node, readerTraversalNodeIsVisible).filter((n) => {
    if (isNodeGaiji(n)) {
      return true;
    }
    if (n.textContent?.replace(/\s/g, '').length) {
      return true;
    }
    return false;
  });
}

function getTextNodeOrGaijiNodes(node: Node, filterFn: (n: Node) => boolean): Node[] {
  if (!node.hasChildNodes() || !filterFn(node)) {
    return [];
  }

  return Array.from(node.childNodes)
    .flatMap((n) => {
      if (n.nodeType === READER_TEXT_NODE) {
        return [n];
      }
      if (isNodeGaiji(n)) {
        return [n];
      }
      return getTextNodeOrGaijiNodes(n, filterFn);
    })
    .filter(filterFn);
}
