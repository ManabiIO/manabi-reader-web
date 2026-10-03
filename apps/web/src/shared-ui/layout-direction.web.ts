/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Direction belongs to the actual focused surface, including local dir overrides. */
export function isRtlTarget(target?: unknown) {
  return target instanceof Element && getComputedStyle(target).direction === 'rtl';
}
