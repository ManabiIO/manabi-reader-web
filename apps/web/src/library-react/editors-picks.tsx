/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useRef, useState } from 'react';
import { BookOpen } from '@phosphor-icons/react';
import { loadEditorsPicks, type EditorsPick } from '$lib/library/editors-picks';
import { beforeNavigate, afterNavigate } from '$app/navigation';
import { Button } from './primitives';

function catalogRouteKey(url: URL) {
  return JSON.stringify([
    url.pathname,
    url.searchParams.get('collection') || 'books',
    url.searchParams.get('series') || '',
    url.searchParams.get('unfinished') === '1'
  ]);
}

export function EditorsPicks({
  openingId = '',
  headingId = 'editors-picks-heading',
  embedded = false,
  routeUrl,
  onOpen
}: {
  openingId?: string;
  headingId?: string;
  embedded?: boolean;
  /** The mounted Library destination, even before Expo commits browser history. */
  routeUrl?: string;
  onOpen(pick: EditorsPick): void;
}) {
  const [picks, setPicks] = useState<EditorsPick[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [initialRouteUrl] = useState(() =>
    typeof location === 'undefined' ? 'https://reader.invalid/manage' : location.href
  );
  const route = new URL(routeUrl ?? initialRouteUrl);
  const routeKey = catalogRouteKey(route),
    origin = route.origin;
  const retryLoad = useRef(() => {}),
    dispatchingOpen = useRef(false);
  useEffect(() => {
    let alive = true,
      pageActive = true,
      generation = 0,
      hasPicks = false,
      request: AbortController | undefined;
    const cancel = () => {
      generation++;
      request?.abort();
      request = undefined;
      if (alive) setLoading(false);
    };
    const load = async () => {
      if (!alive || !pageActive || document.visibilityState === 'hidden') return;
      if (!navigator.onLine) {
        setLoading(false);
        setError('Go online to load Editor’s Picks.');
        return;
      }
      const run = ++generation,
        operation = new AbortController();
      request?.abort();
      request = operation;
      setLoading(true);
      setError('');
      try {
        const result = await loadEditorsPicks(origin, operation.signal);
        if (alive && pageActive && run === generation && !operation.signal.aborted) {
          hasPicks = result.length > 0;
          setPicks(result);
        }
      } catch (cause) {
        if (alive && pageActive && run === generation && !operation.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'The catalog could not be loaded.');
      } finally {
        if (request === operation) request = undefined;
        if (alive && run === generation) setLoading(false);
      }
    };
    const retry = () => {
      if (alive && pageActive && navigator.onLine && !hasPicks && !request) void load();
    };
    const resume = () => {
      pageActive = true;
      retry();
    };
    const pageshow = () => {
      if (catalogRouteKey(new URL(location.href)) === routeKey) resume();
    };
    const visibility = () => (document.visibilityState === 'hidden' ? cancel() : retry());
    const offline = () => {
      cancel();
      if (alive && pageActive && !hasPicks) setError('Go online to load Editor’s Picks.');
    };
    const suspend = () => {
      pageActive = false;
      cancel();
    };
    const stopBefore = beforeNavigate((nav) => {
        // A denied navigation must leave the current catalog request alive.
        if (
          nav.willUnload ||
          !nav.to ||
          catalogRouteKey(nav.from.url) !== catalogRouteKey(nav.to.url)
        )
          nav.beforeCommit(suspend);
      }),
      stopAfter = afterNavigate((nav) => {
        // Retained route trees must not restart their catalog on another route.
        if (nav.to && catalogRouteKey(nav.to.url) === routeKey) resume();
      });
    retryLoad.current = retry;
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', pageshow);
    window.addEventListener('offline', offline);
    void load();
    return () => {
      alive = false;
      pageActive = false;
      cancel();
      retryLoad.current = () => {};
      stopBefore();
      stopAfter();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('offline', offline);
    };
  }, [routeKey, origin]);

  const open = (pick: EditorsPick) => {
    if (openingId || dispatchingOpen.current) return;
    // The controller owns the operation. Also reject repeated activation in the
    // same event turn, before its openingId update has reached this component.
    dispatchingOpen.current = true;
    try {
      onOpen(pick);
    } finally {
      queueMicrotask(() => {
        dispatchingOpen.current = false;
      });
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className={
        embedded
          ? 'editors-picks rounded-2xl border border-border/70 bg-muted/30 p-[16px] text-left sm:p-5'
          : 'editors-picks text-left'
      }
    >
      <div className="mb-3">
        <h3 id={headingId} className="text-base font-semibold">
          Editor's Picks
        </h3>
      </div>
      {loading ? (
        <p role="status" className="py-6 text-sm text-muted-foreground">
          Loading books…
        </p>
      ) : error ? (
        <div role="status" className="py-4 text-sm">
          <p>Editor's Picks are unavailable right now.</p>
          <Button variant="outline" className="mt-3" onClick={() => retryLoad.current()}>
            Try Again
          </Button>
        </div>
      ) : !picks.length ? (
        <p className="py-6 text-sm text-muted-foreground">No books are listed right now.</p>
      ) : (
        <div
          aria-label="Editor's Picks books"
          role="region"
          tabIndex={0}
          className={
            embedded
              ? 'max-h-[min(34rem,55dvh)] overflow-y-auto overscroll-contain pr-1'
              : 'max-h-[min(34rem,60dvh)] overflow-y-auto overscroll-contain pr-1'
          }
        >
          <div className="grid gap-3">
            {picks.map((pick) => (
              <article
                key={pick.id}
                className="flex min-w-0 flex-wrap gap-[12px] rounded-xl border border-border/60 bg-background p-[12px]"
              >
                <div className="flex h-[112px] w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted shadow-sm">
                  {pick.coverUrl ? (
                    <img
                      src={pick.coverUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <BookOpen className="size-8 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
                <div className="flex min-w-0 flex-[1_1_8rem] flex-col items-start">
                  <h4 className="line-clamp-2 w-full text-sm leading-snug font-semibold">
                    {pick.title}
                  </h4>
                  {pick.author && (
                    <p className="mt-1 text-xs text-muted-foreground">{pick.author}</p>
                  )}
                  {pick.summary && (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {pick.summary}
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-auto min-h-11 self-end px-4"
                    disabled={!!openingId && openingId !== pick.id}
                    aria-busy={openingId === pick.id}
                    aria-disabled={openingId === pick.id}
                    onClick={() => open(pick)}
                  >
                    {openingId === pick.id ? 'Opening…' : 'Open'}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
