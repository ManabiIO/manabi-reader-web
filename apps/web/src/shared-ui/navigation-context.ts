/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const appDestinations = [
  { path: '/manage', label: 'Library' },
  { path: '/snippets', label: 'Snippets' },
  { path: '/statistics', label: 'Statistics' },
  { path: '/settings', label: 'Settings' },
  { path: '/connections', label: 'Accounts and libraries' },
  { path: '/shared-library', label: 'Shared libraries' },
  { path: '/import-ttu', label: 'Import from Ttu Ebook Reader' }
] as const;

/** Global destinations belong to the Library. Pushed screens expose only
 * related destinations; their back action owns the return to the previous view. */
export function contextualDestinations(path: string, platform: 'web' | 'android' = 'web') {
  const related: Record<string, readonly string[]> = {
    '/settings': ['/connections'],
    '/connections': ['/shared-library', '/import-ttu'],
    '/shared-library': ['/connections', '/import-ttu'],
    '/import-ttu': ['/connections'],
    '/auth': ['/connections'],
    '/snippets': ['/settings'],
    '/statistics': [],
    '/b': ['/settings']
  };
  const allowed = related[path];
  return appDestinations.filter(
    (item) =>
      item.path !== path &&
      (!allowed || allowed.includes(item.path)) &&
      // Keep direct routes for migration diagnostics, but do not offer unfinished
      // native integrations as destinations in a user-facing menu.
      (platform !== 'android' || !['/shared-library', '/import-ttu'].includes(item.path))
  );
}

/** A return route must be local and outside this pushed screen. */
export function navigationReturnPath(
  current: URL,
  previous: string | undefined,
  base: string,
  fallback = '/manage'
) {
  if (previous) {
    try {
      const from = new URL(previous, current.origin);
      if (
        from.origin === current.origin &&
        !from.username &&
        !from.password &&
        from.pathname.startsWith(`${base}/`) &&
        from.pathname !== current.pathname
      )
        return `${from.pathname}${from.search}${from.hash}`;
    } catch {
      /* A malformed arrival uses the local fallback. */
    }
  }
  return `${base}${fallback}`;
}
