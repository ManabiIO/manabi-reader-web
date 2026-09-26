/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database } from '$lib/data/store';

/** Legacy imports without original-byte hashes keep a stable, local-only identity. */
export async function readerBookKeyFor(bookId: number, contentHash?: string): Promise<string> {
  if (contentHash && /^[a-f0-9]{64}$/i.test(contentHash))
    return `content:${contentHash.toLowerCase()}`;
  const db = await database.db;
  const tx = db.transaction('readerLocalIdentity', 'readwrite');
  const store = tx.objectStore('readerLocalIdentity');
  let identity = await store.get(bookId);
  if (!identity) {
    identity = { bookId, uuid: crypto.randomUUID() };
    await store.put(identity);
  }
  await tx.done;
  return `local:${identity.uuid}`;
}
