/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  readIndexedBookMetadata,
  type IndexedBookMetadata
} from '$lib/data/database/books-db/content-hash-index';

export type PersonalBook = IndexedBookMetadata & { title: string; invalidOwner?: never };

interface PersonalScopeStore {
  getAll(): Promise<{ bookId: number; accountId: string; hydrated?: boolean }[]>;
}

/** Revalidate a sync-start candidate set against live content/account evidence.
 * The caller must keep these stores in the same transaction as the reading-state
 * read or write that follows.
 */
export async function livePersonalCopies(
  bookKey: string,
  expectedCopies: readonly PersonalBook[],
  dataStore: Parameters<typeof readIndexedBookMetadata>[0],
  scopeStore: PersonalScopeStore,
  accountId: string,
  assertCurrent: () => void
): Promise<PersonalBook[]> {
  const match = /^content:([a-f0-9]{64})$/.exec(bookKey);
  if (!match || !expectedCopies.length) return [];

  const [metadata, scopeRows] = await Promise.all([
    readIndexedBookMetadata(dataStore, assertCurrent),
    scopeStore.getAll()
  ]);
  assertCurrent();

  const scopeByBook = new Map(scopeRows.map((scope) => [scope.bookId, scope.accountId]));
  const expectedIds = new Set(expectedCopies.map((book) => book.id));
  const owners = new Set<string>();
  const live: PersonalBook[] = [];
  let invalidOwner = false;

  for (const book of metadata) {
    if (book.contentHash !== match[1]) continue;
    if (book.invalidOwner) {
      invalidOwner = true;
      continue;
    }
    const scopeOwner = scopeByBook.get(book.id);
    if (scopeOwner) owners.add(scopeOwner);
    if (book.libraryOwner) owners.add(book.libraryOwner);
    if (
      expectedIds.has(book.id) &&
      scopeOwner === accountId &&
      (!book.libraryOwner || book.libraryOwner === accountId) &&
      typeof book.title === 'string'
    )
      live.push(book as PersonalBook);
  }

  if (invalidOwner || owners.size !== 1 || !owners.has(accountId) || !live.length)
    throw new Error(
      'Book ownership changed while personal reading data was syncing. No reading state was changed.'
    );
  return live;
}
