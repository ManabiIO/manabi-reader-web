/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { openDB } from 'idb';
import {
  findContent,
  indexVersion,
  projectSearchBook,
  searchDigest,
  type SearchBook,
  type SearchResource
} from './content-search';

interface SearchRequest {
  type: 'search';
  requestId: number;
  query: string;
  books: SearchBook[];
  owner: string | null;
}
let latest = 0;
let pending: SearchRequest | undefined;
let running = false;
self.onmessage = (event: MessageEvent<SearchRequest | { type: 'cancel'; requestId: number }>) => {
  latest = event.data.requestId;
  pending = event.data.type === 'search' ? event.data : undefined;
  if (!running) void pump();
};
async function pump() {
  running = true;
  try {
    while (pending) {
      const request = pending;
      pending = undefined;
      try {
        await search(request);
      } catch {
        if (request.requestId === latest) self.postMessage({ type: 'error', requestId: latest });
      }
    }
  } finally {
    running = false;
  }
}
async function search(request: SearchRequest) {
  const cancelled = () => request.requestId !== latest;
  const emit = (message: Record<string, unknown>) => {
    if (!cancelled()) self.postMessage({ ...message, requestId: request.requestId });
  };
  const db = await openDB('books', undefined, {
    upgrade(db, _old, _new, tx) {
      tx.abort();
    },
    blocking() {
      db.close();
    }
  });
  let scanned = 0,
    failed = 0,
    total = 0,
    truncated = false;
  try {
    const ids = new Set<number>();
    for (const descriptor of request.books) {
      if (cancelled()) return;
      if (!Number.isSafeInteger(descriptor.id) || descriptor.id < 1 || ids.has(descriptor.id))
        continue;
      ids.add(descriptor.id);
      try {
        const tx = db.transaction(['data', 'readerBookScope', 'readerLocalIdentity'], 'readonly');
        const [book, scope, identity] = await Promise.all([
          tx.objectStore('data').get(descriptor.id),
          tx.objectStore('readerBookScope').get(descriptor.id),
          tx.objectStore('readerLocalIdentity').get(descriptor.id)
        ]);
        await tx.done;
        if (!book || (scope && scope.accountId !== request.owner)) continue;
        const actualKey = book.contentHash
          ? `content:${book.contentHash.toLowerCase()}`
          : `local:${identity?.uuid}`;
        if (actualKey !== descriptor.key || typeof book.elementHtml !== 'string') continue;
        if (book.elementHtml.length > 32 * 1024 * 1024) throw new Error('Large book');
        // Hash canonical input each time: modification timestamps are not integrity checks.
        const source = await searchDigest(
          JSON.stringify([indexVersion, book.elementHtml, book.publicationManifest ?? null])
        );
        if (cancelled()) return;
        const key = descriptor.id;
        let resources: SearchResource[] | undefined;
        try {
          const stored = await db.get('readerSearchProjection', key);
          if (stored?.source === source) resources = stored.resources;
        } catch {
          /* Rebuild a damaged/evicted cache. */
        }
        if (!resources) {
          resources = projectSearchBook(book.elementHtml, book.publicationManifest);
          if (cancelled()) return;
          try {
            // Cache lifetime is atomic with source deletion, including a
            // delete that arrives while this worker was indexing.
            const save = db.transaction(
              ['data', 'readerBookScope', 'readerSearchProjection'],
              'readwrite'
            );
            const [present, presentScope] = await Promise.all([
              save.objectStore('data').get(key),
              save.objectStore('readerBookScope').get(key)
            ]);
            if (
              present?.elementHtml === book.elementHtml &&
              JSON.stringify(present.publicationManifest ?? null) ===
                JSON.stringify(book.publicationManifest ?? null) &&
              (!presentScope || presentScope.accountId === request.owner)
            ) {
              await save
                .objectStore('readerSearchProjection')
                .put({ bookId: key, source, resources });
            }
            await save.done;
          } catch {
            /* Optional cache only. */
          }
        }
        const result = await findContent(
          resources,
          request.query,
          descriptor,
          cancelled,
          Math.min(24, 300 - total)
        );
        if (cancelled()) return;
        total += result.hits.length;
        truncated ||= result.truncated;
        if (result.hits.length) emit({ type: 'batch', hits: result.hits });
      } catch {
        failed++;
      }
      scanned++;
      emit({ type: 'progress', scanned, failed });
      if (total >= 300) {
        truncated = true;
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    emit({ type: 'done', scanned, failed, total, truncated });
  } finally {
    db.close();
  }
}
