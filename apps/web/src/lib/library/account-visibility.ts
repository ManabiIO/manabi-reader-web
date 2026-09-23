/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** A linked cloud book is visible only to the account that owns a usable link. */
export function visibleLibraryEntries<
  C extends { id: number },
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
    cards: cards.filter((card) => !foreign.has(card.id) || available.has(card.id)),
    links
  };
}
