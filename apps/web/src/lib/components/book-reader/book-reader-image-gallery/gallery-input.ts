/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Wheel paging is an opt-in viewer gesture, not a global scroll/zoom shortcut. */
export function galleryWheelStep(event: WheelEvent, viewer: HTMLElement | null): -1 | 0 | 1 {
  if (
    !viewer?.isConnected ||
    viewer.ownerDocument.activeElement !== viewer ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    !Number.isFinite(event.deltaY) ||
    !Number.isFinite(event.deltaX) ||
    Math.abs(event.deltaY) <= Math.abs(event.deltaX)
  )
    return 0;
  const path = event.composedPath();
  const index = path.indexOf(viewer);
  if (index < 0) return 0;
  // A nested image region may itself need scrolling (for example after zoom).
  // Leave the whole gesture native, even at its boundary, instead of paging.
  for (const node of path.slice(0, index + 1)) {
    if (!(node instanceof HTMLElement)) continue;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (
      (node.scrollHeight > node.clientHeight + 1 &&
        /^(auto|scroll|overlay)$/.test(style?.overflowY ?? '')) ||
      (node.scrollWidth > node.clientWidth + 1 &&
        /^(auto|scroll|overlay)$/.test(style?.overflowX ?? ''))
    )
      return 0;
  }
  return event.deltaY < 0 ? -1 : 1;
}

/** Preserve native activation, text editing, IME, and browser shortcuts. */
export function galleryShortcutAllowed(event: KeyboardEvent, gallery: HTMLElement | null) {
  if (
    !gallery?.isConnected ||
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    event.key === 'Tab' ||
    event.key === 'Escape'
  )
    return false;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !gallery.contains(target)) return false;
  if (target.closest('[role="dialog"], [role="alertdialog"]') !== gallery) return false;
  if (target.isContentEditable || target.closest('input, textarea, select')) return false;
  if (
    (event.key === 'Enter' || event.key === ' ') &&
    target.closest('button, a[href], summary, [role="button"]')
  )
    return false;
  return true;
}
