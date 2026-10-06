/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase } from 'idb';
import type BooksDb from './versions/books-db';
import type { StoredBookData } from './versions/books-db';
import {
  assertBookAccessIdentity,
  snapshotBookAccessIdentity,
  type BookAccessAuthority,
  type BookAccessIdentity
} from './book-identity';
import { assertBookPersonalAccess } from './book-records';
import { commitTransaction } from './commit-transaction.mjs';

export interface AdmittedBookReadAuthority extends BookAccessAuthority {
  readonly profileId: string | null;
}

/** Validate and return the same stored bytes, ownership and canonical identity.
 * A hashless admission may only use an existing UUID; this read never creates
 * one or authorizes a numeric-ID replacement after a separate preflight read.
 */
export async function readAdmittedBook(
  db: IDBPDatabase<BooksDb>,
  expected: BookAccessIdentity,
  authority: AdmittedBookReadAuthority
): Promise<StoredBookData> {
  const snapshot = snapshotBookAccessIdentity(expected);
  const { signal, profileId } = authority;
  const assertCurrent = () => {
    signal.throwIfAborted();
    authority.assertCurrent();
  };
  assertCurrent();
  const tx = db.transaction(['data', 'readerBookScope', 'readerLocalIdentity'], 'readonly');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      // A completed transaction cannot be undone, but its result is still guarded.
    }
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const book = await commitTransaction(tx, async () => {
      assertCurrent();
      const record = await tx.objectStore('data').get(snapshot.bookId);
      assertCurrent();
      const owner = await tx.objectStore('readerBookScope').get(snapshot.bookId);
      assertCurrent();
      const localIdentity = await tx.objectStore('readerLocalIdentity').get(snapshot.bookId);
      assertCurrent();
      assertBookAccessIdentity(record, snapshot, localIdentity);
      // assertBookAccessIdentity rejects a missing record before personal access.
      if (!record) throw new Error('The selected book is no longer in the Library.');
      assertBookPersonalAccess(record, owner, profileId);
      return record;
    });
    assertCurrent();
    return book;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
