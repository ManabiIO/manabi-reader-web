/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Legacy statistics use title as their primary key. Detect cases where that
 * key cannot identify one logical book before assigning rows to content hashes.
 */
export function ambiguousStatisticTitles(
  books: readonly { id: number; title: string; contentHash?: string }[]
): string[] {
  const identityByTitle = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const book of books) {
    const identity = /^[a-f0-9]{64}$/i.test(book.contentHash ?? '')
      ? `content:${book.contentHash!.toLowerCase()}`
      : `local:${book.id}`;
    const previous = identityByTitle.get(book.title);
    if (previous && previous !== identity) ambiguous.add(book.title);
    else identityByTitle.set(book.title, identity);
  }
  return [...ambiguous].sort();
}
