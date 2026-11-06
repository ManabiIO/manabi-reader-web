/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database } from '$lib/data/store';
import { commitTransaction } from '$lib/data/database/books-db/commit-transaction.mjs';

/** Legacy imports without original-byte hashes keep a stable, local-only identity. */
export async function readerBookKeyFor(bookId: number, contentHash?: string): Promise<string> {
  if (contentHash && /^[a-f0-9]{64}$/i.test(contentHash))
    return `content:${contentHash.toLowerCase()}`;
  const db = await database.db;
  const tx = db.transaction('readerLocalIdentity', 'readwrite');
  const identity = await commitTransaction(tx, async () => {
    const store = tx.objectStore('readerLocalIdentity');
    let value = await store.get(bookId);
    if (!value) {
      value = { bookId, uuid: crypto.randomUUID() };
      await store.put(value);
    }
    return value;
  });
  return `local:${identity.uuid}`;
}
