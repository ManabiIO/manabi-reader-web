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
    ...modal.querySelectorAll<HTMLElement>('input:not([type="hidden"]), textarea, select')
  ].find((element) => {
    const rect = element.getBoundingClientRect();
    return (
      !element.matches(':disabled') &&
      element.tabIndex >= 0 &&
      element.getClientRects().length > 0 &&
      !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
      getComputedStyle(element).visibility === 'visible' &&
      rect.top >= bounds.top &&
      rect.bottom <= bounds.bottom
    );
  });
  event.preventDefault();
  (field ?? modal).focus({ preventScroll: true });
}
