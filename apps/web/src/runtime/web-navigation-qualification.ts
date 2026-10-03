/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  installRouter,
  goto,
  navigateBrowserHistory,
  pushState,
  replaceState,
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
import { base } from './paths';
import { admittedWebAppLink } from './web-app-link';

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

/** Production web navigation adapter. Every browser traversal retains its real entry
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
  const appLinkClick = (event: MouseEvent) => {
    const link = admittedWebAppLink(event, new URL(broker.currentEntry.href), base);
    if (!link) return;
    const { url, options } = link;
    event.preventDefault();
    if (!link.fragment) {
      // Expo may ignore an identical route; never retire its live reader first.
      if (link.sameUrl) {
        version++;
        broker.invalidate();
        void broker.waitUntilRestored().catch(failed);
      } else void goto(url, options).catch(failed);
      return;
    }
    // EPUB links normally stop here before bubbling: their existing nextChapter
    // handler owns spine/fragment navigation. This handles otherwise-native links.
    const request = ++version;
    const entry = broker.currentEntry.key;
    broker.invalidate();
    void broker
      .waitUntilRestored()
      .then(() => {
        if (!alive || request !== version || broker.currentEntry.key !== entry) return;
        (options.replaceState ? replaceState : pushState)(url, window.history.state ?? {});
        if (options.noScroll) return;
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
  window.addEventListener('click', appLinkClick);
  return () => {
    alive = false;
    version++;
    window.removeEventListener('click', appLinkClick);
    stopAccount();
    stopProfile();
    stopRouter();
    void broker.dispose().catch(() => {});
  };
}
