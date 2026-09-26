/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { countReadingCharacters } from './count-reading-characters.ts';
import { isNodeGaiji } from './is-node-gaiji.ts';

export function getCharacterCount(node: Node) {
  return isNodeGaiji(node) ? 1 : getRawCharacterCount(node);
}

function getRawCharacterCount(node: Node) {
  return countReadingCharacters(node.textContent ?? '');
}
