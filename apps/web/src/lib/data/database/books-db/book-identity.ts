/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Immutable admission snapshot. Validate the actual read/write record, never a second preflight lookup. */
export interface BookAccessIdentity {
  readonly bookId: number;
  readonly contentHash?: string;
  readonly readerBookKey?: string;
  readonly title: string;
  readonly lastBookModified: number;
}

/** DOM-only authority. A bridge admission must remain current while the reader loads. */
export interface BookAccessAuthority {
  signal: AbortSignal;
  assertCurrent(): void;
}

const contentHashPattern = /^[a-f0-9]{64}$/i;
const readerBookKeyPattern = /^(?:content:[a-f0-9]{64}|local:[a-f0-9-]{36})$/;

function normalizedHash(hash: string | undefined): string | undefined {
  return hash !== undefined && contentHashPattern.test(hash) ? hash.toLowerCase() : hash;
}

export function snapshotBookAccessIdentity(expected: BookAccessIdentity): BookAccessIdentity {
  // Read each caller-owned field only once, before any asynchronous admission.
  const { bookId, contentHash, readerBookKey, title, lastBookModified } = expected ?? {};
  if (
    !Number.isSafeInteger(bookId) ||
    bookId <= 0 ||
    typeof title !== 'string' ||
    !Number.isFinite(lastBookModified) ||
    (contentHash !== undefined && typeof contentHash !== 'string') ||
    (readerBookKey !== undefined &&
      (typeof readerBookKey !== 'string' ||
        !readerBookKeyPattern.test(readerBookKey) ||
        (contentHash && contentHashPattern.test(contentHash)
          ? readerBookKey !== `content:${contentHash.toLowerCase()}`
          : !readerBookKey.startsWith('local:'))))
  )
    throw new Error(
      'The selected book identity is invalid. Refresh the Library and select it again.'
    );
  return Object.freeze({
    bookId,
    contentHash: normalizedHash(contentHash),
    ...(readerBookKey === undefined ? {} : { readerBookKey }),
    title,
    lastBookModified
  });
}

export function assertBookAccessIdentity(
  book: { id: number; contentHash?: string; title: string; lastBookModified: number } | undefined,
  expected: BookAccessIdentity,
  localIdentity?: { bookId: number; uuid: string }
): void {
  const canonicalKey =
    book?.contentHash && contentHashPattern.test(book.contentHash)
      ? `content:${book.contentHash.toLowerCase()}`
      : book && localIdentity?.bookId === book.id
        ? `local:${localIdentity.uuid}`
        : undefined;
  if (
    !book ||
    book.id !== expected.bookId ||
    normalizedHash(book.contentHash) !== normalizedHash(expected.contentHash) ||
    book.title !== expected.title ||
    book.lastBookModified !== expected.lastBookModified ||
    (expected.readerBookKey !== undefined && canonicalKey !== expected.readerBookKey)
  )
    throw new Error(
      'This book changed since it was selected. Refresh the Library and select it again.'
    );
}
