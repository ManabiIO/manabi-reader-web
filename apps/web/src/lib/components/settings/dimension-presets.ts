/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Presets set a pixel value; opening or resizing the chooser is read-only. */
export function dimensionExtent(
  vertical: boolean,
  first: boolean,
  width: number,
  height: number
): number {
  const value = vertical === first ? width : height;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function dimensionLimits(first: boolean) {
  return first ? { min: 5, max: 50, step: 5 } : { min: 50, max: 95, step: 5 };
}

/** The nearest quick-size preset is not a replacement for the saved value. */
export function dimensionPercentage(value: number, extent: number, first: boolean): number {
  const { min, max, step } = dimensionLimits(first);
  if (!Number.isFinite(value) || value < 0 || extent <= 0 || !Number.isFinite(extent))
    return first ? min : max;
  if (!first && value === 0) return max;
  const percentage = ((value * (first ? 2 : 1)) / extent) * 100;
  return Math.min(max, Math.max(min, Math.round(percentage / step) * step));
}

export function dimensionPixels(percentage: number, extent: number, first: boolean): number | null {
  const { min, max, step } = dimensionLimits(first);
  if (
    !Number.isFinite(percentage) ||
    percentage < min ||
    percentage > max ||
    percentage % step !== 0 ||
    !Number.isFinite(extent) ||
    extent <= 0
  )
    return null;
  const pixels = Math.ceil((extent * percentage) / 100 / (first ? 2 : 1));
  return Number.isSafeInteger(pixels) && pixels > 0 ? pixels : null;
}

export function dimensionLabel(vertical: boolean, first: boolean): string {
  return first
    ? vertical
      ? 'Left and right margins'
      : 'Top and bottom margins'
    : vertical
      ? 'Maximum page height'
      : 'Maximum page width';
}
