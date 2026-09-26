/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Realm-independent element detection. Using instanceof Element is false for
 * an element owned by another same-origin browsing context.
 */
export function isReaderElementNode(node: Pick<Node, 'nodeType'>): boolean {
  return node.nodeType === 1;
}

/** Normalize HTML and XHTML element names to one Reader comparison form. */
export function readerElementName(
  node: Pick<Element, 'localName' | 'nodeName'>
): string {
  return (node.localName || node.nodeName).toUpperCase();
}
