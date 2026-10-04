/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { refreshLocation } from './stores';
import { base } from './paths';
let router:
  | {
      push(path: string): void;
      replace(path: string): void;
      returnTo?(href: string, isCurrent: () => boolean): Promise<boolean | undefined>;
      sameDocumentHistory?: boolean;
      prepareNavigation?(): Promise<boolean | (() => boolean)>;
      currentUrl?(): string;
    }
  | undefined;
export function installRouter(value: NonNullable<typeof router>) {
  router = value;
  return () => {
    if (router === value) router = undefined;
  };
}
export type Navigation = {
  readonly intent: symbol;
  from: { url: URL };
  to: { url: URL } | null;
  type: string;
  willUnload: boolean;
  cancel(): void;
  /** Run only after every synchronous guard admits this attempt, before dispatch. */
  beforeCommit(action: () => void | Promise<void>): void;
  /** Acknowledge dispatch only after every pre-dispatch cleanup still admits it. */
  afterCommit(action: () => void): void;
  /** Keep asynchronous browser dispatch bound to this exact outgoing owner. */
  retainOwner(isCurrent: () => boolean): void;
  /** Retry this exact intent after a synchronous guard has canceled it. */
  retry(): Promise<void>;
};
export type NavigationArrival = Readonly<{ intent: symbol; from: string; to: string }>;
let arrival: NavigationArrival | undefined;
/** Capture once for a focused route visit, then pass the immutable value as a
 * route prop. Retained screens must not subscribe to unrelated global arrivals. */
export function readNavigationArrival(routeUrl: string | URL): NavigationArrival | undefined {
  if (!arrival) return undefined;
  const origin = typeof location === 'undefined' ? arrival.to : location.href;
  return arrival.to === new URL(routeUrl, origin).href ? arrival : undefined;
}
/** The qualified browser adapter restores a previously admitted history entry. */
export function restoreNavigationArrival(value: NavigationArrival | undefined) {
  arrival = value && Object.freeze({ ...value });
}
export interface BrowserNavigation {
  from: string;
  to: string;
  isCurrent(): boolean;
  sameDocument?: boolean;
  replay(isCurrent: () => boolean): Promise<boolean>;
}
export function navigateBrowserHistory(traversal: BrowserNavigation): Promise<void> {
  return navigate(
    traversal.to,
    { noScroll: true, keepFocus: true },
    Symbol('browser-history'),
    traversal
  );
}
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
    returnTo?: boolean;
    noScroll?: boolean;
    keepFocus?: boolean;
    state?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const url = new URL(href, router?.currentUrl?.() ?? location.href).href;
  const captured = {
    ...options,
    ...(options.state !== undefined && { state: structuredClone(options.state) })
  };
  const intent = Symbol('navigation');
  const prepared = router?.prepareNavigation ? await router.prepareNavigation() : true;
  // Guards still observe an impossible attempt so an explicit reader close can
  // settle its save and resume, rather than stranding blockDataUpdates on error.
  return navigate(url, captured, intent, undefined, prepared);
}
/** Return to an admitted prior browser entry; cold visits replace their local fallback. */
export function backTo(href: string | URL): Promise<void> {
  return goto(href, { returnTo: true, replaceState: true });
}
async function navigate(
  href: string,
  options: Parameters<typeof goto>[1],
  intent: symbol,
  traversal?: BrowserNavigation,
  prepared: boolean | (() => boolean) = true
): Promise<void> {
  if (traversal && !traversal.isCurrent()) return;
  const url = new URL(href);
  options ??= {};
  const preparedNow = () => (typeof prepared === 'function' ? prepared() : prepared);
  let cancelled = !preparedNow();
  const commits: Array<() => void | Promise<void>> = [];
  const committed: Array<() => void> = [];
  const owners: Array<() => boolean> = [];
  const current = () => {
    try {
      return (
        preparedNow() && (!traversal || traversal.isCurrent()) && owners.every((check) => check())
      );
    } catch {
      return false;
    }
  };
  const from = new URL(traversal?.from ?? location.href);
  const fragment =
    traversal &&
    (traversal.sameDocument ??
      (from.pathname === url.pathname && from.search === url.search && from.hash !== url.hash));
  const event: Navigation = {
    intent,
    from: { url: from },
    to: { url },
    type: fragment ? 'fragment' : traversal ? 'popstate' : 'goto',
    willUnload: url.origin !== location.origin,
    cancel: () => {
      cancelled = true;
    },
    beforeCommit: (action) => commits.push(action),
    afterCommit: (action) => committed.push(action),
    retainOwner: (check) => owners.push(check),
    retry: () => navigate(href, options, intent, traversal, prepared)
  };
  for (const listener of before) listener(event);
  if (cancelled || !current()) return;
  for (const commit of commits) {
    await commit();
    // An async owner can be superseded while its departure cleanup settles.
    if (cancelled || !current()) return;
  }
  if (event.willUnload) {
    location.assign(url);
    return;
  }
  // The browser owns fragment navigation within the current document. Pushing
  // it through Expo Stack retains another copy of the same screen. Embedded
  // native owners do not opt in: every route intent still reaches their bridge.
  const sameDocumentFragment =
    router?.sameDocumentHistory &&
    url.pathname === location.pathname &&
    url.search === location.search &&
    (url.hash !== '' || url.hash !== location.hash);
  const previousArrival = arrival;
  const admitted = Object.freeze({ intent, from: event.from.url.href, to: url.href });
  arrival = admitted;
  try {
    if (traversal) {
      if (!current() || !(await traversal.replay(current))) {
        if (arrival === admitted) arrival = previousArrival;
        return;
      }
    } else if (sameDocumentFragment) {
      history[options.replaceState ? 'replaceState' : 'pushState'](
        { ...history.state, ...options.state },
        '',
        url
      );
    } else if (router) {
      const pathname =
        url.pathname === base
          ? '/'
          : url.pathname.startsWith(base + '/')
            ? url.pathname.slice(base.length)
            : url.pathname;
      const path = `${pathname}${url.search}${url.hash}`;
      const returned = options.returnTo ? await router.returnTo?.(url.href, current) : undefined;
      if (returned === false) {
        if (arrival === admitted) arrival = previousArrival;
        return;
      }
      if (returned === undefined) {
        if (!current()) {
          if (arrival === admitted) arrival = previousArrival;
          return;
        }
        router[options.replaceState ? 'replace' : 'push'](path);
      }
    } else
      history[options.replaceState ? 'replaceState' : 'pushState'](options.state ?? {}, '', url);
  } catch (error) {
    if (arrival === admitted) arrival = previousArrival;
    throw error;
  }
  refreshLocation();
  for (const acknowledge of committed) acknowledge();
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
