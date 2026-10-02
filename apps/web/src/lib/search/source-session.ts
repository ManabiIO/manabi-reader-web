/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { SearchState } from './query-task.mjs';

export interface SearchResults<T> {
  rows: T[];
  failed: number;
  truncated: boolean;
}

export interface SourceBatch<T> extends SearchResults<T> {
  busy: boolean;
}

type Cleanup = () => void;
export interface SearchSource<T> {
  /** Returning a cleanup means admission finished, not that the search finished.
   * Streaming sources publish busy:false exactly once when their results are complete.
   * The session may run the cleanup immediately after that terminal publication.
   */
  start(
    signal: AbortSignal,
    receive: (batch: SourceBatch<T>) => void
  ): void | Cleanup | Promise<void | Cleanup>;
}

function interleave<T>(groups: readonly (readonly T[])[]): T[] {
  const rows: T[] = [];
  const length = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < length; index++)
    for (const group of groups) if (index < group.length) rows.push(group[index]);
  return rows;
}

/** One query owns all source admission, partial results and resource retirement.
 * Sources start independently; a slow book descriptor cannot delay video or
 * snippet results. Source order determines the stable, interleaved display order.
 */
export function startSearchSources<T>(
  sources: readonly SearchSource<T>[],
  signal: AbortSignal,
  receive: (state: SearchState<SearchResults<T>>) => void,
  guard: () => void = () => signal.throwIfAborted()
): Cleanup {
  signal.throwIfAborted();
  guard();
  const active = new AbortController();
  const batches: SourceBatch<T>[] = sources.map(() => ({
    rows: [],
    busy: true,
    failed: 0,
    truncated: false
  }));
  const cleanups: (Cleanup | undefined)[] = sources.map(() => undefined);
  const completed = sources.map(() => false);
  const rejected = sources.map(() => false);
  let stopped = false;
  const retire = (cleanup: Cleanup) => {
    try {
      cleanup();
    } catch {
      // A failed retirement must not leak the other sources' workers.
    }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    signal.removeEventListener('abort', stop);
    active.abort();
    for (let index = 0; index < cleanups.length; index++) {
      const cleanup = cleanups[index];
      cleanups[index] = undefined;
      if (cleanup) retire(cleanup);
    }
  };
  signal.addEventListener('abort', stop, { once: true });
  const current = () => {
    if (stopped) return false;
    try {
      signal.throwIfAborted();
      guard();
      return true;
    } catch {
      stop();
      return false;
    }
  };
  const publish = () => {
    if (!current()) return false;
    try {
      receive({
        state: batches.some((batch) => batch.busy) ? 'loading' : 'ready',
        value: {
          rows: interleave(batches.map((batch) => batch.rows)),
          failed: batches.reduce((sum, batch) => sum + batch.failed, 0),
          truncated: batches.some((batch) => batch.truncated)
        }
      });
      return true;
    } catch {
      stop();
      return false;
    }
  };
  const retireSource = (index: number) => {
    const cleanup = cleanups[index];
    cleanups[index] = undefined;
    if (cleanup) retire(cleanup);
  };
  const failed = (index: number) => {
    if (!current() || rejected[index] || completed[index]) return;
    rejected[index] = true;
    completed[index] = true;
    batches[index] = { ...batches[index], busy: false, failed: batches[index].failed + 1 };
    publish();
    retireSource(index);
  };
  const admitted = (index: number, cleanup: void | Cleanup) => {
    if (!cleanup) return;
    if (stopped || completed[index] || rejected[index]) retire(cleanup);
    else cleanups[index] = cleanup;
  };
  if (!publish()) return stop;
  sources.forEach((source, index) => {
    if (!current()) return;
    try {
      const cleanup = source.start(active.signal, (batch) => {
        if (!current() || rejected[index] || completed[index]) return;
        batches[index] = {
          rows: [...batch.rows],
          busy: batch.busy,
          failed: batch.failed,
          truncated: batch.truncated
        };
        if (!batch.busy) completed[index] = true;
        const published = publish();
        if (completed[index]) retireSource(index);
        if (!published) return;
      });
      if (typeof cleanup === 'function') admitted(index, cleanup);
      else if (cleanup)
        void Promise.resolve(cleanup).then(
          (value) => admitted(index, value),
          () => failed(index)
        );
    } catch {
      failed(index);
    }
  });
  return stop;
}
