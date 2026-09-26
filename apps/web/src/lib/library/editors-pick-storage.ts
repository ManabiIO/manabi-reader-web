/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { commitTransaction } from '$lib/data/database/books-db/commit-transaction.mjs';
import { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
import { StorageKey } from '$lib/data/storage/storage-types';
import { database } from '$lib/data/store';
import { throwIfAborted } from '$lib/functions/replication/replication-error';
import { integrationDB } from '$lib/manabi/persistence';
import { visibleLibraryEntries } from './account-visibility';

/** Inspect metadata one record at a time, not every saved book's image payload at once.
 * Ownership lives in the existing integration DB: it is checked independently of
 * the displayed Library cards. The two databases are not an atomic snapshot.
 */
export async function findEditorsPickCopy(
  digest: string,
  owner: string | null,
  signal: AbortSignal
): Promise<number | undefined> {
  throwIfAborted(signal);
  const links = await (await integrationDB()).getAll('books');
  const db = await database.db;
  throwIfAborted(signal);
  const tx = db.transaction('data');
  return commitTransaction(tx, async () => {
    let result: number | undefined;
    let foreign = false;
    let sourceBound = false;
    for (let cursor = await tx.store.openCursor(); cursor; cursor = await cursor.continue()) {
      throwIfAborted(signal);
      const book = cursor.value;
      if (book.contentHash?.toLowerCase() !== digest) continue;
      if (!visibleLibraryEntries([{ id: book.id }], links, owner).cards.length) {
        foreign = true;
        continue;
      }
      if (book.storageSource) {
        sourceBound = true;
        continue;
      }
      if (!book.elementHtml) continue;
      if (result !== undefined)
        throw new Error(
          'Several local copies match this book. Open the intended copy from the Library.'
        );
      result = book.id;
    }
    // Do not fall through to the title/hash upsert when it could adopt a private copy.
    if (result === undefined && foreign)
      throw new Error(
        'A matching local book is unavailable for the current account. No book was changed.'
      );
    if (result === undefined && sourceBound)
      throw new Error('A matching copy belongs to a connected library. Open it from the Library.');
    throwIfAborted(signal);
    return result;
  });
}

/** Recheck the actual saved ID, never a new first-hash lookup after asynchronous import. */
export async function validateEditorsPickCopy(
  id: number,
  digest: string,
  owner: string | null,
  signal: AbortSignal
) {
  const links = await (await integrationDB()).getAll('books');
  const book = await (await database.db).get('data', id);
  throwIfAborted(signal);
  if (
    !book ||
    book.contentHash?.toLowerCase() !== digest ||
    !book.elementHtml ||
    book.storageSource
  )
    throw new Error('The local copy changed or was removed. Open the book again from the Library.');
  if (!visibleLibraryEntries([{ id }], links, owner).cards.length)
    throw new Error('This local book is unavailable for the current account.');
}

/** Reuse the normal serializer while retaining its exact save result and cancellation. */
export class EditorsPickStorageHandler extends BrowserStorageHandler {
  savedId: number | undefined;

  constructor(
    window: Window,
    private readonly digest: string,
    private readonly owner: string | null,
    private readonly signal: AbortSignal
  ) {
    super(window, StorageKey.BROWSER);
  }

  override async saveBook(...args: Parameters<BrowserStorageHandler['saveBook']>) {
    throwIfAborted(this.signal);
    const book = args[0];
    if (book instanceof File || book.contentHash?.toLowerCase() !== this.digest)
      throw new Error('The imported book does not match the selected download.');
    // A copy may have arrived while the parser ran. Reuse it without replacing progress.
    const existing = await findEditorsPickCopy(this.digest, this.owner, this.signal);
    throwIfAborted(this.signal);
    const id = existing ?? (await super.saveBook(...args));
    this.savedId = id;
    return id;
  }
}
