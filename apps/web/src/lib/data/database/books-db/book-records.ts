/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase } from 'idb';
import type BooksDb from './versions/books-db';
import type { BooksDbBookmarkData, StoredBookData } from './versions/books-db';
import { commitTransaction } from './commit-transaction.mjs';
import { uniqueSharedCopy } from '../../../manabi/shared-title-selection.ts';
import { mergeCompletion } from '../../../library/completion.ts';

export type BookSummary = Pick<
  StoredBookData,
  | 'id'
  | 'title'
  | 'coverImage'
  | 'creators'
  | 'metadata'
  | 'characters'
  | 'sections'
  | 'lastBookModified'
  | 'lastBookOpen'
  | 'pageDirection'
  | 'contentHash'
  | 'libraryOwner'
> & { isPlaceholder: boolean };

export function snapshotBookmarkData(
  bookmark: BooksDbBookmarkData,
  dataId = bookmark.dataId
): BooksDbBookmarkData {
  if (!Number.isSafeInteger(dataId) || dataId <= 0)
    throw new Error('The bookmark target is invalid.');
  return structuredClone({ ...bookmark, dataId });
}

export function assertBookPersonalAccess(
  book: Pick<StoredBookData, 'libraryOwner'>,
  readerScope: { accountId: string } | undefined,
  profileId: string | null
): void {
  if (
    (book.libraryOwner !== undefined && book.libraryOwner !== profileId) ||
    (readerScope && readerScope.accountId !== profileId)
  )
    throw new Error('This book belongs to another account.');
}

export async function readOwnedLastItem(
  db: IDBPDatabase<BooksDb>,
  profileId: string | null,
  assertCurrent: () => void = () => undefined
): Promise<{ dataId: number } | undefined> {
  assertCurrent();
  const tx = db.transaction(['data', 'readerBookScope', 'lastItem']);
  return commitTransaction(tx, async () => {
    assertCurrent();
    const item = await tx.objectStore('lastItem').get(0);
    if (!item) return undefined;
    const book = await tx.objectStore('data').get(item.dataId);
    if (!book) return undefined;
    const owner = await tx.objectStore('readerBookScope').get(item.dataId);
    assertCurrent();
    try {
      assertBookPersonalAccess(book, owner, profileId);
    } catch {
      // Keep another profile's pointer intact; it simply is not resumable by
      // the current profile.
      return undefined;
    }
    return item;
  });
}

export async function commitOwnedLastItem(
  db: IDBPDatabase<BooksDb>,
  dataId: number,
  profileId: string | null = null,
  assertCurrent: () => void = () => undefined,
  signal?: AbortSignal,
  authoritySignal?: AbortSignal
) {
  if (!Number.isSafeInteger(dataId) || dataId <= 0)
    throw new Error('The selected book is not a valid local book.');
  assertCurrent();
  signal?.throwIfAborted();
  authoritySignal?.throwIfAborted();
  const tx = db.transaction(['data', 'readerBookScope', 'lastItem'], 'readwrite');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  authoritySignal?.addEventListener('abort', abort, { once: true });
  try {
    return await commitTransaction(tx, async () => {
      assertCurrent();
      signal?.throwIfAborted();
      authoritySignal?.throwIfAborted();
      const book = await tx.objectStore('data').get(dataId);
      if (!book)
        throw new Error('The selected book was removed. Refresh the Library and try again.');
      const owner = await tx.objectStore('readerBookScope').get(dataId);
      assertBookPersonalAccess(book, owner, profileId);
      assertCurrent();
      signal?.throwIfAborted();
      authoritySignal?.throwIfAborted();
      return tx.objectStore('lastItem').put({ dataId }, 0);
    });
  } finally {
    signal?.removeEventListener('abort', abort);
    authoritySignal?.removeEventListener('abort', abort);
  }
}

export async function readOwnedBookmark(
  db: IDBPDatabase<BooksDb>,
  dataId: number,
  profileId: string | null,
  assertCurrent: () => void
): Promise<BooksDbBookmarkData | undefined> {
  assertCurrent();
  const tx = db.transaction(['data', 'bookmark', 'readerBookScope']);
  return commitTransaction(tx, async () => {
    assertCurrent();
    const book = await tx.objectStore('data').get(dataId);
    if (!book) return undefined;
    const owner = await tx.objectStore('readerBookScope').get(dataId);
    assertCurrent();
    if (book.libraryOwner !== undefined && book.libraryOwner !== profileId)
      throw new Error('This book belongs to another account.');
    // Personal scope protects the reading state, not otherwise-public local bytes.
    if (owner && owner.accountId !== profileId) return undefined;
    const bookmark = await tx.objectStore('bookmark').get(dataId);
    assertCurrent();
    return bookmark;
  });
}

export async function commitOwnedBookmark(
  db: IDBPDatabase<BooksDb>,
  snapshot: BooksDbBookmarkData,
  profileId: string | null = null,
  assertCurrent: () => void = () => undefined,
  signal?: AbortSignal
) {
  assertCurrent();
  signal?.throwIfAborted();
  const tx = db.transaction(['data', 'bookmark', 'readerBookScope'], 'readwrite');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await commitTransaction(tx, async () => {
      assertCurrent();
      signal?.throwIfAborted();
      const book = await tx.objectStore('data').get(snapshot.dataId);
      if (!book) throw new Error('This book is no longer in the library.');
      const owner = await tx.objectStore('readerBookScope').get(snapshot.dataId);
      assertBookPersonalAccess(book, owner, profileId);
      const bookmarks = tx.objectStore('bookmark');
      const before = await bookmarks.get(snapshot.dataId);
      assertCurrent();
      signal?.throwIfAborted();
      return bookmarks.put(mergeCompletion(before, snapshot));
    });
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

function summarizeBook(book: StoredBookData): BookSummary {
  return {
    id: book.id,
    title: book.title,
    coverImage: book.coverImage,
    creators: book.creators,
    metadata: book.metadata,
    characters: book.characters,
    sections: book.sections,
    lastBookModified: book.lastBookModified,
    lastBookOpen: book.lastBookOpen,
    pageDirection: book.pageDirection,
    contentHash: book.contentHash,
    libraryOwner: book.libraryOwner,
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
  timestamp: number,
  profileId: string | null = null,
  assertCurrent: () => void = () => undefined,
  signal?: AbortSignal
): Promise<BookSummary | undefined> {
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(timestamp) || timestamp < 0)
    throw new Error('The book’s last-read update is invalid.');
  assertCurrent();
  signal?.throwIfAborted();
  const tx = db.transaction(['data', 'readerBookScope'], 'readwrite');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await commitTransaction(tx, async () => {
      assertCurrent();
      signal?.throwIfAborted();
      const data = tx.objectStore('data');
      const current = await data.get(id);
      if (!current) return undefined;
      const owner = await tx.objectStore('readerBookScope').get(id);
      if (current.libraryOwner !== undefined && current.libraryOwner !== profileId)
        throw new Error('This book belongs to another account.');
      // A direct local book can remain readable across profiles, but its prior
      // profile's recency is personal state and must not be overwritten.
      if (owner && owner.accountId !== profileId) return summarizeBook(current);
      const previous = current.lastBookOpen;
      const lastBookOpen = Math.max(
        typeof previous === 'number' && Number.isFinite(previous) ? previous : 0,
        timestamp
      );
      if (lastBookOpen === previous) return summarizeBook(current);
      const updated = { ...current, lastBookOpen };
      assertCurrent();
      signal?.throwIfAborted();
      await data.put(updated);
      return summarizeBook(updated);
    });
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

/** Local opening may detach a legacy source marker, but is never an import or
 * content replacement. Preserve the exact selected ID and stored byte records.
 * Title-only compatibility callers must have exactly one local candidate.
 */
export async function prepareBookForLocalReading(
  db: IDBPDatabase<BooksDb>,
  context: { id?: number; title: string },
  signal?: AbortSignal,
  profileId: string | null = null,
  assertCurrent: () => void = () => undefined,
  authoritySignal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  authoritySignal?.throwIfAborted();
  assertCurrent();
  const { id, title } = context;
  if (id !== undefined && id !== 0 && (!Number.isSafeInteger(id) || id < 1))
    throw new Error('The selected book is not a valid local book.');
  const tx = db.transaction(['data', 'readerBookScope'], 'readwrite');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      // A completed transaction cannot be undone by a later cancellation.
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  authoritySignal?.addEventListener('abort', abort, { once: true });
  try {
    return await commitTransaction(tx, async () => {
      signal?.throwIfAborted();
      authoritySignal?.throwIfAborted();
      assertCurrent();
      const data = tx.objectStore('data');
      const selected =
        id || uniqueSharedCopy(title, await data.index('title').getAllKeys(title, 2));
      const book = selected === undefined ? undefined : await data.get(selected);
      if (!book) throw new Error('No local book data found');
      const owner = await tx.objectStore('readerBookScope').get(book.id);
      assertBookPersonalAccess(book, owner, profileId);
      if (!book.elementHtml)
        throw new Error(
          `Placeholder books should be opened from their original source${book.storageSource ? ` - last source: ${book.storageSource}` : ''}`
        );
      signal?.throwIfAborted();
      authoritySignal?.throwIfAborted();
      assertCurrent();
      if (book.storageSource) await data.put({ ...book, storageSource: undefined });
      return book.id;
    });
  } finally {
    signal?.removeEventListener('abort', abort);
    authoritySignal?.removeEventListener('abort', abort);
  }
}
