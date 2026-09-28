/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import type { BookLink } from '$lib/manabi/persistence';
import type { Catalog, SourceDescriptor } from './catalog';
import type { BookSeries } from './book-presentation';
import { presentationFromAliases } from './presentation-compatibility.ts';
import type { Organization } from './organization';
import type { PageDirection } from './direction';
import type { Preview } from './previews';
import { bookKey, contentBookKey, sourceKey, sourceBookKey } from './organization-keys.ts';
import { directoryTree, type DirectoryEntry, type LibraryNode } from './tree.ts';
import { isFinished } from './completion.ts';
import type { SortOption } from '$lib/data/sort-types';
import { creatorSortKey, sharedCreatorLine } from './book-metadata.ts';
import { BookIdentityIndex, normalizedContentHash } from './book-identity.ts';

export interface ShelfBook extends Omit<BookCardProps, 'id'> {
  key: string;
  organizationKey: string;
  organizationAliases: string[];
  canonicalTitle: string;
  bookId?: number;
  direction: PageDirection;
  coverBlur?: boolean;
  series?: BookSeries | null;
  source?: SourceDescriptor;
  file?: DirectoryEntry;
}
export interface ShelfSeries {
  kind: 'series';
  id: string;
  directoryId: string;
  name: string;
  source?: SourceDescriptor;
  personal?: boolean;
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
  const identities = new BookIdentityIndex(cards, links);
  const result: ShelfNode[] = [];
  const decorate = (
    card: BookCardProps | undefined,
    source?: SourceDescriptor,
    file?: DirectoryEntry,
    preview?: Preview
  ): ShelfBook => {
    const locator = source && file ? sourceBookKey(source, file.id) : undefined;
    const key = card ? bookKey(card.id) : locator!;
    const contentHash =
      normalizedContentHash(card?.contentHash) ?? normalizedContentHash(preview?.contentHash);
    const organizationKey = contentHash ? contentBookKey(contentHash) : key;
    const sourceAliasAllowed =
      source && file && identities.allowsSourceAlias(source, file.id, contentHash);
    const organizationAliases = [
      ...(contentHash ? [organizationKey] : []),
      ...(card ? [key] : []),
      ...(locator && sourceAliasAllowed ? [locator] : [])
    ].filter((value, index, values) => values.indexOf(value) === index);
    const presentation = presentationFromAliases(organization.books, organizationAliases);
    const canonicalTitle =
      card?.title ||
      preview?.title ||
      file?.name.replace(/\.(epub|txt|htmlz)$/i, '') ||
      'Untitled book';
    return {
      title: presentation?.title || canonicalTitle,
      canonicalTitle,
      creators: presentation?.metadata?.creators ?? card?.creators ?? preview?.creators,
      metadata: { ...preview?.metadata, ...card?.metadata, ...presentation?.metadata },
      coverBlur: presentation?.coverBlur ?? false,
      series: presentation?.series,
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
      file: file ? { ...file, expectedContentHash: contentHash } : undefined
    };
  };
  for (const catalog of catalogs) {
    const source = catalog.source,
      namespace = sourceKey(source);
    const nodes = directoryTree(
      catalog.entries,
      source.root,
      (file) => {
        const locator = sourceBookKey(source, file.id),
          cachedPreview = previews[locator],
          preview =
            cachedPreview?.key === locator &&
            cachedPreview.scannedAt === catalog.scannedAt &&
            normalizedContentHash(cachedPreview.contentHash)
              ? cachedPreview
              : undefined,
          match = identities.resolve(source, file.id, preview?.contentHash),
          card = match.kind === 'matched' ? byId.get(match.bookId) : undefined;
        if (card) represented.add(card.id);
        return decorate(card, source, file, preview);
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
    // A retained browser copy is still readable, but an absent/replaced source
    // is not an available physical file for move/group actions or new imports.
    result.push({ kind: 'book', id: bookKey(card.id), book: decorate(card, source) });
  }
  return groupPersonalSeries(result);
}
/** File operations must enumerate physical copies before any logical deduplication. */
export function physicalBooks(nodes: ShelfNode[]): ShelfBook[] {
  return nodes.flatMap((node) =>
    node.kind === 'book' ? [node.book] : physicalBooks(node.children)
  );
}
export function allBooks(nodes: ShelfNode[]): ShelfBook[] {
  const books = physicalBooks(nodes);
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
  sort: SortOption,
  preserveVolumeOrder = false
): ShelfNode[] {
  const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  function value(node: ShelfNode): string | number {
    if (sort.property === 'title') return node.kind === 'series' ? node.name : node.book.title;
    if (sort.property === 'author') {
      const creators =
        node.kind === 'series'
          ? sharedCreatorLine(node.books)
            ? node.books[0]?.creators
            : undefined
          : node.book.creators;
      return creatorSortKey(creators) || '';
    }
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
        ? [
            {
              ...node,
              books,
              children: visibleShelf(node.children, include, sort, !!node.personal)
            }
          ]
        : [];
    })
    .sort((a, b) => {
      if (preserveVolumeOrder && a.kind === 'book' && b.kind === 'book') {
        const aIndex = a.book.series?.index ?? Infinity;
        const bIndex = b.book.series?.index ?? Infinity;
        if (aIndex !== bIndex) return aIndex < bIndex ? -1 : 1;
      }
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

/** Personal series are organization, not provider moves. Original folder editing stays explicit. */
export function groupPersonalSeries(nodes: ShelfNode[]): ShelfNode[] {
  const grouped = new Map<string, ShelfBook[]>();
  function retain(items: ShelfNode[]): ShelfNode[] {
    return items.flatMap((node): ShelfNode[] => {
      if (node.kind === 'series') {
        const children = retain(node.children);
        return children.length ? [{ ...node, children, books: physicalBooks(children) }] : [];
      }
      const series = node.book.series;
      if (!series) return [node];
      const name = series.name.trim().normalize('NFC');
      const group = grouped.get(name);
      if (group) group.push(node.book);
      else grouped.set(name, [node.book]);
      return [];
    });
  }
  const retained = retain(nodes);
  for (const [name, physicalCopies] of grouped) {
    // Personal series are logical-library presentation. Multiple physical copies
    // of one content identity must not create duplicate keyed rows or duplicate
    // selection targets. Keep the first rendered copy, matching allBooks().
    const books = [...new Map(physicalCopies.map((book) => [book.key, book])).values()];
    books.sort(
      (a, b) =>
        (a.series?.index ?? Infinity) - (b.series?.index ?? Infinity) ||
        a.title.localeCompare(b.title, undefined, { numeric: true }) ||
        a.key.localeCompare(b.key)
    );
    const id = `personal-series:${encodeURIComponent(name)}`;
    retained.push({
      kind: 'series',
      id,
      directoryId: '',
      name,
      personal: true,
      books,
      children: books.map((book) => ({ kind: 'book', id: book.key, book }))
    });
  }
  return retained;
}
