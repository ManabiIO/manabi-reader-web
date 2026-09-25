/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { EPUB, type FoliateEpubBook } from './epub.js';
import {
  LimitedArchive,
  validateArchivePath,
  type ArchiveOptions
} from '../functions/file-loaders/utils/limited-archive';

export interface FoliateEpubPublication {
  book: FoliateEpubBook;
  close(): Promise<void>;
}

export function foliateArchiveEntryIndex(
  entries: ReadonlyMap<string, unknown>
): ReadonlyMap<string, string> {
  const resourceIndex = foliateArchiveEntryIndex(archive.entries);
  const literalName = (uri: string) => resourceIndex.get(uri);
  const source = {
    async loadText(uri: string): Promise<string | null> {
      const literal = literalName(uri);
      return literal ? archive.readText(literal) : null;
    },
    async loadBlob(uri: string): Promise<Blob | null> {
      const literal = literalName(uri);
      return literal ? archive.readBlob(literal) : null;
    },
    getSize(uri: string): number {
      const literal = literalName(uri);
      return literal ? (archive.entries.get(literal)?.uncompressedSize ?? 0) : 0;
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
