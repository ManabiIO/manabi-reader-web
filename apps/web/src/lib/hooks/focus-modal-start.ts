/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Avoid opening a long information dialog already scrolled to its footer.
 * A visible editable field still receives focus; otherwise start at the modal
 * itself so its title and dismiss control remain in view. Callers may override
 * this using onOpenAutoFocus and preventDefault(). */
export function focusModalStart(event: Event, modal: HTMLElement) {
  const bounds = modal.getBoundingClientRect();
  const field = [
    ...modal.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not([type="file"]), textarea, select')
  ].find((element) => {
    const rect = element.getBoundingClientRect();
    return (
      !element.matches(':disabled, [readonly], [aria-disabled="true"]') &&
      // Visually hidden file/checkbox controls can have a 1px client rect.
      // They stay keyboard-accessible via their labels, but are not a visible
      // starting point for a newly opened modal.
      !element.closest('.sr-only') &&
      element.tabIndex >= 0 &&
      element.getClientRects().length > 0 &&
      !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
      getComputedStyle(element).visibility === 'visible' &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left >= Math.max(0, bounds.left) &&
      rect.right <= Math.min(modal.ownerDocument.documentElement.clientWidth, bounds.right) &&
      rect.top >= Math.max(0, bounds.top) &&
      rect.bottom <= Math.min(modal.ownerDocument.documentElement.clientHeight, bounds.bottom)
    );
  });
  event.preventDefault();
  (field ?? modal).focus({ preventScroll: true });
}
