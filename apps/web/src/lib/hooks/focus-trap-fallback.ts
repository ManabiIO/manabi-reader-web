/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');
const pendingTabs = new WeakMap<HTMLElement, number>();

/** Keep modal focus contained when WebKit's native Tab order skips buttons. */
export function containModalTab(event: KeyboardEvent) {
  const node = event.currentTarget;
  if (!(node instanceof HTMLElement)) return;
  const pending = pendingTabs.get(node);
  if (pending !== undefined) {
    cancelAnimationFrame(pending);
    pendingTabs.delete(node);
  }
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const backwards = event.shiftKey;
  const frame = requestAnimationFrame(() => {
    pendingTabs.delete(node);
    if (
      !node.isConnected ||
      node.hasAttribute('data-closed') ||
      node.contains(node.ownerDocument.activeElement)
    )
      return;
    const candidates = [...node.querySelectorAll<HTMLElement>(focusableSelector)].filter(
      (element) =>
        element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true'
    );
    const target = backwards ? candidates.at(-1) : candidates[0];
    (target ?? node).focus();
  });
  pendingTabs.set(node, frame);
}
