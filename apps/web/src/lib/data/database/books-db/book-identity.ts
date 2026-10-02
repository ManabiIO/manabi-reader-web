/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Immutable admission snapshot. Validate the actual read/write record, never a second preflight lookup. */
export interface BookAccessIdentity {
  readonly bookId: number;
  readonly contentHash?: string;
  readonly title: string;
  readonly lastBookModified: number;
}

/** DOM-only authority. A bridge admission must remain current while the reader loads. */
export interface BookAccessAuthority {
  signal: AbortSignal;
  assertCurrent(): void;
}

export function snapshotBookAccessIdentity(expected: BookAccessIdentity): BookAccessIdentity {
  if (
    !expected ||
    !Number.isSafeInteger(expected.bookId) ||
    expected.bookId <= 0 ||
    typeof expected.title !== 'string' ||
    !Number.isFinite(expected.lastBookModified) ||
    (expected.contentHash !== undefined && typeof expected.contentHash !== 'string')
  )
    throw new Error(
      'The selected book identity is invalid. Refresh the Library and select it again.'
    );
  return Object.freeze({
    bookId: expected.bookId,
    contentHash: expected.contentHash,
    title: expected.title,
    lastBookModified: expected.lastBookModified
  });
}

export function assertBookAccessIdentity(
  book: { id: number; contentHash?: string; title: string; lastBookModified: number } | undefined,
  expected: BookAccessIdentity
): void {
  if (
    !book ||
    book.id !== expected.bookId ||
    book.contentHash !== expected.contentHash ||
    book.title !== expected.title ||
    book.lastBookModified !== expected.lastBookModified
  )
    throw new Error(
      'This book changed since it was selected. Refresh the Library and select it again.'
    );
}
