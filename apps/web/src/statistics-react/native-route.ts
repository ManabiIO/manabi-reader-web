/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Data-only route parsing. A token is a hint until the DOM owner admits it. */
export function nativeStatisticsRoute(
  params: Record<string, unknown>
): { kind: 'all' } | { kind: 'selection'; token: string } | { kind: 'invalid' } {
  const keys = Object.keys(params);
  if (!keys.length) return { kind: 'all' };
  if (
    keys.length !== 1 ||
    keys[0] !== 'selection' ||
    typeof params.selection !== 'string' ||
    !/^[A-Za-z0-9-]{1,64}$/.test(params.selection)
  )
    return { kind: 'invalid' };
  return { kind: 'selection', token: params.selection };
}

export const statisticsRouteError =
  'This Statistics selection is invalid or expired. Return to the Library and choose the book again.';
