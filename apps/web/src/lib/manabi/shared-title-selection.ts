/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Legacy TTU folders identify books by title, unlike Manabi's content identities. */
export function sharedPublishChoices(books: readonly { title: string; elementHtml?: string }[]) {
  const titles = new Map<string, { title: string; copies: number; hasContent: boolean }>();
  for (const book of books) {
    const entry = titles.get(book.title) ?? { title: book.title, copies: 0, hasContent: false };
    entry.copies++;
    entry.hasContent ||= Boolean(book.elementHtml);
    titles.set(book.title, entry);
  }
  return [...titles.values()].filter((entry) => entry.hasContent);
}

/** Never choose the first IndexedDB title match when several local identities exist. */
export function uniqueSharedCopy<T>(title: string, matches: readonly T[]): T | undefined {
  if (matches.length > 1) {
    throw new Error(
      `${title} has multiple local copies. Ttu Ebook Reader libraries identify books by title. Resolve the duplicate titles before sharing; no transfer was started.`
    );
  }
  return matches[0];
}
