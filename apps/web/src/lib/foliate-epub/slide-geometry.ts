/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export type TurnDirection = -1 | 1;
export type ReadingDirection = 'ltr' | 'rtl';

/** Distance-based sheet poses, shared by every input and reduced-motion mode. */
export function slideGeometry(
  value: number,
  turn: TurnDirection,
  reading: ReadingDirection,
  width: number
) {
  const progress = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const extent = Number.isFinite(width) ? Math.max(0, width) : 0;
  const sign = reading === 'rtl' ? 1 : -1;
  return {
    progress,
    currentX: sign * extent * (turn === 1 ? progress : -0.15 * progress),
    neighborX: sign * extent * (turn === 1 ? -0.15 * (1 - progress) : 1 - progress),
    currentShade: turn === -1 ? 0.24 * progress : 0,
    neighborShade: turn === 1 ? 0.24 * (1 - progress) : 0
  };
}

/** Wheel delta modes are pixels, lines, or pages; Ctrl+wheel is never remapped. */
export function wheelPageDistance(
  x: number,
  y: number,
  mode: number,
  width: number,
  reading: ReadingDirection
): number {
  const horizontal = Math.abs(x) >= Math.abs(y);
  const pixels = (horizontal ? x : y) * (mode === 1 ? 16 : mode === 2 ? width : 1);
  return pixels * (horizontal && reading === 'rtl' ? -1 : 1);
}
