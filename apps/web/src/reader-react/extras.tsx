/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { BookmarkManager } from '$lib/components/book-reader/types';
import { pageTurnEffect$ } from '$lib/data/page-turn-preferences';
import { normalizePageTurnEffect } from '$lib/foliate-epub/page-turn-effect';
import { useStore } from '../runtime/use-store';
import type { ReaderViewProps } from './dom';
import { Icon } from './dom';
import type { AudioPanelProps } from './audio-panel-controller';

export function PageTurnEffectSelect() {
  const value = useStore(pageTurnEffect$, 'slide');
  return (
    <>
      <label className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm">
        <span>Page turn effect</span>
        <select
          aria-label="Page turn effect"
          className="min-h-11 rounded-lg border border-border bg-background px-3 text-foreground"
          value={value}
          onChange={(event) =>
            pageTurnEffect$.next(normalizePageTurnEffect(event.currentTarget.value))
          }
        >
          <option value="slide">Slide</option>
          <option value="none">None</option>
        </select>
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        Paginated EPUBs: slide over the next page, or change pages instantly. Scrolling is
        unchanged.
      </p>
    </>
  );
}

export function SearchExcerpt({
  text = '',
  match
}: {
  text?: string;
  match?: { start: number; end: number };
}) {
  const valid =
    match &&
    Number.isInteger(match.start) &&
    Number.isInteger(match.end) &&
    match.start >= 0 &&
    match.end > match.start &&
    match.end <= text.length;
  return (
    <bdi
      dir="auto"
      data-search-excerpt
      style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
    >
      {valid && match ? (
        <>
          {text.slice(0, match.start)}
          <mark>{text.slice(match.start, match.end)}</mark>
          {text.slice(match.end)}
        </>
      ) : (
        text
      )}
    </bdi>
  );
}

export function AudiobookLauncher(props: {
  bookId: number;
  bookTitle: string;
  htmlContent: string;
  layoutKey: string | number;
  bookmarkManager?: BookmarkManager;
  onFollow(): void;
}) {
  const [Panel, setPanel] =
    useState<React.ComponentType<Partial<AudioPanelProps> & ReaderViewProps>>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selectionHint, setSelectionHint] = useState<Range>();
  const alive = useRef(true);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function show() {
    if (loading) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
    const root = document.querySelector('.book-content');
    if (range && !range.collapsed && root?.contains(range.startContainer))
      setSelectionHint(range.cloneRange());
    if (Panel) {
      setOpen(true);
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      const module = await import('./audio-panel');
      if (!alive.current) return;
      setPanel(() => module.AudiobookPanel);
      setOpen(true);
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="flex size-11 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={loading ? 'Loading audio…' : failed ? 'Retry audiobook' : 'Audiobook'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={loading}
        disabled={loading}
        onClick={() => void show()}
        title={
          failed
            ? 'Could not load the audiobook player. Select to retry.'
            : 'Local audiobook and subtitle playback'
        }
      >
        <Icon name={loading ? 'faSpinner' : 'Headphones'} />
      </button>
      {failed && (
        <span className="sr-only" role="alert">
          The audiobook player could not be loaded. Try again.
        </span>
      )}
      {Panel && (
        <Panel
          {...props}
          open={open}
          selectionHint={selectionHint}
          returnFocus={() => trigger.current?.focus()}
          bindings={{ open: setOpen, selectionHint: setSelectionHint }}
        />
      )}
    </>
  );
}
