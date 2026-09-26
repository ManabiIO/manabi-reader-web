/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type BooksDbV6 from '$lib/data/database/books-db/versions/v6/books-db-v6';

import type { StoredBinary } from '../book-binary';

export type StoredBookData = Omit<BooksDbV6['data']['value'], 'blobs' | 'coverImage'> & {
  blobs: Record<string, Blob | StoredBinary>;
  coverImage?: string | Blob | StoredBinary;
};
type BooksDb = {
  [K in keyof BooksDbV6]: K extends 'data'
    ? Omit<BooksDbV6['data'], 'value'> & { value: StoredBookData }
    : BooksDbV6[K];
};

export type BooksDbBookData = BooksDbV6['data']['value'];
export type BooksDbBookmarkData = BooksDb['bookmark']['value'];
export type BooksDbStorageSource = BooksDb['storageSource']['value'];
export type BooksDbStatistic = BooksDb['statistic']['value'];
export type BooksDbReadingGoal = BooksDb['readingGoal']['value'];
export type BooksDbLastModified = BooksDb['lastModified']['value'];
export type BooksDbAudioBook = BooksDb['audioBook']['value'];
export type BooksDbSubtitleData = BooksDb['subtitle']['value'];
export type BooksDbHandle = BooksDb['handle']['value'];
// Portable Ttu archives still contain Blobs and retain the version-6 format.
export const currentDbVersion = 6;
// Only the local IndexedDB representation stores byte records.
export const currentStorageVersion = 7;

export type { BooksDb as default };
