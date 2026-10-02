/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { localProfileUser } from '../manabi/client';
import { readerBookKeyFor } from '../reader-identity';
import type { ShelfBook } from '../library/view-model';
import type { ContentHit } from '../library/content-search';
export interface BookSearchBatch {
  hits: ContentHit[];
  busy: boolean;
  failed: number;
  truncated: boolean;
}
export interface BookSearchPublicationOptions {
  /** Omit progress-only batches whose visible result state did not change. */
  progress?: boolean;
}
/** Reuse the existing cached book projection and canonical locator worker. */
export async function searchBookContents(
  query: string,
  books: ShelfBook[],
  owner: string | null,
  signal: AbortSignal,
  receive: (batch: BookSearchBatch) => void,
  options: BookSearchPublicationOptions = {}
) {
  const selected = [
    ...new Map(
      books.filter((book) => book.bookId && !book.isPlaceholder).map((book) => [book.bookId, book])
    ).values()
  ];
  const guard = () => {
    signal.throwIfAborted();
    if (owner !== (localProfileUser()?.id ?? null))
      throw new DOMException('Account changed', 'AbortError');
  };
  guard();
  if (!selected.length) {
    receive({ hits: [], busy: false, failed: 0, truncated: false });
    return () => {};
  }
  const descriptors = [];
  for (const book of selected) {
    guard();
    descriptors.push({
      id: book.bookId!,
      key: await readerBookKeyFor(book.bookId!, book.contentHash)
    });
  }
  guard();
  const worker = new Worker(
    new URL('../library/library-content-search-worker.ts', import.meta.url),
    { type: 'module' }
  );
  let hits: ContentHit[] = [],
    stopped = false,
    visibleRevision = 0;
  let published = { visibleRevision: 0, busy: true, failed: 0, truncated: false };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    signal.removeEventListener('abort', stop);
  };
  const publish = (busy: boolean, failed = 0, truncated = false) => {
    if (stopped) return;
    const next = { visibleRevision, busy, failed, truncated };
    if (
      options.progress === false &&
      next.visibleRevision === published.visibleRevision &&
      next.busy === published.busy &&
      next.failed === published.failed &&
      next.truncated === published.truncated
    )
      return;
    published = next;
    try {
      guard();
      receive({ hits, busy, failed, truncated });
    } catch {
      stop();
    }
  };
  signal.addEventListener('abort', stop, { once: true });
  worker.onerror = worker.onmessageerror = () => {
    publish(false, 1);
    stop();
  };
  worker.onmessage = ({ data }) => {
    if (data.requestId !== 1 || stopped) return;
    if (data.type === 'batch') {
      if (data.hits.length) {
        hits = [...hits, ...data.hits];
        visibleRevision++;
      }
      publish(true);
    } else if (data.type === 'progress') publish(true, data.failed);
    else if (data.type === 'done') {
      publish(false, data.failed, data.truncated);
      stop();
    } else if (data.type === 'error') {
      publish(false, 1);
      stop();
    }
  };
  try {
    worker.postMessage({ type: 'search', requestId: 1, books: descriptors, owner, query });
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
