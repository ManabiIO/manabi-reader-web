/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { isElementGaiji } from './is-element-gaiji.ts';

export function isNodeGaiji(node: Node) {
  if (node.nodeType !== 1 || (node as Element).localName?.toLowerCase() !== 'img') {
    return false;
  }
  return isElementGaiji(node as HTMLImageElement);
}
