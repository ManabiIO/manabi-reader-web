/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Cloud copies remain scoped even if their separate link write never committed. */
export function visibleLibraryEntries<
  C extends { id: number; libraryOwner?: string },
  L extends { bookId: number; owner: string | null }
>(cards: C[], allLinks: L[] | null, viewerId: string | null): { cards: C[]; links: L[] } {
  if (!allLinks) return { cards: [], links: [] };
  const links = allLinks.filter((link) => link.owner === null || link.owner === viewerId);
  const available = new Set(links.map((link) => link.bookId));
  const foreign = new Set(
    allLinks
      .filter((link) => link.owner !== null && link.owner !== viewerId)
      .map((link) => link.bookId)
  );
  return {
    cards: cards.filter(
      (card) =>
        (card.libraryOwner === undefined || card.libraryOwner === viewerId) &&
        (!foreign.has(card.id) || available.has(card.id))
    ),
    links
  };
}

/** Reading-data scope can be private even when local book bytes remain readable. */
export function canReadLibraryReadingState(
  card: { readerOwner?: string },
  viewerId: string | null
): boolean {
  return card.readerOwner === undefined || card.readerOwner === viewerId;
}

/** Reading-data scope may be created for an otherwise public local book.
 * Content ownership comes from the imported book or its source links.
 * Contradictory explicit ownership fails closed; [] means public content.
 */
export function readerAccessOwners(
  book: { libraryOwner?: string },
  scope: { accountId: string } | undefined,
  links: { owner: string | null }[]
): string[] | undefined {
  const durable = new Set<string>();
  if (book.libraryOwner) durable.add(book.libraryOwner);
  if (book.libraryOwner && scope?.accountId) durable.add(scope.accountId);
  if (durable.size > 1) return undefined;
  if (durable.size === 1) return [...durable];
  if (links.some((link) => link.owner === null)) return [];
  return [...new Set(links.flatMap((link) => (link.owner ? [link.owner] : [])))];
}
