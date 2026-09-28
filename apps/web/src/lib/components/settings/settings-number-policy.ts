/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const MAX_TRACKER_IDLE_MINUTES = 12 * 60;
export const MAX_TRACKER_IDLE_SECONDS = MAX_TRACKER_IDLE_MINUTES * 60;

/** Convert the settings field's minutes to the tracker's persisted seconds. */
export function trackerIdleSecondsFromMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;

  return Math.min(MAX_TRACKER_IDLE_SECONDS, Math.floor(value * 60));
}
