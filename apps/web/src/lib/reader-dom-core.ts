/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const READER_TEXT_NODE = 3;

export function readerNodeLocalName(node: Node): string | undefined {
  if (node.nodeType !== 1) return undefined;
  return (node as Element).localName?.toLowerCase?.() || undefined;
}

export function readerTraversalNodeIsVisible(node: Node): boolean {
  const localName = readerNodeLocalName(node);
  if (localName === 'rt') return false;
  if (node.nodeType !== 1) return true;
  const element = node as Element;
  return !element.hasAttribute('aria-hidden') && !element.hasAttribute('hidden');
}
