/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** One process-wide action owner shared with retained reader Statistics surfaces. */
let active: symbol | undefined;
export function acquireStatisticsActionLease(): symbol | undefined {
  if (active) return;
  return (active = Symbol('statistics-action'));
}
export function releaseStatisticsActionLease(lease: symbol): boolean {
  if (active !== lease) return false;
  active = undefined;
  return true;
}
export function hasStatisticsActionLease() {
  return active !== undefined;
}
