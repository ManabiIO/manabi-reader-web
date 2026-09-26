/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase } from 'idb';
import type BooksDb from './versions/books-db';
import type { StoredBookData } from './versions/books-db';
import { commitTransaction } from './commit-transaction.mjs';
import { throwIfAborted } from '$lib/functions/replication/replication-error';
import { uniqueSharedCopy } from '$lib/manabi/shared-title-selection';

export type BookSummary = Pick<
  StoredBookData,
  | 'id'
  | 'title'
  | 'coverImage'
  | 'creators'
  | 'characters'
  | 'sections'
  | 'lastBookModified'
  | 'lastBookOpen'
  | 'pageDirection'
  | 'contentHash'
> & { isPlaceholder: boolean };

function summarizeBook(book: StoredBookData): BookSummary {
  return {
    id: book.id,
    title: book.title,
    coverImage: book.coverImage,
    creators: book.creators,
    characters: book.characters,
    sections: book.sections,
    lastBookModified: book.lastBookModified,
    lastBookOpen: book.lastBookOpen,
    pageDirection: book.pageDirection,
    contentHash: book.contentHash,
    isPlaceholder: !book.elementHtml
  };
}

/** ArrayBuffer resources are eagerly cloned by IndexedDB. A getAll('data')
 * would retain every book's bytes just to display the Library. Project each
 * cursor value immediately and keep only card metadata and covers.
 */
export async function readBookSummaries(db: IDBPDatabase<BooksDb>): Promise<BookSummary[]> {
  const tx = db.transaction('data');
  return commitTransaction(tx, async () => {
    const summaries: BookSummary[] = [];
    let cursor = await tx.store.openCursor();
    while (cursor) {
      summaries.push(summarizeBook(cursor.value));
      cursor = await cursor.continue();
    }
    return summaries;
  });
}

/** A last-read update is not a content replacement. Read and update the latest
 * record in one transaction, preserving byte records, import receipts and any
 * newer content. Never recreate a deleted book from an old Reader snapshot.
 * Legacy native Blobs are preserved here; content saves perform conversion.
 */
export async function updateBookLastRead(
  db: IDBPDatabase<BooksDb>,
  id: number,
  timestamp: number
): Promise<BookSummary | undefined> {
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(timestamp) || timestamp < 0)
    throw new Error('The book’s last-read update is invalid.');
  const tx = db.transaction('data', 'readwrite');
  return commitTransaction(tx, async () => {
    const current = await tx.store.get(id);
    if (!current) return undefined;
    const previous = current.lastBookOpen;
    const lastBookOpen = Math.max(
      typeof previous === 'number' && Number.isFinite(previous) ? previous : 0,
      timestamp
    );
    if (lastBookOpen === previous) return summarizeBook(current);
    const updated = { ...current, lastBookOpen };
    await tx.store.put(updated);
    return summarizeBook(updated);
  });
}

/** Local opening may detach a legacy source marker, but is never an import or
 * content replacement. Preserve the exact selected ID and stored byte records.
 * Title-only compatibility callers must have exactly one local candidate.
 */
export async function prepareBookForLocalReading(
  db: IDBPDatabase<BooksDb>,
  context: { id?: number; title: string },
  signal?: AbortSignal
): Promise<number> {
  throwIfAborted(signal);
  const { id, title } = context;
  if (id !== undefined && id !== 0 && (!Number.isSafeInteger(id) || id < 1))
    throw new Error('The selected book is not a valid local book.');
  const tx = db.transaction('data', 'readwrite');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      // A completed transaction cannot be undone by a later cancellation.
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await commitTransaction(tx, async () => {
      throwIfAborted(signal);
      const selected =
        id || uniqueSharedCopy(title, await tx.store.index('title').getAllKeys(title, 2));
      const book = selected === undefined ? undefined : await tx.store.get(selected);
      if (!book) throw new Error('No local book data found');
      if (!book.elementHtml)
        throw new Error(
          `Placeholder books should be opened from their original source${
            book.storageSource ? ` - last source: ${book.storageSource}` : ''
          }`
        );
      throwIfAborted(signal);
      if (book.storageSource) await tx.store.put({ ...book, storageSource: undefined });
      return book.id;
    });
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
