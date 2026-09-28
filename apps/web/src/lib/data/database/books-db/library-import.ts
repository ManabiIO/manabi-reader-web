/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase } from 'idb';
import type BooksDb from './versions/books-db';
import type { StoredBookData } from './versions/books-db';
import type { BookLink } from '../../../manabi/persistence';
import {
  normalizedContentHash,
  resolveImportedBook,
  type BookIdentitySource
} from '../../../library/book-identity.ts';
import { commitTransaction, explainBookStorageError } from './commit-transaction.mjs';

export interface LibraryBookIdentity {
  id: number;
  title: string;
  contentHash?: string;
  isPlaceholder: boolean;
}
interface IdentityCursor {
  value: StoredBookData;
  continue(): Promise<IdentityCursor | null>;
}
interface IdentityStore {
  openCursor(): Promise<IdentityCursor | null>;
}
async function readIdentities(store: IdentityStore): Promise<LibraryBookIdentity[]> {
  const records: LibraryBookIdentity[] = [];
  for (let cursor = await store.openCursor(); cursor; cursor = await cursor.continue()) {
    const book = cursor.value;
    // Do not retain decoded text, image resources or every book's ArrayBuffers.
    records.push({
      id: book.id,
      title: book.title,
      contentHash: book.contentHash,
      isPlaceholder: !book.elementHtml
    });
  }
  return records;
}
export async function readLibraryIdentities(db: IDBPDatabase<BooksDb>) {
  const tx = db.transaction('data');
  return commitTransaction(tx, () => readIdentities(tx.store));
}

export interface LibraryImportIdentity {
  source: BookIdentitySource;
  fileId: string;
  contentHash: string;
  expectedBookId?: number;
}

/** Parse/encode before calling. Selection, final hash validation, collision
 * naming and insertion happen in one books transaction. A title collision is
 * never permission to replace another record through the replication upsert.
 * Both existing content and independent reading/history stores stay untouched.
 */
export async function commitLibraryBook(
  db: IDBPDatabase<BooksDb>,
  links: readonly BookLink[],
  request: LibraryImportIdentity,
  prepared: Omit<StoredBookData, 'id'> | undefined,
  assertCurrent: () => void,
  signal?: AbortSignal
): Promise<{ id: number; title: string; compatibleBookIds: Set<number> }> {
  assertCurrent();
  signal?.throwIfAborted();
  const hash = normalizedContentHash(request.contentHash);
  if (!hash || (prepared && normalizedContentHash(prepared.contentHash) !== hash))
    throw new Error('The prepared book does not match the selected file.');
  const tx = db.transaction('data', 'readwrite');
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
      const records = await readIdentities(tx.store);
      const selected = resolveImportedBook(
        records,
        links,
        request.source,
        request.fileId,
        hash,
        request.expectedBookId
      );
      const ids = new Set(
        records
          .filter((book) => normalizedContentHash(book.contentHash) === hash)
          .map((book) => book.id)
      );
      const existing = selected === undefined ? undefined : await tx.store.get(selected);
      assertCurrent();
      signal?.throwIfAborted();
      if (existing?.elementHtml)
        return { id: existing.id, title: existing.title, compatibleBookIds: ids };
      if (!prepared) throw new Error('The saved book changed while opening. Refresh the Library.');
      if (existing) {
        // Only hydrate a still-empty, exact-identity placeholder. Do not reset
        // an already-read timestamp or move its bookmark/annotation identities.
        await tx.store.put({
          ...existing,
          ...prepared,
          id: existing.id,
          title: existing.title,
          lastBookOpen: existing.lastBookOpen ?? prepared.lastBookOpen,
          storageSource: undefined
        });
        assertCurrent();
        signal?.throwIfAborted();
        return { id: existing.id, title: existing.title, compatibleBookIds: ids };
      }
      let title = prepared.title;
      let attempt = 0;
      while ((await tx.store.index('title').getKey(title)) !== undefined) {
        assertCurrent();
        signal?.throwIfAborted();
        title = `${prepared.title} [${hash.slice(0, 10)}${attempt ? `-${attempt + 1}` : ''}]`;
        attempt++;
      }
      assertCurrent();
      signal?.throwIfAborted();
      const inserted = { ...prepared, title, storageSource: undefined } as Partial<StoredBookData>;
      // Parser/import payloads never choose the browser's autoincrement identity.
      delete inserted.id;
      const id = await tx.store.add(inserted as StoredBookData);
      assertCurrent();
      signal?.throwIfAborted();
      ids.add(id);
      return { id, title, compatibleBookIds: ids };
    });
  } catch (error) {
    assertCurrent();
    signal?.throwIfAborted();
    throw explainBookStorageError(error);
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
