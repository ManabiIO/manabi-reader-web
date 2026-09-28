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


/** Resolve who may open a local reader record. Durable book/sync ownership
 * outranks historical physical links. Undefined means contradictory durable
 * ownership and fails closed; [] means no account protection.
 */
export function readerAccessOwners(
  book: { libraryOwner?: string },
  scope: { accountId: string } | undefined,
  links: { owner: string | null }[]
): string[] | undefined {
  const durable = new Set<string>();
  if (book.libraryOwner) durable.add(book.libraryOwner);
  if (scope?.accountId) durable.add(scope.accountId);
  if (durable.size > 1) return undefined;
  if (durable.size === 1) return [...durable];
  if (links.some((link) => link.owner === null)) return [];
  return [...new Set(links.flatMap((link) => (link.owner ? [link.owner] : [])))];
}
