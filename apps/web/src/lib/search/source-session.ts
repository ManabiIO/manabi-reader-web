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
   * Streaming sources publish busy:false when their results are complete.
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
  const cleanups = new Set<Cleanup>();
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
    for (const cleanup of cleanups) retire(cleanup);
    cleanups.clear();
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
    if (!current()) return;
    receive({
      state: batches.some((batch) => batch.busy) ? 'loading' : 'ready',
      value: {
        rows: interleave(batches.map((batch) => batch.rows)),
        failed: batches.reduce((sum, batch) => sum + batch.failed, 0),
        truncated: batches.some((batch) => batch.truncated)
      }
    });
  };
  const failed = (index: number) => {
    if (!current() || rejected[index]) return;
    rejected[index] = true;
    batches[index] = { ...batches[index], busy: false, failed: batches[index].failed + 1 };
    publish();
  };
  const admitted = (cleanup: void | Cleanup) => {
    if (!cleanup) return;
    if (stopped) retire(cleanup);
    else cleanups.add(cleanup);
  };
  publish();
  sources.forEach((source, index) => {
    if (!current()) return;
    try {
      const cleanup = source.start(active.signal, (batch) => {
        if (!current() || rejected[index]) return;
        batches[index] = {
          rows: [...batch.rows],
          busy: batch.busy,
          failed: batch.failed,
          truncated: batch.truncated
        };
        publish();
      });
      if (typeof cleanup === 'function') admitted(cleanup);
      else if (cleanup) void Promise.resolve(cleanup).then(admitted, () => failed(index));
    } catch {
      failed(index);
    }
  });
  return stop;
}
