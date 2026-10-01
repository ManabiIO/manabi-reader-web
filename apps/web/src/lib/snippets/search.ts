/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { snippetSearchTooLong, type SnippetHit } from './document.ts';
import type { SnippetScope } from './scope';
export interface SearchBatch {
  hits: Map<string, SnippetHit[]>;
  busy: boolean;
  scanned: number;
  failed: number;
  truncated: boolean;
}
export interface SearchPublicationOptions {
  /** Omit scan-progress batches whose visible result state did not change. */
  progress?: boolean;
}
let sequence = 0;
/** A query owns its worker lifetime; late messages cannot cross an account, scope, or newer query. */
export function searchBodies(
  query: string,
  ids: string[],
  selected: SnippetScope,
  receive: (batch: SearchBatch) => void,
  options: SearchPublicationOptions = {}
): () => void {
  selected.guard();
  const requestId = ++sequence;
  let stopped = false;
  const hits = new Map<string, SnippetHit[]>();
  let visibleRevision = 0;
  let published = { visibleRevision: 0, busy: true, failed: 0, truncated: false };
  if (!query.trim() || !ids.length || snippetSearchTooLong(query)) {
    receive({ hits, busy: false, scanned: 0, failed: 0, truncated: false });
    return () => undefined;
  }
  const worker = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
  };
  const publish = (
    busy: boolean,
    scanned: number,
    failed: number,
    truncated: boolean,
    force = false
  ) => {
    const next = { visibleRevision, busy, failed, truncated };
    if (
      !force &&
      options.progress === false &&
      next.visibleRevision === published.visibleRevision &&
      next.busy === published.busy &&
      next.failed === published.failed &&
      next.truncated === published.truncated
    )
      return;
    published = next;
    receive({ hits: new Map(hits), busy, scanned, failed, truncated });
  };
  const fail = () => {
    if (stopped) return;
    try {
      selected.guard();
      publish(false, 0, 1, false, true);
    } catch {
      /* Retain local state; the next explicit refresh can retry. */
    }
    stop();
  };
  worker.onerror = fail;
  worker.onmessageerror = fail;
  worker.onmessage = ({ data }) => {
    if (stopped || data.requestId !== requestId) return;
    try {
      selected.guard();
      if (data.type === 'error') {
        fail();
        return;
      }
      if (data.batch?.length) {
        for (const item of data.batch) hits.set(item.id, item.hits);
        visibleRevision++;
      }
      publish(
        data.type !== 'done',
        data.scanned,
        data.failed,
        !!data.truncated,
        data.type === 'done'
      );
      if (data.type === 'done') stop();
    } catch {
      stop();
    }
  };
  try {
    publish(true, 0, 0, false, true);
    worker.postMessage({ requestId, owner: selected.owner, ids, query });
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
