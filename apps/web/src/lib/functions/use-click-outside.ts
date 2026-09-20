/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export function clickOutside(node: Node, listener: (ev: PointerEvent) => void) {
  const ownerDocument = node.ownerDocument ?? document;
  const handler = (ev: PointerEvent) => {
    if (ev.defaultPrevented) return;
    // Decide ownership at pointerdown, before a modal menu changes body pointer
    // events. Its subsequent click may be retargeted to <html>, not its trigger.
    // The composed path also retains ownership through shadow/portalled controls.
    const inside = ev
      .composedPath()
      .some(
        (target) =>
          target === node ||
          (target instanceof Element &&
            (node.contains(target) ||
              target.closest(
                '[data-slot="dropdown-menu-content"], [data-slot="dialog-content"], [data-slot="sheet-content"], [data-popover]'
              )))
      );
    if (!inside) listener(ev);
  };

  ownerDocument.addEventListener('pointerdown', handler, true);

  return {
    destroy() {
      ownerDocument.removeEventListener('pointerdown', handler, true);
    }
  };
}
