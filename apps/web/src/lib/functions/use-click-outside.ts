/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export function clickOutside(node: Node, listener: (ev: MouseEvent) => void) {
  const handler = (ev: MouseEvent) => {
    // Portalled controls still belong to the reader toolbar that opened them.
    // Do not remove their trigger while they handle selection or restore focus.
    if (
      ev.target instanceof Element &&
      ev.target.closest(
        '[data-slot="dropdown-menu-content"], [data-slot="dialog-content"], [data-slot="sheet-content"], [data-popover]'
      )
    )
      return;
    if (!ev.defaultPrevented && !node.contains(ev.target as Node)) {
      listener(ev);
    }
  };

  document.addEventListener('click', handler, true);

  return {
    destroy() {
      document.removeEventListener('click', handler, true);
    }
  };
}
