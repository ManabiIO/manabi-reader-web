/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import type { BookLink } from '$lib/manabi/persistence';
import type { Catalog, SourceDescriptor } from './catalog';
import type { Organization } from './organization';
import type { PageDirection } from './direction';
import type { Preview } from './previews';
import { bookKey, contentBookKey, sourceKey, sourceBookKey } from './organization';
import { directoryTree, type DirectoryEntry, type LibraryNode } from './tree';
import { isFinished } from './completion';
import type { SortOption } from '$lib/data/sort-types';
import { creatorSortKey, sharedCreatorLine } from './book-metadata';

export interface ShelfBook extends Omit<BookCardProps, 'id'> {
  key: string;
  organizationKey: string;
  organizationAliases: string[];
  canonicalTitle: string;
  bookId?: number;
  direction: PageDirection;
  source?: SourceDescriptor;
  file?: DirectoryEntry;
}
export interface ShelfSeries {
  kind: 'series';
  id: string;
  directoryId: string;
  name: string;
  source: SourceDescriptor;
  children: ShelfNode[];
  books: ShelfBook[];
}
export type ShelfNode = { kind: 'book'; id: string; book: ShelfBook } | ShelfSeries;
export function buildShelf(
  cards: BookCardProps[],
  links: BookLink[],
  catalogs: Catalog[],
  sources: SourceDescriptor[],
  organization: Organization,
  previews: Record<string, Preview> = {}
): ShelfNode[] {
  const byId = new Map(cards.map((card) => [card.id, card])),
    represented = new Set<number>();
  const linksByBook = new Map(links.map((link) => [link.bookId, link]));
  const linksByFile = new Map(
    links.map((link) => [
      sourceBookKey({ id: link.sourceId, owner: link.owner, root: link.root }, link.fileId),
      link
    ])
  );
  const result: ShelfNode[] = [];
  const catalogFiles = new Set(
    catalogs.flatMap((catalog) =>
      catalog.entries
        .filter((entry) => entry.kind === 'file')
        .map((entry) => sourceBookKey(catalog.source, entry.id))
    )
  );
  const missingLinksByContent = new Map<string, BookLink>();
  for (const link of links) {
    const locator = sourceBookKey(
      { id: link.sourceId, owner: link.owner, root: link.root },
      link.fileId
    );
    if (
      !catalogFiles.has(locator) &&
      catalogs.some(
        (catalog) =>
          catalog.source.id === link.sourceId &&
          catalog.source.owner === link.owner &&
          catalog.source.root === link.root
      )
    )
      missingLinksByContent.set(JSON.stringify([link.owner, link.contentHash]), link);
  }
  const revisions = new Map(
    catalogs.map((catalog) => [sourceKey(catalog.source), catalog.scannedAt])
  );
  const decorate = (
    card: BookCardProps | undefined,
    source?: SourceDescriptor,
    file?: DirectoryEntry
  ): ShelfBook => {
    const key = card ? bookKey(card.id) : sourceBookKey(source!, file!.id);
    const linked = card ? linksByBook.get(card.id) : linksByFile.get(key);
    const cachedPreview = source && file ? previews[sourceBookKey(source, file.id)] : undefined;
    const preview =
      source && cachedPreview?.scannedAt === revisions.get(sourceKey(source))
        ? cachedPreview
        : undefined;
    const contentHash =
      card?.contentHash && /^[a-f0-9]{64}$/.test(card.contentHash)
        ? card.contentHash
        : linked?.contentHash || preview?.contentHash;
    const organizationKey = contentHash ? contentBookKey(contentHash) : key;
    const organizationAliases = [
      organizationKey,
      key,
      ...(linked ? [bookKey(linked.bookId)] : []),
      ...(source && file ? [sourceBookKey(source, file.id)] : [])
    ].filter((value, index, values) => values.indexOf(value) === index);
    const presentation = organizationAliases
      .map((alias) => organization.books[alias])
      .filter((value): value is NonNullable<typeof value> => !!value)
      .sort((left, right) => right.modifiedAt - left.modifiedAt)[0];
    const canonicalTitle =
      card?.title ||
      preview?.title ||
      file?.name.replace(/\.(epub|txt|htmlz)$/i, '') ||
      'Untitled book';
    return {
      title: presentation?.title || canonicalTitle,
      canonicalTitle,
      creators: card?.creators || preview?.creators,
      imagePath: presentation?.cover || card?.imagePath || preview?.imagePath || '',
      characters: card?.characters || 0,
      lastBookModified: card?.lastBookModified || 0,
      lastBookOpen: card?.lastBookOpen || 0,
      progress: card?.progress || 0,
      lastBookmarkModified: card?.lastBookmarkModified || 0,
      completion: card?.completion,
      isPlaceholder: card?.isPlaceholder ?? true,
      pageDirection: card?.pageDirection || preview?.pageDirection,
      contentHash,
      direction:
        presentation?.direction && presentation.direction !== 'unknown'
          ? presentation.direction
          : card?.pageDirection?.value || preview?.pageDirection.value || 'unknown',
      key,
      organizationKey,
      organizationAliases,
      bookId: card?.id,
      source,
      file
    };
  };
  for (const catalog of catalogs) {
    const source = catalog.source,
      namespace = sourceKey(source);
    const matches = new Map(
      links
        .filter(
          (link) =>
            link.sourceId === source.id && link.owner === source.owner && link.root === source.root
        )
        .map((link) => [link.fileId, link])
    );
    const nodes = directoryTree(
      catalog.entries,
      source.root,
      (file) => {
        const link = matches.get(file.id),
          preview = previews[sourceBookKey(source, file.id)],
          moved =
            !link && preview?.scannedAt === catalog.scannedAt && preview.contentHash
              ? missingLinksByContent.get(JSON.stringify([source.owner, preview.contentHash]))
              : undefined,
          card = link ? byId.get(link.bookId) : moved ? byId.get(moved.bookId) : undefined;
        if (card) represented.add(card.id);
        return decorate(card, source, file);
      },
      catalog.names
    );
    function attach(nodes: LibraryNode<ShelfBook>[]): ShelfNode[] {
      return nodes.map((node) =>
        node.kind === 'book'
          ? { ...node, id: `${namespace}:${node.id}` }
          : {
              ...node,
              id: `${namespace}:${node.id}`,
              directoryId: node.id,
              source,
              children: attach(node.children)
            }
      );
    }
    result.push(...attach(nodes));
  }
  for (const card of cards) {
    if (represented.has(card.id)) continue;
    const link = links.find((link) => link.bookId === card.id);
    const source = link
      ? sources.find(
          (s) => s.id === link.sourceId && s.owner === link.owner && s.root === link.root
        )
      : undefined;
    const file: DirectoryEntry | undefined =
      link && source
        ? { id: link.fileId, parent: source.root, name: link.name, kind: 'file' }
        : undefined;
    result.push({ kind: 'book', id: bookKey(card.id), book: decorate(card, source, file) });
  }
  return result;
}
export function allBooks(nodes: ShelfNode[]): ShelfBook[] {
  const books = nodes.flatMap((node) => (node.kind === 'book' ? [node.book] : node.books));
  return [...new Map(books.map((book) => [book.key, book])).values()];
}
export function seriesTrail(nodes: ShelfNode[], id: string): ShelfSeries[] {
  for (const node of nodes)
    if (node.kind === 'series') {
      if (node.id === id) return [node];
      const trail = seriesTrail(node.children, id);
      if (trail.length) return [node, ...trail];
    }
  return [];
}
export function visibleShelf(
  nodes: ShelfNode[],
  include: (book: ShelfBook) => boolean,
  sort: SortOption
): ShelfNode[] {
  const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  function value(node: ShelfNode): string | number {
    if (sort.property === 'title') return node.kind === 'series' ? node.name : node.book.title;
    if (sort.property === 'author')
      return node.kind === 'series'
        ? sharedCreatorLine(node.books) || ''
        : creatorSortKey(node.book.creators) || '';
    const property = sort.property as Exclude<SortOption['property'], 'author' | 'title'>;
    const books = node.kind === 'series' ? node.books : [node.book];
    return books.reduce(
      (max, b) => Math.max(max, property === 'id' ? b.bookId || 0 : Number(b[property]) || 0),
      0
    );
  }
  return nodes
    .flatMap((node): ShelfNode[] => {
      if (node.kind === 'book') return include(node.book) ? [node] : [];
      const books = node.books.filter(include);
      return books.length
        ? [{ ...node, books, children: visibleShelf(node.children, include, sort) }]
        : [];
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'series' ? -1 : 1;
      const av = value(a),
        bv = value(b);
      const compared =
        typeof av === 'string' && typeof bv === 'string'
          ? sort.property === 'author' && (!av || !bv)
            ? av
              ? -1
              : bv
                ? 1
                : 0
            : natural.compare(av, bv)
          : Number(av) - Number(bv);
      const directed =
        sort.property === 'author' && (!av || !bv)
          ? compared
          : sort.direction === 'desc'
            ? -compared
            : compared;
      return directed || natural.compare(a.id, b.id);
    });
}
export function continueBook(books: ShelfBook[]): ShelfBook | undefined {
  const unfinished = books.filter((book) => !isFinished(book));
  return [...unfinished].sort((a, b) => b.lastBookOpen - a.lastBookOpen)[0];
}
