/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  readIndexedBookMetadata,
  type IndexedBookMetadata
} from '../data/database/books-db/content-hash-index.ts';

export type PersonalBook = IndexedBookMetadata & { title: string; invalidOwner?: never };

export class PersonalBookOwnershipError extends Error {
  constructor() {
    super(
      'Book ownership changed while personal reading data was syncing. No reading state was changed.'
    );
    this.name = 'PersonalBookOwnershipError';
  }
}

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
    throw new PersonalBookOwnershipError();
  return live;
}

export interface PersonalBookScope {
  bookId: number;
  accountId: string;
  hydrated?: boolean;
}

export function planPersonalBookClaims(
  metadata: readonly IndexedBookMetadata[],
  scopeRows: readonly PersonalBookScope[],
  accountId: string
): { books: PersonalBook[]; scopesToCreate: PersonalBookScope[] } {
  const scopes = new Map(scopeRows.map((scope) => [scope.bookId, scope]));
  const ownersByBook = new Map<string, Set<string>>();
  const invalidOwnerKeys = new Set<string>();

  for (const book of metadata) {
    const bookKey = `content:${book.contentHash}`;
    if (book.invalidOwner) {
      invalidOwnerKeys.add(bookKey);
      continue;
    }
    const owners = ownersByBook.get(bookKey) ?? new Set<string>();
    const scope = scopes.get(book.id);
    if (scope) owners.add(scope.accountId);
    if (book.libraryOwner) owners.add(book.libraryOwner);
    if (owners.size) ownersByBook.set(bookKey, owners);
  }

  const books: PersonalBook[] = [];
  const scopesToCreate: PersonalBookScope[] = [];
  for (const candidate of metadata) {
    const bookKey = `content:${candidate.contentHash}`;
    if (invalidOwnerKeys.has(bookKey) || typeof candidate.title !== 'string') continue;
    const book = candidate as PersonalBook;
    if (book.libraryOwner && book.libraryOwner !== accountId) continue;
    const explicitOwners = ownersByBook.get(bookKey) ?? new Set<string>();
    if (explicitOwners.size > 1) continue;

    let owner = scopes.get(book.id);
    if (!owner) {
      if (explicitOwners.size && !explicitOwners.has(accountId)) continue;
      owner = { bookId: book.id, accountId };
      scopes.set(book.id, owner);
      explicitOwners.add(accountId);
      ownersByBook.set(bookKey, explicitOwners);
      scopesToCreate.push(owner);
    }
    if (owner.accountId === accountId) books.push(book);
  }
  return { books, scopesToCreate };
}

export async function tryLivePersonalCopies(
  ...args: Parameters<typeof livePersonalCopies>
): Promise<PersonalBook[] | undefined> {
  try {
    return await livePersonalCopies(...args);
  } catch (error) {
    if (error instanceof PersonalBookOwnershipError) return undefined;
    throw error;
  }
}
