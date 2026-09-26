/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { EPUB, type FoliateEpubBook } from './epub.js';
import { resolveEpubNavigationHref } from '../functions/file-loaders/epub/epub-link-target.ts';
import {
  LimitedArchive,
  validateArchivePath,
  resolveArchivePath,
  type ArchiveOptions
} from '../functions/file-loaders/utils/limited-archive.ts';

export interface FoliateEpubPublication {
  book: FoliateEpubBook;
  readText(uri: string): Promise<string | null>;
  readBlob(uri: string): Promise<Blob | null>;
  close(): Promise<void>;
}

export function foliateArchiveEntryIndex(
  entries: ReadonlyMap<string, unknown>
): ReadonlyMap<string, string> {
  const resourceIndex = new Map<string, string>();
  for (const literal of entries.keys()) {
    const candidates = new Set([literal]);
    try {
      candidates.add(validateArchivePath(decodeURI(literal)));
    } catch {
      // LimitedArchive validates literal names. Invalid decoded spellings are
      // not exposed as alternate resource names.
    }
    for (const candidate of candidates) {
      const existing = resourceIndex.get(candidate);
      if (existing !== undefined && existing !== literal)
        throw new Error(`Ambiguous EPUB resource path: ${candidate}`);
      resourceIndex.set(candidate, literal);
    }
  }
  return resourceIndex;
}

/** Adapt the bounded archive to Foliate while retaining ownership until close. */
export async function openFoliateEpub(
  blob: Blob,
  options: ArchiveOptions = {}
): Promise<FoliateEpubPublication> {
  const archive = await LimitedArchive.open(blob, options);
  let epub: EPUB | undefined;
  let book: FoliateEpubBook | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (!closing) {
      closed = true;
      options.signal?.removeEventListener('abort', abort);
      // Publish the shared promise before running any reentrant disposal code.
      closing = Promise.resolve().then(async () => {
        try {
          (book ?? epub)?.destroy();
        } finally {
          await archive.close();
        }
      });
    }
    return closing;
  };
  const abort = () => {
    // An abort event has no caller to await cleanup. Explicit close still exposes
    // the same promise, including any cleanup failure, to its owner.
    void close().catch(() => {});
  };
  const assertOpen = () => {
    options.signal?.throwIfAborted();
    if (closed) throw new DOMException('Publication is closed.', 'AbortError');
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    assertOpen();
    const resourceIndex = foliateArchiveEntryIndex(archive.entries);
    const literalName = (uri: string) => {
      const valid = validateArchivePath(uri);
      if (resourceIndex.has(valid)) return resourceIndex.get(valid);
      try {
        return resourceIndex.get(validateArchivePath(decodeURI(valid)));
      } catch {
        return undefined;
      }
    };
    const source = {
      async loadText(uri: string, maximum?: number): Promise<string | null> {
        assertOpen();
        const literal = literalName(uri);
        if (!literal) return null;
        const result = await archive.readText(literal, maximum);
        assertOpen();
        return result;
      },
      async loadBlob(uri: string): Promise<Blob | null> {
        assertOpen();
        const literal = literalName(uri);
        if (!literal) return null;
        const result = await archive.readBlob(literal);
        assertOpen();
        return result;
      },
      getSize(uri: string): number {
        assertOpen();
        const literal = literalName(uri);
        return literal ? (archive.entries.get(literal)?.uncompressedSize ?? 0) : 0;
      }
    };
    epub = new EPUB({
      ...source,
      resolveHref: (href, owner) => resolveArchivePath(owner, href),
      resolveNavigationHref: (href, owner) => resolveEpubNavigationHref(owner, href)
    });
    book = await epub.init();
    assertOpen();
    return { book, readText: source.loadText, readBlob: source.loadBlob, close };
  } catch (error) {
    try {
      await close();
    } catch {
      // Preserve the initialization/read error; cleanup failure must not replace it.
    }
    throw error;
  }
}
