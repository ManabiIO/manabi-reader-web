/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase } from 'idb';
import type BooksDb from './versions/books-db';
import type { StoredBookData } from './versions/books-db';
import { commitTransaction } from './commit-transaction.mjs';

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
