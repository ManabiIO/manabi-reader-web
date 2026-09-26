/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type BooksDbV10 from '$lib/data/database/books-db/versions/v10/books-db-v10';

import type { StoredBinary } from '../book-binary';

export type StoredBookData = Omit<BooksDbV10['data']['value'], 'blobs' | 'coverImage'> & {
  blobs: Record<string, Blob | StoredBinary>;
  coverImage?: string | Blob | StoredBinary;
};
type BooksDb = {
  [K in keyof BooksDbV10]: K extends 'data'
    ? Omit<BooksDbV10['data'], 'value'> & { value: StoredBookData }
    : BooksDbV10[K];
};

export type BooksDbBookData = BooksDbV10['data']['value'];
export type BooksDbBookmarkData = BooksDb['bookmark']['value'];
export type BooksDbStorageSource = BooksDb['storageSource']['value'];
export type BooksDbStatistic = BooksDb['statistic']['value'];
export type BooksDbContentStatistic = BooksDb['readerStatistic']['value'];
export type BooksDbReadingGoal = BooksDb['readingGoal']['value'];
export type BooksDbLastModified = BooksDb['lastModified']['value'];
export type BooksDbAudioBook = BooksDb['audioBook']['value'];
export type BooksDbSubtitleData = BooksDb['subtitle']['value'];
export type BooksDbHandle = BooksDb['handle']['value'];
// Local byte records require a new storage version; portable archives keep their wire format.
export const currentDbVersion = 11;
export const currentStorageVersion = currentDbVersion;
export const ttuWireVersion = 8;

export type { BooksDb as default };
