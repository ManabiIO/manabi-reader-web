/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { modalTabCandidates } from './modal-tab-candidates';

const modalSelector = '[role="dialog"], [role="alertdialog"], dialog[open]';
const layerSelector = `${modalSelector}, [role="menu"], [role="listbox"], [data-popover-content]`;
const pendingTabs = new WeakMap<HTMLElement, () => void>();

/** Keep modal focus contained when WebKit's native Tab order skips buttons.
 * This is a fallback after normal dispatch, never a second owner of an active
 * child dialog or a later pointer gesture. Bits UI still handles ordinary Tab. */
export function containModalTab(event: KeyboardEvent) {
  const node = event.currentTarget;
  if (!(node instanceof HTMLElement)) return;
  pendingTabs.get(node)?.();
  if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey)
    return;
  const target = event.target;
  if (target instanceof Element && target.closest(modalSelector) !== node) return;
  const document = node.ownerDocument;
  const view = document.defaultView;
  if (!view) return;
  const backwards = event.shiftKey;
  const existingLayers = new Set([...document.querySelectorAll(layerSelector)].filter(isOpenLayer));
  let frame: number | undefined;

  function isOpenLayer(element: Element) {
    return (
      element.isConnected &&
      !element.matches('[data-closed], [data-state="closed"]') &&
      !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
      element.getClientRects().length > 0 &&
      view!.getComputedStyle(element).visibility === 'visible'
    );
  }

  function cancel() {
    if (frame !== undefined) view!.cancelAnimationFrame(frame);
    document.removeEventListener('pointerdown', cancel, true);
    if (pendingTabs.get(node as HTMLElement) === cancel) pendingTabs.delete(node as HTMLElement);
  }

  pendingTabs.set(node, cancel);
  document.addEventListener('pointerdown', cancel, { capture: true, once: true });
  frame = view.requestAnimationFrame(() => {
    cancel();
    // Bubble-phase handlers may cancel Tab after our capture handler ran.
    if (
      event.defaultPrevented ||
      !isOpenLayer(node) ||
      !document.hasFocus() ||
      node.contains(document.activeElement)
    )
      return;
    const activeModal = document.activeElement?.closest(layerSelector);
    if (activeModal && activeModal !== node && !activeModal.contains(node)) return;
    // A child may be mounted now but still waiting for its own autofocus.
    if (
      [...document.querySelectorAll(layerSelector)].some(
        (layer) => !existingLayers.has(layer) && isOpenLayer(layer)
      )
    )
      return;
    // Native candidate eligibility matters even when the normal focus scope
    // needs fallback: disabled-fieldset controls and negative tab stops are not
    // legitimate destinations merely because a selector finds them.
    const candidates = modalTabCandidates(node);
    const ordered = backwards ? candidates.reverse() : candidates;
    for (const candidate of ordered) {
      candidate.focus();
      if (node.contains(document.activeElement)) return;
    }
    node.focus();
  });
}
