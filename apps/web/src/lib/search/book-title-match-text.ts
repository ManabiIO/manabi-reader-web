/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  foldSearch,
  searchMatchedField,
  type SearchTextFields
} from '../library/search-normalization.ts';
import { creatorLine } from '../library/book-metadata.ts';
import type { Collection } from '../library/organization';
import type { ShelfBook, ShelfNode } from '../library/view-model';

export interface BookTitleMatchContext {
  text: string;
  detail: string;
}

interface IndexedBookTitleMatchContext extends BookTitleMatchContext {
  folded: string;
}

export interface BookTitleMatchIndex {
  textByBook: Record<string, readonly BookTitleMatchContext[]>;
  matchedKeys: Set<string>;
}

/**
 * Query-independent metadata index. All expensive Unicode folding and
 * series/collection expansion happens when the library snapshot changes, not
 * while the user is typing.
 */
export interface BookTitleSearchSnapshot {
  directByBook: ReadonlyMap<string, readonly string[]>;
  contextsByBook: ReadonlyMap<string, readonly IndexedBookTitleMatchContext[]>;
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

function indexSeriesText(
  nodes: readonly ShelfNode[],
  result: Map<string, BookTitleMatchContext[]>
) {
  for (const node of nodes) {
    if (node.kind !== 'series') continue;
    const context = {
      text: node.name,
      detail: `${node.personal ? 'Series' : 'Folder'} · ${node.name}`
    };
    for (const book of node.books) add(result, book.key, context);
    indexSeriesText(node.children, result);
  }
}

/**
 * Build the immutable search snapshot for Book title/metadata matching.
 * Collection membership is expanded through every organization alias so
 * portable/current identities keep the same semantics as the legacy query path.
 */
export function buildBookTitleSearchSnapshot(
  books: readonly ShelfBook[],
  nodes: readonly ShelfNode[],
  collections: readonly Collection[]
): BookTitleSearchSnapshot {
  const contexts = new Map<string, BookTitleMatchContext[]>();
  indexSeriesText(nodes, contexts);

  const collectionsByMember = new Map<string, BookTitleMatchContext[]>();
  const contextOrder = new Map<BookTitleMatchContext, number>();
  for (const collection of collections) {
    const context = { text: collection.name, detail: `Collection · ${collection.name}` };
    contextOrder.set(context, contextOrder.size);
    for (const member of collection.members) add(collectionsByMember, member, context);
  }

  for (const book of books) {
    const collectionContexts = book.organizationAliases.flatMap(
      (alias) => collectionsByMember.get(alias) ?? []
    );
    collectionContexts.sort((a, b) => contextOrder.get(a)! - contextOrder.get(b)!);
    for (const context of collectionContexts) add(contexts, book.key, context);
  }

  const directByBook = new Map<string, readonly string[]>();
  for (const book of books)
    directByBook.set(
      book.key,
      [book.title, book.canonicalTitle, ...(book.creators ?? []).map((creator) => creator.name)].map(
        foldSearch
      )
    );

  return {
    directByBook,
    contextsByBook: new Map(
      [...contexts].map(([key, values]) => [
        key,
        values.map((value) => ({ ...value, folded: foldSearch(value.text) }))
      ])
    )
  };
}

/** Query a pre-folded Book metadata snapshot without walking the shelf tree. */
export function queryBookTitleSearchSnapshot(
  snapshot: BookTitleSearchSnapshot,
  normalizedQuery: string
): BookTitleMatchIndex {
  if (!normalizedQuery) return { textByBook: {}, matchedKeys: new Set() };

  const matchedKeys = new Set<string>();
  for (const [key, values] of snapshot.directByBook)
    if (values.some((value) => value.includes(normalizedQuery))) matchedKeys.add(key);

  const textByBook: Record<string, readonly BookTitleMatchContext[]> = {};
  for (const [key, contexts] of snapshot.contextsByBook) {
    const matching = contexts.filter((context) => context.folded.includes(normalizedQuery));
    if (!matching.length) continue;
    textByBook[key] = matching.map(({ text, detail }) => ({ text, detail }));
    matchedKeys.add(key);
  }

  return { textByBook, matchedKeys };
}

/**
 * Compatibility helper for focused tests/consumers which do not retain a
 * snapshot. Interactive library search should build once and query repeatedly.
 */
export function bookTitleMatchIndex(
  books: readonly ShelfBook[],
  nodes: readonly ShelfNode[],
  collections: readonly Collection[],
  normalizedQuery: string
): BookTitleMatchIndex {
  return queryBookTitleSearchSnapshot(
    buildBookTitleSearchSnapshot(books, nodes, collections),
    normalizedQuery
  );
}

/** Keep ranking and the displayed reason for a match on the same metadata fields. */
function secondaryContexts(
  book: ShelfBook,
  contexts: readonly BookTitleMatchContext[]
): BookTitleMatchContext[] {
  return [
    ...(book.canonicalTitle !== book.title
      ? [{ text: book.canonicalTitle, detail: `Original title · ${book.canonicalTitle}` }]
      : []),
    ...(book.creators ?? []).map((creator) => ({
      text: creator.name,
      detail: `Author · ${creator.name}`
    })),
    ...(book.series?.name
      ? [{ text: book.series.name, detail: `Series · ${book.series.name}` }]
      : []),
    ...contexts
  ];
}

/** The exact fields used to rank a Book in the global Titles section. */
export function bookTitleSearchFields(
  book: ShelfBook,
  contexts: readonly BookTitleMatchContext[]
): SearchTextFields {
  return {
    primary: [book.title],
    secondary: secondaryContexts(book, contexts).map((item) => item.text)
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
  if (!needle || foldSearch(book.title).includes(needle)) return creators;
  const candidates = secondaryContexts(book, contexts);
  const field = searchMatchedField(
    candidates.map((item) => item.text),
    query
  );
  return field === undefined ? creators : candidates[field].detail;
}
