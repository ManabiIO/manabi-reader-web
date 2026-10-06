/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase } from 'idb';
import type BooksDb from '../lib/data/database/books-db/versions/books-db';
import { readAdmittedBook } from '../lib/data/database/books-db/admitted-book-read';
import { decodeBookBinary } from '../lib/data/database/books-db/book-binary';
import { latestBookPresentation } from '../lib/library/presentation-compatibility';
import type { Organization } from '../lib/library/organization';
import type { LibraryAuthority } from './contract';
import type { LibraryCoverTarget } from './cover-service';
import { localCoverFingerprint, rasterizeLocalCover } from './cover-raster';

/** Runs inside the existing DOM owner's continuous profile operation scope. */
export async function renderNativeLibraryCover(
  db: IDBPDatabase<BooksDb>,
  target: LibraryCoverTarget,
  profileId: string | null,
  authority: LibraryAuthority,
  presentation: () => Promise<Organization>,
  raster = rasterizeLocalCover
) {
  const { book, readerBookKey } = target;
  const check = () => {
    authority.signal.throwIfAborted();
    authority.assertCurrent();
  };
  check();
  if (!book.bookId || book.isPlaceholder) return null;
  const expected = {
    bookId: book.bookId,
    contentHash: book.contentHash,
    readerBookKey,
    title: book.canonicalTitle,
    lastBookModified: book.lastBookModified
  };
  let source = '';
  const validate = async () => {
    const record = await readAdmittedBook(db, expected, { ...authority, profileId });
    check();
    const organization = await presentation();
    check();
    const current = latestBookPresentation(
      book.organizationAliases.map((key) => organization.books[key])
    );
    const cover =
      current?.cover ||
      (typeof record.coverImage === 'string' || !record.coverImage
        ? record.coverImage || ''
        : decodeBookBinary(record.coverImage));
    if (
      !!current?.coverBlur !== !!book.coverBlur ||
      (await localCoverFingerprint(cover, authority)) !== source
    )
      throw new Error('This cover changed. Refresh the Library.');
    check();
  };
  try {
    source = await localCoverFingerprint(book.imagePath, authority);
    if (!source) return null;
    await validate();
    const result = await raster(book.imagePath, !!book.coverBlur, authority);
    check();
    // A replaced numeric ID, cover edit or owner change during asynchronous decode
    // must not publish either a thumbnail or a cached response for the old copy.
    await validate();
    check();
    return result;
  } catch {
    check();
    return null;
  }
}
