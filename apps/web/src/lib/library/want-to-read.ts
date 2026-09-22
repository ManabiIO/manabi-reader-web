/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Collection, Organization } from './organization';

export const WANT_TO_READ_ID = 'want-to-read';
export const WANT_TO_READ_NAME = 'Want to Read';

export interface CollectionBook {
  organizationKey: string;
  organizationAliases: string[];
}

/** The built-in destination exists even before its first membership is saved. */
export function wantToReadCollection(value: Organization): Collection {
  return {
    id: WANT_TO_READ_ID,
    name: WANT_TO_READ_NAME,
    members:
      value.collections.find((collection) => collection.id === WANT_TO_READ_ID)?.members ?? []
  };
}

export function collectionContains(collection: Collection, book: CollectionBook): boolean {
  return book.organizationAliases.some((alias) => collection.members.includes(alias));
}

/** Change all selected memberships atomically without touching other collections or history. */
export function changeWantToRead(value: Organization, books: CollectionBook[], included: boolean) {
  let collection = value.collections.find((item) => item.id === WANT_TO_READ_ID);
  if (!collection) {
    if (!included || !books.length) return;
    collection = wantToReadCollection(value);
    value.collections.push(collection);
  }
  collection.name = WANT_TO_READ_NAME;
  const aliases = new Set(
    books.flatMap((book) => [book.organizationKey, ...book.organizationAliases])
  );
  // Remove every old locator as well as the current key, so a removed book cannot
  // reappear when an import or a physical move promotes its content identity.
  collection.members = [
    ...new Set([
      ...collection.members.filter((member) => !aliases.has(member)),
      ...(included ? books.map((book) => book.organizationKey) : [])
    ])
  ];
}
