/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database } from '$lib/data/store';
import { decodeBook } from '$lib/data/database/books-db/book-binary';
import { assertExternalBookSource } from './external-book-source';
import { uniqueSharedCopy } from './shared-title-selection';

/** Legacy source navigation has a title, not an unambiguous local book ID. */
export async function getExternalBookData(title: string, sourceName: string) {
  if (!title) return undefined;
  const db = await database.db;
  // Two matches suffice to reject ambiguity; do not clone every same-title edition.
  const book = uniqueSharedCopy(title, await db.getAllFromIndex('data', 'title', title, 2));
  assertExternalBookSource(book, sourceName);
  // Decode the exact snapshot selected above, not a second lookup by title.
  return book ? decodeBook(book) : undefined;
}
