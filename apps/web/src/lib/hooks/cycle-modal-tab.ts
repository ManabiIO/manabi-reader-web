/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { modalTabCandidates } from './modal-tab-candidates';

/** React modal primitives own the complete Tab cycle, including engines whose
 * native keyboard preferences skip buttons. Child layers and cancelled events
 * retain their own keyboard handling. */
export function cycleModalTab(event: KeyboardEvent, modal: HTMLElement) {
  if (
    event.key !== 'Tab' ||
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.isComposing
  )
    return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(
      '[role="dialog"], [role="alertdialog"], dialog[open], [role="menu"], [role="listbox"], [data-popover-content]'
    ) !== modal
  )
    return;
  const candidates = modalTabCandidates(modal);
  const index = candidates.indexOf(modal.ownerDocument.activeElement as HTMLElement);
  const next = event.shiftKey
    ? candidates[(index <= 0 ? candidates.length : index) - 1]
    : candidates[(index + 1) % candidates.length];
  event.preventDefault();
  (next ?? modal).focus();
}
