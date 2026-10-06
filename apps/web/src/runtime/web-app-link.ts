/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// This is deliberately the current Expo page inventory, not a same-origin
// catch-all. Auth callbacks, API/account endpoints and static assets stay native.
const pages = new Set([
  '',
  '/',
  '/manage',
  '/b',
  '/settings',
  '/connections',
  '/import-ttu',
  '/shared-library',
  '/snippets',
  '/statistics',
  '/videos'
]);

function inheritedBoolean(anchor: Element, name: string) {
  const owner = anchor.closest(`[data-sveltekit-${name}]`);
  return !!owner && owner.getAttribute(`data-sveltekit-${name}`) !== 'false';
}

/** A plain link may enter the same save/owner/history protocol as app buttons. */
export function admittedWebAppLink(event: MouseEvent, source: URL, base: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return;
  const target = event.target as Element | null;
  if (target?.nodeType !== 1) return;
  const anchor = target.closest<HTMLAnchorElement>('a[href]');
  if (
    !anchor ||
    typeof anchor.href !== 'string' ||
    anchor.hasAttribute('target') ||
    anchor.hasAttribute('download') ||
    anchor.rel.toLowerCase().split(/\s+/).includes('external') ||
    inheritedBoolean(anchor, 'reload')
  )
    return;
  let url: URL;
  try {
    url = new URL(anchor.href);
  } catch {
    return;
  }
  if (url.origin !== source.origin || url.username || url.password) return;
  const prefix = base === '/' ? '' : base.replace(/\/$/, '');
  if (
    !pages.has(url.pathname.slice(prefix.length)) ||
    (prefix && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`))
  )
    return;
  const options = {
    noScroll: inheritedBoolean(anchor, 'noscroll'),
    keepFocus: inheritedBoolean(anchor, 'keepfocus'),
    replaceState: inheritedBoolean(anchor, 'replacestate')
  };
  return {
    url,
    options,
    sameUrl: url.href === source.href,
    fragment:
      anchor.getAttribute('href')!.includes('#') &&
      url.pathname === source.pathname &&
      url.search === source.search
  };
}
