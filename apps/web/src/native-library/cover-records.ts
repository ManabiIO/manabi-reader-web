/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase } from 'idb';
import type BooksDb from '../lib/data/database/books-db/versions/books-db';
import type { BookSummary } from '../lib/data/database/books-db/book-records';
import { commitTransaction } from '../lib/data/database/books-db/commit-transaction.mjs';
import type { LibraryAuthority } from './contract';

/** Capture covers and existing canonical identities in the same readonly snapshot.
 * Do not mint UUIDs or retain book content just to render Library thumbnails. */
export async function readNativeLibrarySummaries(
  db: IDBPDatabase<BooksDb>,
  authority: LibraryAuthority
): Promise<{ summaries: BookSummary[]; coverIdentities: Record<number, string> }> {
  const check = () => {
    authority.signal.throwIfAborted();
    authority.assertCurrent();
  };
  check();
  const tx = db.transaction(['data', 'readerLocalIdentity'], 'readonly');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  authority.signal.addEventListener('abort', abort, { once: true });
  try {
    const result = await commitTransaction(tx, async () => {
      const summaries: BookSummary[] = [];
      const coverIdentities: Record<number, string> = {};
      let cursor = await tx.objectStore('data').openCursor();
      while (cursor) {
        check();
        const book = cursor.value;
        const local = await tx.objectStore('readerLocalIdentity').get(book.id);
        check();
        if (book.contentHash && /^[a-f0-9]{64}$/i.test(book.contentHash))
          coverIdentities[book.id] = `content:${book.contentHash.toLowerCase()}`;
        else if (local?.bookId === book.id && /^[a-f0-9-]{36}$/.test(local.uuid))
          coverIdentities[book.id] = `local:${local.uuid}`;
        summaries.push({
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
        });
        cursor = await cursor.continue();
      }
      return { summaries, coverIdentities };
    });
    check();
    return result;
  } finally {
    authority.signal.removeEventListener('abort', abort);
  }
}
