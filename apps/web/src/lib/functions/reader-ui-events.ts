/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Application controls own their keys/wheel gestures, never the underlying book. */
export function readerUIOwnsEvent(event?: Event): boolean {
  if (event?.defaultPrevented) return true;
  if (typeof document === 'undefined') return false;
  const target = event?.target;
  if (
    (target as Node | null)?.nodeType === 1 &&
    (target as Element).closest(
      'input, textarea, select, button, a, [contenteditable="true"], [role="menu"], [role="dialog"], [role="listbox"], [data-ui-overlay]'
    )
  )
    return true;
  return !!document.querySelector(
    '[data-slot="dropdown-menu-content"]:not([data-closed]), [data-slot="sheet-content"]:not([data-closed]), [data-slot="dialog-content"]:not([data-closed]), [data-ui-overlay="open"]'
  );
}
