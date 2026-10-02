/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useRef, useState } from 'react';
import { loadEditorsPicks, type EditorsPick } from '$lib/library/editors-picks';
import { beforeNavigate, afterNavigate } from '$app/navigation';
import { Button } from './primitives';
export function EditorsPicks({
  openingId = '',
  headingId = 'editors-picks-heading',
  embedded = false,
  onOpen
}: {
  openingId?: string;
  headingId?: string;
  embedded?: boolean;
  onOpen(pick: EditorsPick): void;
}) {
  const [picks, setPicks] = useState<EditorsPick[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const picksRef = useRef(picks);
  picksRef.current = picks;
  useEffect(() => {
    let alive = true,
      pageActive = true,
      generation = 0,
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
      cancel();
      const run = ++generation,
        operation = new AbortController();
      request = operation;
      setLoading(true);
      setError('');
      try {
        const result = await loadEditorsPicks(location.origin, operation.signal);
        if (alive && run === generation && !operation.signal.aborted) setPicks(result);
      } catch (cause) {
        if (alive && !operation.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not load Editor’s Picks.');
      } finally {
        if (alive && run === generation) {
          request = undefined;
          setLoading(false);
        }
      }
    };
    const resume = () => {
      pageActive = true;
      if (!picksRef.current.length && !request) void load();
    };
    const visibility = () => (document.visibilityState === 'hidden' ? cancel() : resume());
    const offline = () => {
      cancel();
      if (!picksRef.current.length) setError('Go online to load Editor’s Picks.');
    };
    const suspend = () => {
      pageActive = false;
      cancel();
    };
    const stopBefore = beforeNavigate((nav) => {
        if (nav.willUnload || nav.from.url.pathname !== nav.to?.url.pathname) suspend();
      }),
      stopAfter = afterNavigate(resume);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', resume);
    window.addEventListener('offline', offline);
    window.addEventListener('online', resume);
    void load();
    return () => {
      alive = false;
      cancel();
      stopBefore();
      stopAfter();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', resume);
    };
  }, [attempt]);
  return (
    <section
      aria-labelledby={headingId}
      className={embedded ? 'editors-picks embedded' : 'editors-picks'}
    >
      <h2 id={headingId} className="text-xl font-semibold">
        Editor's Picks
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">Open a book selected by Manabi.</p>
      {loading && <p role="status">Loading books…</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
            Try again
          </Button>
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3">
        {picks.map((pick) => (
          <article key={pick.id} className="min-w-0">
            <Button
              variant="ghost"
              className="h-auto w-full flex-col text-left whitespace-normal"
              disabled={!!openingId}
              onClick={() => onOpen(pick)}
            >
              {pick.coverUrl && (
                <img
                  className="aspect-[2/3] w-full rounded object-contain"
                  src={pick.coverUrl}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              )}
              <strong>{pick.title}</strong>
              <span className="text-xs text-muted-foreground">{pick.author}</span>
              <span>{openingId === pick.id ? 'Opening…' : 'Read book'}</span>
            </Button>
            {pick.summary && <p className="mt-1 text-xs text-muted-foreground">{pick.summary}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
