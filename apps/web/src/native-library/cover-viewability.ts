/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Thumbnails follow the current viewport immediately. Delayed RN callbacks can
 * arrive out of order after layout and drop rows that are still visible. */
export const libraryCoverViewability = {
  itemVisiblePercentThreshold: 15,
  minimumViewTime: 0
} as const;
