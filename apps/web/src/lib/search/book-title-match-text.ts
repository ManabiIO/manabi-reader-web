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


/** The exact fields used to rank a Book in the global Titles section. */
export function bookTitleSearchFields(
  book: ShelfBook,
  contexts: readonly BookTitleMatchContext[]
): SearchTextFields {
  return {
    primary: [book.title],
    secondary: [
      ...(book.canonicalTitle !== book.title ? [book.canonicalTitle] : []),
      ...(book.creators ?? []).map((creator) => creator.name),
      ...(book.series?.name ? [book.series.name] : []),
      ...contexts.map((item) => item.text)
    ]
  };
}

/**
 * Explain a metadata-only Book match using the same relevance ordering as the
 * Titles sorter. Literal displayed-title matches retain the normal creator line.
 */
export function bookTitleMatchDetail(
  book: ShelfBook,
  contexts: readonly BookTitleMatchContext[],
  query: string
): string | undefined {
  const needle = foldSearch(query.trim());
  const creators = creatorLine(book.creators) || undefined;
  if (foldSearch(book.title).includes(needle)) return creators;
  const candidates = [
    ...(book.canonicalTitle !== book.title
      ? [{ text: book.canonicalTitle, detail: `Original title · ${book.canonicalTitle}` }]
      : []),
    ...(book.creators ?? []).map((creator) => ({
      text: creator.name,
      detail: `Author · ${creator.name}`
    })),
    ...contexts
  ].filter((item) => foldSearch(item.text).includes(needle));
  return sortSearchText(candidates, query, (item) => item.text)[0]?.detail ?? creators;
}
