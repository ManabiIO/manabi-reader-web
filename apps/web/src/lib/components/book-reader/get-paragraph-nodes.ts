/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { isNodeGaiji } from '$lib/functions/is-node-gaiji';

const TEXT_NODE = 3;

export function getParagraphNodes(node: Node) {
  return getTextNodeOrGaijiNodes(node, (n) => {
    const localName = (n as Element).localName?.toLowerCase?.();
    if (localName === 'rt') {
      return false;
    }
    const element = n.nodeType === 1 ? (n as Element) : undefined;
    const isHidden = !!element && (element.hasAttribute('aria-hidden') || element.hasAttribute('hidden'));
    if (isHidden) {
      return false;
    }
    return true;
  }).filter((n) => {
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
      if (n.nodeType === TEXT_NODE) {
        return [n];
      }
      if (isNodeGaiji(n)) {
        return [n];
      }
      return getTextNodeOrGaijiNodes(n, filterFn);
    })
    .filter(filterFn);
}
