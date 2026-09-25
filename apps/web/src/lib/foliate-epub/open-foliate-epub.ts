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
  const resourceIndex = new Map<string, string>();
  for (const literal of archive.entries.keys()) {
    const candidates = new Set([literal]);
    try {
      candidates.add(validateArchivePath(decodeURI(literal)));
    } catch {
      // The literal path was validated by LimitedArchive. A malformed decoded
      // spelling simply is not exposed as an alternate resource name.
    }
    for (const candidate of candidates) {
      const existing = resourceIndex.get(candidate);
      if (existing && existing !== literal) {
        await archive.close();
        throw new Error(`Ambiguous EPUB resource path: ${candidate}`);
      }
      resourceIndex.set(candidate, literal);
    }
  }
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
