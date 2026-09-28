/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Discover sources while browsing the library, not while editing connection consent.
 * Cached snippet publication and explicit pending saves remain available everywhere. */
export function isSnippetLibraryPath(pathname: string, base: string) {
  return [
    base || '/',
    base + '/',
    base + '/manage',
    base + '/manage/',
    base + '/snippets',
    base + '/snippets/'
  ].includes(pathname);
}
