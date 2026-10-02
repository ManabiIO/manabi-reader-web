/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  installRouter,
  navigateBrowserHistory,
  pushState,
  readNavigationArrival,
  restoreNavigationArrival,
  type NavigationArrival
} from './navigation';
import {
  installWebHistoryBroker,
  type WebHistoryBroker,
  type WebHistoryEntry
} from './web-history-broker';
import { hasActiveWebReaderDeparture } from '../reader-react/web-reader-departure';
import { account, accountGeneration, localProfileUser, localUser } from '../lib/manabi/client';
import { refreshLocation } from './stores';

function readerFragment(from: WebHistoryEntry, to: WebHistoryEntry) {
  const source = new URL(from.href),
    target = new URL(to.href);
  const fromId = (from.state as { id?: unknown } | null)?.id;
  const toId = (to.state as { id?: unknown } | null)?.id;
  return (
    typeof fromId === 'string' &&
    fromId === toId &&
    source.pathname === target.pathname &&
    source.search === target.search
  );
}

/** Qualification-only adapter. Every browser traversal retains its real entry
 * identity; every app navigation waits for an interrupted traversal to restore. */
export function installQualifiedWebNavigation(
  window: Window,
  router: { push(path: string): void; replace(path: string): void },
  report: (message: string) => void
) {
  let alive = true;
  let version = 0;
  const arrivals = new Map<string, NavigationArrival>();
  const failed = (error: unknown) => {
    if (alive) report(error instanceof Error ? error.message : String(error));
  };
  const broker: WebHistoryBroker = installWebHistoryBroker(window, {
    shouldBlock: (target) =>
      hasActiveWebReaderDeparture() && (!target || !readerFragment(broker.currentEntry, target)),
    shouldNotifyPopstate: (entry, previous) =>
      !hasActiveWebReaderDeparture() || !readerFragment(previous, entry),
    onBlocked: failed,
    onTraversal: (intent) => {
      version++;
      const fragment = readerFragment(intent.from, intent.to);
      void navigateBrowserHistory({
        from: intent.from.href,
        to: intent.to.href,
        isCurrent: () => alive && intent.isCurrent(),
        sameDocument: fragment,
        replay: (isCurrent) => intent.replay({ isCurrent, notifyListeners: !fragment })
      }).catch(failed);
    },
    onEntry: (entry, previous, kind) => {
      if (kind === 'traverse') {
        version++;
        restoreNavigationArrival(arrivals.get(entry.key));
        if (hasActiveWebReaderDeparture() && readerFragment(previous, entry)) refreshLocation();
        return;
      }
      const from = new URL(previous.href),
        to = new URL(entry.href);
      const existing = arrivals.get(entry.key);
      const prior = arrivals.get(previous.key);
      const sameDocument = from.pathname === to.pathname && from.search === to.search;
      const value =
        existing?.to === entry.href
          ? existing
          : sameDocument && prior
            ? Object.freeze({ ...prior, to: entry.href })
            : readNavigationArrival(entry.href);
      if (value) arrivals.set(entry.key, value);
      else arrivals.delete(entry.key);
    }
  });
  let profile = localProfileUser()?.id ?? null;
  let generation = accountGeneration();
  const identityChanged = () => {
    const nextProfile = localProfileUser()?.id ?? null;
    const nextGeneration = accountGeneration();
    if (profile === nextProfile && generation === nextGeneration) return;
    profile = nextProfile;
    generation = nextGeneration;
    version++;
    arrivals.clear();
    broker.invalidate();
  };
  const stopAccount = account.subscribe(identityChanged);
  const stopProfile = localUser.subscribe(identityChanged);
  const initial = readNavigationArrival(broker.currentEntry.href);
  if (initial) arrivals.set(broker.currentEntry.key, initial);
  const stopRouter = installRouter({
    ...router,
    sameDocumentHistory: true,
    currentUrl: () => broker.currentEntry.href,
    prepareNavigation: async () => {
      const request = ++version;
      broker.invalidate();
      try {
        await broker.waitUntilRestored();
        return () => alive && request === version;
      } catch (error) {
        failed(error);
        return false;
      }
    }
  });
  const fragmentClick = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const target = event.target as Element | null;
    if (target?.nodeType !== 1) return;
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (
      !anchor ||
      typeof anchor.href !== 'string' ||
      anchor.target ||
      anchor.hasAttribute('download') ||
      anchor.rel.split(/\s+/).includes('external')
    )
      return;
    const href = anchor.getAttribute('href') ?? '';
    const url = new URL(anchor.href, broker.currentEntry.href),
      source = new URL(broker.currentEntry.href);
    if (
      !href.includes('#') ||
      url.origin !== source.origin ||
      url.pathname !== source.pathname ||
      url.search !== source.search
    )
      return;
    // EPUB links normally stop here before bubbling: their existing nextChapter
    // handler owns spine/fragment navigation. This handles otherwise-native links.
    event.preventDefault();
    const request = ++version;
    const entry = broker.currentEntry.key;
    broker.invalidate();
    void broker
      .waitUntilRestored()
      .then(() => {
        if (!alive || request !== version || broker.currentEntry.key !== entry) return;
        pushState(url, window.history.state ?? {});
        let id = url.hash.slice(1);
        try {
          id = decodeURIComponent(id);
        } catch {
          /* Keep malformed IDs literal. */
        }
        const destination =
          window.document.getElementById(id) ?? window.document.getElementsByName(id)[0];
        if (destination) destination.scrollIntoView();
        else if (!id || id.toLowerCase() === 'top') window.scrollTo(0, 0);
      })
      .catch(failed);
  };
  window.addEventListener('click', fragmentClick);
  return () => {
    alive = false;
    version++;
    window.removeEventListener('click', fragmentClick);
    stopAccount();
    stopProfile();
    stopRouter();
    void broker.dispose().catch(() => {});
  };
}
