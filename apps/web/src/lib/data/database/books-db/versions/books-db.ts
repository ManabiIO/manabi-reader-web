/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type BooksDbV9 from '$lib/data/database/books-db/versions/v9/books-db-v9';

type BooksDb = BooksDbV9;

export type BooksDbBookData = BooksDb['data']['value'];
export type BooksDbBookmarkData = BooksDb['bookmark']['value'];
export type BooksDbStorageSource = BooksDb['storageSource']['value'];
export type BooksDbStatistic = BooksDb['statistic']['value'];
export type BooksDbContentStatistic = BooksDb['readerStatistic']['value'];
export type BooksDbReadingGoal = BooksDb['readingGoal']['value'];
export type BooksDbLastModified = BooksDb['lastModified']['value'];
export type BooksDbAudioBook = BooksDb['audioBook']['value'];
export type BooksDbSubtitleData = BooksDb['subtitle']['value'];
export type BooksDbHandle = BooksDb['handle']['value'];
export const currentDbVersion = 9;
// Export filenames describe the serialized TTU payload, not IndexedDB internals.
// A local-only store must not make otherwise compatible archives unreadable.
export const ttuWireVersion = 8;

export type { BooksDb as default };
