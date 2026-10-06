/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Convert trusted DOM routes to native shell routes without granting URL navigation. */
export function nativeNavigationPath(destination: string, base: string): string | undefined {
  if (!destination.startsWith('/') || destination.startsWith('//') || destination.includes('\\'))
    return undefined;
  const path =
    base && (destination === base || destination.startsWith(`${base}/`))
      ? destination.slice(base.length) || '/'
      : destination;
  return /^\/(manage|settings|connections|statistics|snippets|shared-library|import-ttu|auth|videos|b)(?:[?#]|$)/.test(
    path
  )
    ? path
    : undefined;
}
