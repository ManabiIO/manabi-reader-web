/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { refreshLocation } from './stores';
import { base } from './paths';
let router: { push(path: string): void; replace(path: string): void } | undefined;
export function installRouter(value: NonNullable<typeof router>) {
  router = value;
  return () => {
    if (router === value) router = undefined;
  };
}
type Navigation = {
  from: { url: URL };
  to: { url: URL } | null;
  type: string;
  willUnload: boolean;
  cancel(): void;
};
const before = new Set<(navigation: Navigation) => void>();
const after = new Set<(navigation: Navigation) => void>();
export function beforeNavigate(fn: (navigation: Navigation) => void) {
  before.add(fn);
  return () => {
    before.delete(fn);
  };
}
export function afterNavigate(fn: (navigation: Navigation) => void) {
  after.add(fn);
  return () => {
    after.delete(fn);
  };
}
export async function goto(
  href: string | URL,
  options: {
    replaceState?: boolean;
    noScroll?: boolean;
    keepFocus?: boolean;
    state?: Record<string, unknown>;
  } = {}
) {
  const url = new URL(href, location.href);
  let cancelled = false;
  const event: Navigation = {
    from: { url: new URL(location.href) },
    to: { url },
    type: 'goto',
    willUnload: url.origin !== location.origin,
    cancel: () => {
      cancelled = true;
    }
  };
  for (const listener of before) listener(event);
  if (cancelled) return;
  if (event.willUnload) {
    location.assign(url);
    return;
  }
  if (router) {
    const path = `${url.pathname.startsWith(base + '/') ? url.pathname.slice(base.length) : url.pathname}${url.search}${url.hash}`;
    router[options.replaceState ? 'replace' : 'push'](path);
  } else history[options.replaceState ? 'replaceState' : 'pushState'](options.state ?? {}, '', url);
  refreshLocation();
  for (const listener of after) listener(event);
  if (!options.noScroll) window.scrollTo(0, 0);
}
export function replaceState(url: string | URL, state: Record<string, unknown>) {
  history.replaceState(state, '', url);
  refreshLocation();
}
export function pushState(url: string | URL, state: Record<string, unknown>) {
  history.pushState(state, '', url);
  refreshLocation();
}
export const invalidateAll = async () => {
  refreshLocation();
};
