/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { foldSearch } from '../library/search-normalization';
import type { Collection } from '../library/organization';
import type { ShelfBook, ShelfNode } from '../library/view-model';

function add(result: Map<string, string[]>, key: string, value: string) {
  const values = result.get(key);
  if (values) {
    if (!values.includes(value)) values.push(value);
  } else result.set(key, [value]);
}

function matchingSeriesText(
  nodes: readonly ShelfNode[],
  search: string,
  result: Map<string, string[]>
) {
  for (const node of nodes) {
    if (node.kind !== 'series') continue;
    if (foldSearch(node.name).includes(search))
      for (const book of node.books) add(result, book.key, node.name);
    matchingSeriesText(node.children, search, result);
  }
}

/**
 * Preserve the metadata text which caused a Book to enter global search.
 * This is presentation-only search context; organization identities remain the
 * durable source of truth and none of these strings become locators.
 */
export function bookTitleMatchText(
  books: readonly ShelfBook[],
  nodes: readonly ShelfNode[],
  collections: readonly Collection[],
  normalizedQuery: string
): Record<string, readonly string[]> {
  if (!normalizedQuery) return {};
  const result = new Map<string, string[]>();
  matchingSeriesText(nodes, normalizedQuery, result);

  const collectionNamesByMember = new Map<string, string[]>();
  for (const collection of collections) {
    if (!foldSearch(collection.name).includes(normalizedQuery)) continue;
    for (const member of collection.members) add(collectionNamesByMember, member, collection.name);
  }

  for (const book of books)
    for (const alias of book.organizationAliases)
      for (const name of collectionNamesByMember.get(alias) ?? []) add(result, book.key, name);

  return Object.fromEntries(result);
}
