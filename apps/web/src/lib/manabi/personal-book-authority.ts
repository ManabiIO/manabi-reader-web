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
): {
  books: PersonalBook[];
  scopesToCreate: PersonalBookScope[];
  blockedBookKeys: string[];
} {
  const scopes = new Map(scopeRows.map((scope) => [scope.bookId, scope]));
  const groups = new Map<string, IndexedBookMetadata[]>();
  for (const book of metadata) {
    const key = `content:${book.contentHash}`;
    groups.set(key, [...(groups.get(key) ?? []), book]);
  }

  const books: PersonalBook[] = [];
  const scopesToCreate: PersonalBookScope[] = [];
  const blockedBookKeys: string[] = [];

  for (const [bookKey, group] of groups) {
    const owners = new Set<string>();
    let invalidOwner = false;
    let currentRelevant = false;
    let currentMalformed = false;

    for (const book of group) {
      const scope = scopes.get(book.id);
      if (book.invalidOwner) invalidOwner = true;
      if (scope) owners.add(scope.accountId);
      if (book.libraryOwner) owners.add(book.libraryOwner);

      const libraryVisible = !book.libraryOwner || book.libraryOwner === accountId;
      const scopeVisible = !scope || scope.accountId === accountId;
      if (
        book.libraryOwner === accountId ||
        scope?.accountId === accountId ||
        (!book.libraryOwner && !scope)
      )
        currentRelevant = true;
      if (libraryVisible && scopeVisible && typeof book.title !== 'string')
        currentMalformed = true;
    }

    // One browser data row is one reading history. Physical copies do not
    // create extra rows; they are BookLinks to that row. Multiple same-hash
    // rows therefore represent competing histories and must never be merged
    // by personal sync merely because their bytes are equal.
    const competingHistories = group.length > 1 && currentRelevant;
    const conflictingOwners = owners.size > 1;
    if (invalidOwner || currentMalformed || competingHistories || conflictingOwners) {
      if (currentRelevant) blockedBookKeys.push(bookKey);
      continue;
    }

    const book = group[0];
    if (
      !book ||
      typeof book.title !== 'string' ||
      (book.libraryOwner && book.libraryOwner !== accountId)
    )
      continue;

    let owner = scopes.get(book.id);
    if (owner && owner.accountId !== accountId) continue;
    if (!owner) {
      if (owners.size && !owners.has(accountId)) continue;
      owner = { bookId: book.id, accountId };
      scopes.set(book.id, owner);
      scopesToCreate.push(owner);
    }
    books.push(book as PersonalBook);
  }

  return { books, scopesToCreate, blockedBookKeys };
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

export function needsPersonalHydration(
  copies: readonly PersonalBook[],
  scopeRows: readonly PersonalBookScope[],
  accountId: string
): boolean {
  const scopes = new Map(scopeRows.map((scope) => [scope.bookId, scope]));
  return copies.some((book) => {
    const scope = scopes.get(book.id);
    return !scope || scope.accountId !== accountId || !scope.hydrated;
  });
}
