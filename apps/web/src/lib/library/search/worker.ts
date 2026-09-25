/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/// <reference lib="webworker" />

import { openDB, type IDBPDatabase } from 'idb';
import type BooksDb from '../../data/database/books-db/versions/books-db';
import { projectStoredBook } from './projection';
import { digest } from './digest';
import { TextCache, searchIndexVersion } from './cache';
import { findText, maxQueryPoints } from './text';
import type { ContentHit, SearchReply, SearchRequest } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const maxBookHits = 20,
  maxTotalHits = 500;
let current = 0;
const reply = (message: SearchReply) => scope.postMessage(message);
async function search(request: SearchRequest) {
  const { id, query, books } = request;
  if (
    !Number.isSafeInteger(id) ||
    !query.trim() ||
    [...query].length > maxQueryPoints ||
    !Array.isArray(books) ||
    books.length > 50000
  )
    throw new Error('Invalid Library search request.');
  const cancelled = () => id !== current;
  let db: IDBPDatabase<BooksDb> | undefined;
  const cache = new TextCache();
  let scanned = 0,
    failed = 0,
    found = 0,
    truncated = false;
  try {
    // Open the already-initialized database read-only. Never initialize or migrate it in a worker.
    db = await openDB<BooksDb>(request.database.name, request.database.version, {
      upgrade(_db, _old, _next, tx) {
        tx.abort();
      },
      blocking() {
        db?.close();
      }
    });
    await cache.open();
    const seen = new Set<number>();
    for (const target of books) {
      if (cancelled()) return;
      if (!Number.isSafeInteger(target.id) || target.id <= 0 || seen.has(target.id)) continue;
      seen.add(target.id);
      try {
        const tx = db.transaction(['data', 'readerBookScope'], 'readonly');
        const [book, owner] = await Promise.all([
          tx.objectStore('data').get(target.id),
          tx.objectStore('readerBookScope').get(target.id)
        ]);
        await tx.done;
        if (cancelled()) return;
        if (
          !book ||
          (owner?.accountId && owner.accountId !== request.viewer) ||
          (target.contentHash && book.contentHash !== target.contentHash)
        ) {
          failed++;
          continue;
        }
        const signature = await digest(
          JSON.stringify([searchIndexVersion, book.elementHtml, book.publicationManifest ?? null])
        );
        if (cancelled()) return;
        const key = JSON.stringify([request.database.name, request.viewer, target.id]);
        let resources = await cache.get(key, signature);
        if (!resources) {
          resources = await projectStoredBook(book.elementHtml, book.publicationManifest);
          if (cancelled()) return;
          await cache.put(key, signature, resources);
        }
        const hits: ContentHit[] = [];
        let more = false;
        outer: for (const resource of resources) {
          for await (const match of findText(resource.text, query, cancelled)) {
            if (cancelled()) return;
            if (hits.length >= maxBookHits || found >= maxTotalHits) {
              more = true;
              break outer;
            }
            hits.push({
              ...match,
              bookId: target.id,
              signature,
              resource: resource.resource,
              resourceDigest: resource.digest
            });
            found++;
          }
        }
        if (cancelled()) return;
        if (hits.length) reply({ type: 'book', id, bookId: target.id, hits, truncated: more });
        if (found >= maxTotalHits) {
          truncated = true;
          break;
        }
      } catch {
        failed++;
      } finally {
        scanned++;
        if (!cancelled())
          reply({
            type: 'progress',
            id,
            scanned,
            total: books.length,
            failed,
            cacheUnavailable: cache.unavailable
          });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!cancelled()) reply({ type: 'done', id, truncated });
  } finally {
    cache.close();
    db?.close();
  }
}
scope.onmessage = (event: MessageEvent<SearchRequest | { type: 'cancel'; id: number }>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    if (request.id === current) current++;
    return;
  }
  current = request.id;
  void search(request).catch(() => {
    if (request.id === current)
      reply({
        type: 'error',
        id: request.id,
        message: 'Content search could not finish. Please retry.'
      });
  });
};
