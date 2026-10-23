/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase } from 'idb';
import type BooksDb from '../data/database/books-db/versions/books-db';
import { decodeBook } from '../data/database/books-db/book-binary';
import { assertBookPersonalAccess } from '../data/database/books-db/book-records';
import { readIndexedBookTitles } from '../data/database/books-db/content-hash-index';
import { commitTransaction } from '../data/database/books-db/commit-transaction.mjs';
import type { RestoredContent } from '../functions/file-loaders/utils/restored-book';
import { identifyReaderBook } from './reader-book-identity';
import { prepareReaderImportContent } from './reader-import-content';
import { canonical } from './ttu-migration-format';

export interface ReaderBridgeLocalScope {
  profileId: string | null;
  signal?: AbortSignal;
  assertCurrent(): void;
}
export interface ReaderBridgeLocalBookSnapshot {
  book: BooksDb['data']['value'];
  owner: BooksDb['readerBookScope']['value'] | undefined;
  resume: BooksDb['bookmark']['value'] | undefined;
}
const verifiedBooks = new WeakMap<
  object,
  {
    snapshot: ReaderBridgeLocalBookSnapshot;
    fingerprint: string;
    check(): void;
  }
>();

/** Internal preparation evidence. A UI object copied/recreated by a caller is
 * not proof of a match. Consumers still recheck this snapshot in their own tx. */
export function captureReaderBridgeLocalBook(comparison: object) {
  const verified = verifiedBooks.get(comparison);
  if (!verified) throw new ReaderBridgeLocalBookError('unavailable');
  verified.check();
  return {
    snapshot: structuredClone(verified.snapshot),
    fingerprint: verified.fingerprint,
    assertCurrent: verified.check
  };
}
export class ReaderBridgeLocalBookError extends Error {
  constructor(public readonly code: 'unavailable' | 'changed' | 'legacy-media') {
    super(
      {
        unavailable: 'This local book is no longer available for this account.',
        changed: 'The local copy changed while it was being checked. Compare it again.',
        'legacy-media':
          'This older local copy needs its images saved in the current format before it can be checked for sync. You can keep reading it.'
      }[code]
    );
  }
}
function guard(scope: ReaderBridgeLocalScope) {
  const profile = scope.profileId;
  return () => {
    scope.signal?.throwIfAborted();
    if (scope.profileId !== profile) throw new ReaderBridgeLocalBookError('changed');
    scope.assertCurrent();
  };
}

/** Select by explicit ID. Index keys avoid loading every book's text and media;
 * the selected record's ownership is checked again before any content is read. */
export async function listReaderBridgeLocalBooks(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeLocalScope
): Promise<readonly Readonly<{ id: number; title: string }>[]> {
  const check = guard(scope);
  check();
  const tx = db.transaction(['data', 'readerBookScope']);
  return commitTransaction(tx, async () => {
    const data = tx.objectStore('data');
    const books = await readIndexedBookTitles(data, check, scope.signal);
    const unavailable = new Set<number>();
    for (
      let cursor = await data.index('libraryOwner').openKeyCursor();
      cursor;
      cursor = await cursor.continue()
    ) {
      check();
      if (cursor.key !== scope.profileId) unavailable.add(cursor.primaryKey);
    }
    const choices = [];
    for (const book of books) {
      const owner = await tx.objectStore('readerBookScope').get(book.id);
      check();
      if (!unavailable.has(book.id) && (!owner || owner.accountId === scope.profileId))
        choices.push(Object.freeze({ id: book.id, title: book.title }));
    }
    check();
    return Object.freeze(choices);
  });
}

/** Exact synchronous structured-clone comparison. Object.keys(ArrayBuffer)
 * cannot compare image bytes. Legacy Blobs require asynchronous reads, so they
 * are deliberately not admitted by the final transaction check. */
export function sameReaderBridgeStoredValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof ArrayBuffer || b instanceof ArrayBuffer) {
    if (!(a instanceof ArrayBuffer) || !(b instanceof ArrayBuffer) || a.byteLength !== b.byteLength)
      return false;
    const aa = new Uint8Array(a),
      bb = new Uint8Array(b);
    return aa.every((value, index) => value === bb[index]);
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a instanceof Blob || b instanceof Blob) return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameReaderBridgeStoredValue(value, b[index]))
    );
  if (
    ![Object.prototype, null].includes(Object.getPrototypeOf(a)) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(b))
  )
    return false;
  const aa = a as Record<string, unknown>,
    bb = b as Record<string, unknown>;
  return (
    Object.keys(aa).length === Object.keys(bb).length &&
    Object.keys(aa).every(
      (key) => Object.hasOwn(bb, key) && sameReaderBridgeStoredValue(aa[key], bb[key])
    )
  );
}

function layout(data: RestoredContent) {
  // Positions may refer to publication resources even when flattened HTML is
  // identical. Claimed contentHash and title are never content proof.
  return canonical({
    publicationManifest: data.publicationManifest,
    sourceFormat: data.sourceFormat,
    htmlBackup: data.htmlBackup
  });
}

/** Read-only content comparison, not a durable link or permission to apply.
 * Hash outside IDB, then re-read the exact bytes/state in one final transaction.
 * No migration, last-read write, statistic assignment or journal acknowledgement. */
export async function compareReaderBridgeLocalBook(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeLocalScope,
  remoteInput: RestoredContent,
  characters: number,
  bookId: number,
  document: Document
) {
  const check = guard(scope);
  check();
  if (
    !Number.isSafeInteger(bookId) ||
    bookId <= 0 ||
    !Number.isSafeInteger(characters) ||
    characters < 0
  )
    throw new ReaderBridgeLocalBookError('unavailable');
  const source = structuredClone(remoteInput);
  const remote = prepareReaderImportContent(source, document);
  const read = async () => {
    check();
    const tx = db.transaction(['data', 'readerBookScope', 'bookmark']);
    return commitTransaction(tx, async () => {
      const book = await tx.objectStore('data').get(bookId);
      const owner = await tx.objectStore('readerBookScope').get(bookId);
      check();
      if (!book?.elementHtml) throw new ReaderBridgeLocalBookError('unavailable');
      try {
        assertBookPersonalAccess(book, owner, scope.profileId);
      } catch {
        throw new ReaderBridgeLocalBookError('unavailable');
      }
      const resume = await tx.objectStore('bookmark').get(bookId);
      check();
      return { book, owner, resume };
    });
  };
  const before = await read();
  const originalIdentity = await identifyReaderBook(source, characters, scope.signal);
  check();
  const stored = before.book;
  if (
    Object.values(stored.blobs).some((value) => value instanceof Blob) ||
    stored.coverImage instanceof Blob ||
    typeof stored.coverImage === 'string'
  )
    throw new ReaderBridgeLocalBookError('legacy-media');
  const decoded = decodeBook(stored);
  const local: RestoredContent = {
    ...decoded,
    sections: decoded.sections ?? [],
    coverImage: typeof decoded.coverImage === 'string' ? undefined : decoded.coverImage
  };
  const remoteIdentity = await identifyReaderBook(remote, characters, scope.signal);
  check();
  const localIdentity = await identifyReaderBook(local, stored.characters, scope.signal);
  check();
  const matches =
    stored.characters === characters &&
    remoteIdentity.fingerprint === localIdentity.fingerprint &&
    layout(remote) === layout(local);
  const after = await read();
  check();
  if (!sameReaderBridgeStoredValue(before, after)) throw new ReaderBridgeLocalBookError('changed');
  const progress = before.resume?.progress;
  const result = Object.freeze({
    bookId,
    title: stored.title,
    matches,
    // Only an ordinary progress summary; no unsupported locator is interpreted.
    progress:
      typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 1
        ? progress
        : undefined,
    hasResume: !!before.resume
  });
  if (matches)
    verifiedBooks.set(result, {
      snapshot: before,
      fingerprint: originalIdentity.fingerprint,
      check
    });
  return result;
}
