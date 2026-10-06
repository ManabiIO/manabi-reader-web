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

interface IndexedBookTitleContextGroup {
  context: BookTitleMatchContext;
  folded: string;
  /** Direct leaf Books only; descendants stay in child groups to avoid O(depth × books) copies. */
  bookKeys: readonly string[];
  children: readonly IndexedBookTitleContextGroup[];
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
  direct: readonly { key: string; folded: readonly string[] }[];
  contexts: readonly IndexedBookTitleContextGroup[];
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

function indexSeriesText(nodes: readonly ShelfNode[]): IndexedBookTitleContextGroup[] {
  return nodes.flatMap((node): IndexedBookTitleContextGroup[] => {
    if (node.kind !== 'series') return [];
    const context = {
      text: node.name,
      detail: `${node.personal ? 'Series' : 'Folder'} · ${node.name}`
    };
    return [
      {
        context,
        folded: foldSearch(node.name),
        bookKeys: [
          ...new Set(
            node.children.flatMap((child) => (child.kind === 'book' ? [child.book.key] : []))
          )
        ],
        children: indexSeriesText(node.children)
      }
    ];
  });
}

/**
 * Build the immutable search snapshot for Book title/metadata matching.
 * Context labels are stored once with the Book identities they admit rather
 * than copied onto every Book, bounding memory for deep folder trees.
 */
export function buildBookTitleSearchSnapshot(
  books: readonly ShelfBook[],
  nodes: readonly ShelfNode[],
  collections: readonly Collection[]
): BookTitleSearchSnapshot {
  const contexts = indexSeriesText(nodes);

  const booksByAlias = new Map<string, Set<string>>();
  for (const book of books)
    for (const alias of book.organizationAliases) {
      const keys = booksByAlias.get(alias);
      if (keys) keys.add(book.key);
      else booksByAlias.set(alias, new Set([book.key]));
    }

  for (const collection of collections) {
    const bookKeys: string[] = [];
    const seen = new Set<string>();
    for (const member of collection.members)
      for (const key of booksByAlias.get(member) ?? [])
        if (!seen.has(key)) {
          seen.add(key);
          bookKeys.push(key);
        }
    if (!bookKeys.length) continue;
    const context = { text: collection.name, detail: `Collection · ${collection.name}` };
    contexts.push({ context, folded: foldSearch(collection.name), bookKeys, children: [] });
  }

  return {
    direct: books.map((book) => ({
      key: book.key,
      folded: [
        ...new Set(
          [
            book.title,
            book.canonicalTitle,
            ...(book.creators ?? []).map((creator) => creator.name),
            book.series?.name
          ]
            .filter((value): value is string => typeof value === 'string')
            .map(foldSearch)
        )
      ]
    })),
    contexts
  };
}

/** Query a pre-folded Book metadata snapshot without walking the shelf tree. */
export function queryBookTitleSearchSnapshot(
  snapshot: BookTitleSearchSnapshot,
  normalizedQuery: string
): BookTitleMatchIndex {
  if (!normalizedQuery) return { textByBook: {}, matchedKeys: new Set() };

  const matchedKeys = new Set<string>();
  for (const entry of snapshot.direct)
    if (entry.folded.some((value) => value.includes(normalizedQuery))) matchedKeys.add(entry.key);

  const result = new Map<string, BookTitleMatchContext[]>();
  const addGroupBooks = (
    group: IndexedBookTitleContextGroup,
    context: BookTitleMatchContext
  ) => {
    for (const key of group.bookKeys) {
      add(result, key, context);
      matchedKeys.add(key);
    }
    for (const child of group.children) addGroupBooks(child, context);
  };
  const queryGroups = (groups: readonly IndexedBookTitleContextGroup[]) => {
    for (const group of groups) {
      if (group.folded.includes(normalizedQuery)) addGroupBooks(group, group.context);
      queryGroups(group.children);
    }
  };
  queryGroups(snapshot.contexts);

  return { textByBook: Object.fromEntries(result), matchedKeys };
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
