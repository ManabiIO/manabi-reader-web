/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { foldSearch } from '../library/search-normalization.ts';
import type { Collection } from '../library/organization';
import type { ShelfBook, ShelfNode } from '../library/view-model';

export interface BookTitleMatchContext {
  text: string;
  detail: string;
}

export interface BookTitleMatchIndex {
  textByBook: Record<string, readonly BookTitleMatchContext[]>;
  matchedKeys: Set<string>;
}

function add(
  result: Map<string, BookTitleMatchContext[]>,
  key: string,
  value: BookTitleMatchContext
) {
  const values = result.get(key);
  if (values) {
    if (!values.some((item) => item.text === value.text && item.detail === value.detail))
      values.push(value);
  } else result.set(key, [value]);
}

function matchingSeriesText(
  nodes: readonly ShelfNode[],
  search: string,
  result: Map<string, BookTitleMatchContext[]>
) {
  for (const node of nodes) {
    if (node.kind !== 'series') continue;
    if (foldSearch(node.name).includes(search))
      for (const book of node.books)
        add(result, book.key, {
          text: node.name,
          detail: `${node.personal ? 'Series' : 'Folder'} · ${node.name}`
        });
    matchingSeriesText(node.children, search, result);
  }
}

/**
 * Preserve the metadata text which caused a Book to enter global search.
 * This is presentation-only search context; organization identities remain the
 * durable source of truth and none of these strings become locators.
 */
export function bookTitleMatchIndex(
  books: readonly ShelfBook[],
  nodes: readonly ShelfNode[],
  collections: readonly Collection[],
  normalizedQuery: string
): BookTitleMatchIndex {
  if (!normalizedQuery) return { textByBook: {}, matchedKeys: new Set() };
  const result = new Map<string, BookTitleMatchContext[]>();
  matchingSeriesText(nodes, normalizedQuery, result);

  const collectionsByMember = new Map<string, BookTitleMatchContext[]>();
  const contextOrder = new Map<BookTitleMatchContext, number>();
  for (const collection of collections) {
    if (!foldSearch(collection.name).includes(normalizedQuery)) continue;
    const context = { text: collection.name, detail: `Collection · ${collection.name}` };
    contextOrder.set(context, contextOrder.size);
    for (const member of collection.members) add(collectionsByMember, member, context);
  }

  for (const book of books) {
    const contexts = book.organizationAliases.flatMap(
      (alias) => collectionsByMember.get(alias) ?? []
    );
    contexts.sort((a, b) => contextOrder.get(a)! - contextOrder.get(b)!);
    for (const context of contexts) add(result, book.key, context);
  }

  return {
    textByBook: Object.fromEntries(result),
    matchedKeys: new Set(result.keys())
  };
}
