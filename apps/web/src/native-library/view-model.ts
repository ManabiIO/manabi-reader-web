/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  allBooks,
  seriesTrail,
  visibleShelf,
  type ShelfBook,
  type ShelfNode
} from '../lib/library/view-model';
import {
  collectionContains,
  wantToReadCollection,
  WANT_TO_READ_ID
} from '../lib/library/want-to-read';
import { isFinished, progressFraction } from '../lib/library/completion';
import { foldSearch } from '../lib/library/search-normalization';
import { SortDirection } from '../lib/data/sort-types';
import { visibleLibraryEntries } from '../lib/library/account-visibility';
import type { BookSummary } from '../lib/data/database/books-db/book-records';
import type { BooksDbBookmarkData } from '../lib/data/database/books-db/versions/books-db';
import type { BookLink } from '../lib/manabi/persistence';
import type { Organization } from '../lib/library/organization';
import {
  LIBRARY_PAGE_LIMIT,
  LIBRARY_SORTS,
  type LibraryQuery,
  type NativeLibraryBook
} from './contract';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function parseLibraryQuery(
  value: unknown
): Required<Omit<LibraryQuery, 'detail'>> & { detail?: string } {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          'query',
          'collection',
          'series',
          'source',
          'unfinished',
          'sort',
          'direction',
          'offset',
          'limit',
          'detail'
        ].includes(key)
    )
  )
    throw new Error('Invalid Library view.');
  const query = {
    query: '',
    collection: 'books',
    series: '',
    source: '',
    unfinished: false,
    sort: 'lastBookOpen',
    direction: 'desc',
    offset: 0,
    limit: LIBRARY_PAGE_LIMIT,
    ...value
  };
  if (
    typeof query.query !== 'string' ||
    query.query.length > 500 ||
    ['collection', 'series', 'source', 'detail'].some(
      (key) =>
        query[key as keyof typeof query] !== undefined &&
        (typeof query[key as keyof typeof query] !== 'string' ||
          String(query[key as keyof typeof query]).length > 128)
    ) ||
    typeof query.unfinished !== 'boolean' ||
    !LIBRARY_SORTS.includes(query.sort as never) ||
    !['asc', 'desc'].includes(query.direction as string) ||
    !Number.isSafeInteger(query.offset) ||
    Number(query.offset) < 0 ||
    !Number.isSafeInteger(query.limit) ||
    Number(query.limit) < 1 ||
    Number(query.limit) > LIBRARY_PAGE_LIMIT
  )
    throw new Error('Invalid Library view.');
  return query as Required<Omit<LibraryQuery, 'detail'>> & { detail?: string };
}
export function libraryNodes(
  tree: ShelfNode[],
  organization: Organization,
  query: ReturnType<typeof parseLibraryQuery>,
  seriesId = '',
  sourceMatch: (book: ShelfBook) => boolean = () => true
) {
  const search = foldSearch(query.query);
  const seriesMatches = new Set<string>();
  const visit = (nodes: ShelfNode[]) => {
    for (const node of nodes)
      if (node.kind === 'series') {
        if (search && foldSearch(node.name).includes(search))
          node.books.forEach((book) => seriesMatches.add(book.key));
        visit(node.children);
      }
  };
  visit(tree);
  const collection =
    query.collection === WANT_TO_READ_ID
      ? wantToReadCollection(organization)
      : organization.collections.find((item) => item.id === query.collection);
  if (!['books', 'finished', WANT_TO_READ_ID].includes(query.collection) && !collection)
    throw new Error('This collection no longer exists.');
  const include = (book: ShelfBook) =>
    sourceMatch(book) &&
    (query.collection !== 'finished' || isFinished(book)) &&
    (!collection || collectionContains(collection, book)) &&
    (!query.unfinished || !isFinished(book)) &&
    (!search ||
      seriesMatches.has(book.key) ||
      [
        book.title,
        book.canonicalTitle,
        ...(book.creators ?? []).map((creator) => creator.name)
      ].some((text) => foldSearch(text).includes(search)));
  const trail = seriesId ? seriesTrail(tree, seriesId) : [];
  if (seriesId && !trail.length) throw new Error('This series no longer exists.');
  const base =
    trail.at(-1)?.children ??
    (query.collection === 'finished'
      ? allBooks(tree).map((book) => ({ kind: 'book' as const, id: book.key, book }))
      : tree);
  return {
    nodes: visibleShelf(
      base,
      include,
      {
        property: query.sort,
        direction: query.direction === 'asc' ? SortDirection.ASC : SortDirection.DESC
      },
      !!trail.at(-1)?.personal
    ),
    trail
  };
}
export function nativeBook(
  book: ShelfBook,
  key: string,
  organization: Organization
): NativeLibraryBook {
  const available = !!book.bookId && !book.isPlaceholder;
  return {
    kind: 'book',
    key,
    title: book.title.slice(0, 1000),
    creators: (book.creators ?? [])
      .map((creator) => creator.name)
      .join(', ')
      .slice(0, 4096),
    bookId: book.bookId,
    characters: book.characters,
    progress: progressFraction(book.progress),
    finished: isFinished(book),
    finishedOn: book.completion?.finishedOn,
    wantToRead: collectionContains(wantToReadCollection(organization), book),
    coverBlur: !!book.coverBlur,
    series: book.series,
    source: book.source?.name.slice(0, 512) || 'On this device',
    available,
    ...(!available
      ? {
          unavailableReason:
            'Import this book on this device. Native provider sign-in and persistent folder access are not available yet.'
        }
      : {})
  };
}
export function reconcileNativeSelection(
  selected: readonly string[],
  items: readonly (NativeLibraryBook | { kind: 'series'; key: string })[]
): string[] {
  const available = new Set(items.filter((item) => item.kind === 'book').map((item) => item.key));
  return [...new Set(selected)].filter((key) => available.has(key));
}

/** Content visibility and personal reading-state visibility are separate decisions. */
export function nativeOwnedCards(
  summaries: BookSummary[],
  links: BookLink[],
  bookmarks: BooksDbBookmarkData[],
  scopes: { bookId: number; accountId: string }[],
  profile: string | null
) {
  const visible = visibleLibraryEntries(summaries, links, profile);
  const owners = new Map(scopes.map((scope) => [scope.bookId, scope.accountId]));
  const marks = new Map(bookmarks.map((bookmark) => [bookmark.dataId, bookmark]));
  return {
    links: visible.links,
    cards: visible.cards.map((book) => {
      const ownReading = !owners.has(book.id) || owners.get(book.id) === profile;
      const bookmark = ownReading ? marks.get(book.id) : undefined;
      return {
        ...book,
        imagePath: '',
        progress: progressFraction(bookmark?.progress),
        lastBookOpen: ownReading ? book.lastBookOpen : 0,
        lastBookmarkModified: bookmark?.lastBookmarkModified ?? 0,
        completion: bookmark?.completion
      };
    })
  };
}
