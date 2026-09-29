/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { snippetSearchTooLong, type SnippetHit } from './document';
import type { SnippetScope } from './scope';
export interface SearchBatch {
  hits: Map<string, SnippetHit[]>;
  busy: boolean;
  scanned: number;
  failed: number;
  truncated: boolean;
}
let sequence = 0;
/** A query owns its worker lifetime; late messages cannot cross an account, scope, or newer query. */
export function searchBodies(
  query: string,
  ids: string[],
  selected: SnippetScope,
  receive: (batch: SearchBatch) => void
): () => void {
  selected.guard();
  const requestId = ++sequence;
  let stopped = false;
  const hits = new Map<string, SnippetHit[]>();
  if (!query.trim() || !ids.length || snippetSearchTooLong(query)) {
    receive({ hits, busy: false, scanned: 0, failed: 0, truncated: false });
    return () => undefined;
  }
  const worker = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' });
  const fail = () => {
    if (stopped) return;
    try {
      selected.guard();
      receive({ hits: new Map(hits), busy: false, scanned: 0, failed: 1, truncated: false });
    } catch {
      /* Retain local state; the next explicit refresh can retry. */
    }
    worker.terminate();
    stopped = true;
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
      for (const item of data.batch ?? []) hits.set(item.id, item.hits);
      receive({
        hits: new Map(hits),
        busy: data.type !== 'done',
        scanned: data.scanned,
        failed: data.failed,
        truncated: !!data.truncated
      });
      if (data.type === 'done') {
        worker.terminate();
        stopped = true;
      }
    } catch {
      worker.terminate();
      stopped = true;
    }
  };
  receive({ hits: new Map(), busy: true, scanned: 0, failed: 0, truncated: false });
  worker.postMessage({ requestId, owner: selected.owner, ids, query });
  return () => {
    stopped = true;
    worker.terminate();
  };
}
