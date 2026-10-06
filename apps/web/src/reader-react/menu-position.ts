/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export function readerMenuPosition(
  anchor: Pick<DOMRect, 'right' | 'top' | 'bottom'>,
  menu: { width: number; height: number },
  viewport: { left: number; top: number; width: number; height: number }
) {
  const gap = 8;
  const left = viewport.left + gap;
  const top = viewport.top + gap;
  const right = viewport.left + viewport.width - gap;
  const bottom = viewport.top + viewport.height - gap;
  const maxWidth = Math.max(0, right - left);
  const width = Math.min(menu.width, maxWidth);
  const below = Math.max(0, bottom - Math.max(top, anchor.bottom + gap));
  const above = Math.max(0, Math.min(bottom, anchor.top - gap) - top);
  const down = below >= Math.min(160, menu.height) || below >= above;
  const maxHeight = down ? below : above;
  return {
    left: Math.max(left, Math.min(anchor.right - width, right - width)),
    top: down
      ? Math.max(top, Math.min(anchor.bottom + gap, bottom))
      : Math.max(top, Math.min(anchor.top - gap, bottom) - Math.min(menu.height, maxHeight)),
    maxWidth,
    maxHeight
  };
}
