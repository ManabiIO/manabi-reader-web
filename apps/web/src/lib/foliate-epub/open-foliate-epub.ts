/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { EPUB, type FoliateEpubBook } from './epub.js';
import { LimitedArchive, type ArchiveOptions } from '../functions/file-loaders/utils/limited-archive';

export interface FoliateEpubPublication {
  book: FoliateEpubBook;
  close(): Promise<void>;
}

/**
 * Adapt Reader Web's bounded/cancellable ZIP implementation to Foliate's EPUB
 * source interface. Missing optional EPUB entries are represented as null;
 * unsafe paths, corrupt entries and quota failures remain hard errors.
 */
export async function openFoliateEpub(
  blob: Blob,
  options: ArchiveOptions = {}
): Promise<FoliateEpubPublication> {
  const archive = await LimitedArchive.open(blob, options);
  let closed = false;
  const source = {
    async loadText(uri: string): Promise<string | null> {
      if (!archive.entries.has(uri)) return null;
      return archive.readText(uri);
    },
    async loadBlob(uri: string): Promise<Blob | null> {
      if (!archive.entries.has(uri)) return null;
      return archive.readBlob(uri);
    },
    getSize(uri: string): number {
      return archive.entries.get(uri)?.uncompressedSize ?? 0;
    }
  };

  try {
    const epub = new EPUB(source);
    const book = await epub.init();
    return {
      book,
      async close() {
        if (closed) return;
        closed = true;
        try {
          book.destroy();
        } finally {
          await archive.close();
        }
      }
    };
  } catch (error) {
    await archive.close();
    throw error;
  }
}
