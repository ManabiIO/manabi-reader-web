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
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const privateOwners = new Map<number, Set<string>>();
  const publicBooks = new Set<number>();
  for (const link of allLinks) {
    if (link.owner === null) publicBooks.add(link.bookId);
    else {
      const owners = privateOwners.get(link.bookId) ?? new Set<string>();
      owners.add(link.owner);
      privateOwners.set(link.bookId, owners);
    }
  }
  // Before durable libraryOwner existed, one numeric book could accumulate
  // cloud links from multiple accounts. With no public/local link, that row has
  // no safe owner and must not be exposed to every claimant.
  const ambiguousLegacy = new Set(
    [...privateOwners]
      .filter(
        ([bookId, owners]) =>
          owners.size > 1 &&
          !publicBooks.has(bookId) &&
          cardById.get(bookId)?.libraryOwner === undefined
      )
      .map(([bookId]) => bookId)
  );
  const links = allLinks.filter((link) => {
    if (ambiguousLegacy.has(link.bookId)) return false;
    if (link.owner !== null && link.owner !== viewerId) return false;
    const durable = cardById.get(link.bookId)?.libraryOwner;
    return durable === undefined || link.owner === durable;
  });
  const available = new Set(links.map((link) => link.bookId));
  const foreign = new Set(
    allLinks
      .filter((link) => link.owner !== null && link.owner !== viewerId)
      .map((link) => link.bookId)
  );
  return {
    cards: cards.filter(
      (card) =>
        !ambiguousLegacy.has(card.id) &&
        (card.libraryOwner === undefined || card.libraryOwner === viewerId) &&
        (!foreign.has(card.id) || available.has(card.id))
    ),
    links
  };
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
  const owners = new Set(links.flatMap((link) => (link.owner ? [link.owner] : [])));
  return owners.size > 1 ? undefined : [...owners];
}
