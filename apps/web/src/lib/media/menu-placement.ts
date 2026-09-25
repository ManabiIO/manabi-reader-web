/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface MenuViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

type VisualBounds = Pick<VisualViewport, 'offsetLeft' | 'offsetTop' | 'width' | 'height'>;

/** Fixed-position coordinates are relative to the layout viewport; the visible
 * portion can shrink or move independently when a keyboard opens or the page zooms.
 */
export function menuViewport(
  width: number,
  height: number,
  visual?: VisualBounds | null
): MenuViewport {
  const fallback = {
    left: 0,
    top: 0,
    width: Number.isFinite(width) && width > 0 ? width : 1,
    height: Number.isFinite(height) && height > 0 ? height : 1
  };
  if (
    !visual ||
    ![visual.offsetLeft, visual.offsetTop, visual.width, visual.height].every(Number.isFinite) ||
    visual.width <= 0 ||
    visual.height <= 0
  )
    return fallback;
  const left = Math.max(0, visual.offsetLeft);
  const top = Math.max(0, visual.offsetTop);
  const right = Math.min(fallback.width, visual.offsetLeft + visual.width);
  const bottom = Math.min(fallback.height, visual.offsetTop + visual.height);
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top }
    : fallback;
}

export function placeTranscriptMenu(
  anchor: Pick<DOMRect, 'right' | 'top' | 'bottom'>,
  viewport: MenuViewport,
  measuredHeight: number
) {
  const gutter = Math.min(12, viewport.width / 4, viewport.height / 4);
  const width = Math.min(320, viewport.width - 2 * gutter);
  const maxHeight = viewport.height - 2 * gutter;
  const height = Math.min(
    maxHeight,
    Number.isFinite(measuredHeight) ? Math.max(0, measuredHeight) : maxHeight
  );
  const left = Math.max(
    viewport.left + gutter,
    Math.min(anchor.right - width, viewport.left + viewport.width - gutter - width)
  );
  const minimumTop = viewport.top + gutter;
  const maximumTop = viewport.top + viewport.height - gutter - height;
  const below = anchor.bottom + 8;
  const above = anchor.top - height - 8;
  const preferred = below <= maximumTop ? below : above >= minimumTop ? above : below;
  return {
    width,
    maxHeight,
    left,
    top: Math.max(minimumTop, Math.min(preferred, maximumTop))
  };
}
