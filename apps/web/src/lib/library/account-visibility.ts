/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Cloud copies remain scoped even if their separate link write never committed. */
export function visibleLibraryEntries<
  C extends { id: number; libraryOwner?: string; readerOwner?: string },
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
        (card.readerOwner === undefined || card.readerOwner === viewerId) &&
        (!foreign.has(card.id) || available.has(card.id))
    ),
    links
  };
}
