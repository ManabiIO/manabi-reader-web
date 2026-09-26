/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { EPUB, type FoliateEpubBook } from './epub.js';
import {
  LimitedArchive,
  resolveArchivePath,
  validateArchivePath,
  type ArchiveOptions
} from '../functions/file-loaders/utils/limited-archive.ts';

export interface FoliateEpubSource {
  loadText(uri: string, maximum?: number): Promise<string | null>;
  loadBlob(uri: string): Promise<Blob | null>;
  getSize(uri: string): number;
}

export interface FoliateEpubPublication {
  book: FoliateEpubBook;
  source: FoliateEpubSource;
  close(): Promise<void>;
}

export function foliateArchiveEntryIndex(
  entries: ReadonlyMap<string, unknown>
): ReadonlyMap<string, string> {
  const resourceIndex = new Map<string, string>();
  for (const literal of entries.keys()) {
    const candidates = new Set([literal]);
    for (const decode of [decodeURI, decodeURIComponent]) {
      try {
        candidates.add(validateArchivePath(decode(literal)));
      } catch {
        // Invalid decoded spellings are not exposed as alternate resource names.
      }
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

/** Archive paths and URL fragments are different namespaces; decode exactly once. */
export function resolveFoliateResource(reference: string, owner: string): string {
  const fragmentAt = reference.indexOf('#');
  const pathReference = (fragmentAt < 0 ? reference : reference.slice(0, fragmentAt)).split(
    '?',
    1
  )[0];
  const ownerPath = owner.split(/[?#]/, 1)[0];
  const path = pathReference
    ? resolveArchivePath(decodeURIComponent(ownerPath), pathReference)
    : validateArchivePath(decodeURIComponent(ownerPath));
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return encoded + (fragmentAt < 0 ? '' : reference.slice(fragmentAt));
}

/** Adapt the bounded archive to Foliate while retaining ownership until close. */
export async function openFoliateEpub(
  blob: Blob,
  options: ArchiveOptions = {}
): Promise<FoliateEpubPublication> {
  const archive = await LimitedArchive.open(blob, options);
  let closed = false;
  let epub: EPUB | undefined;
  let book: FoliateEpubBook | undefined;
  let closing: Promise<void> | undefined;
  const texts = new Map<string, Promise<string>>();
  const blobs = new Map<string, Promise<Blob>>();
  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    options.signal?.removeEventListener('abort', abort);
    try {
      (book ?? epub)?.destroy();
    } finally {
      texts.clear();
      blobs.clear();
      closing = archive.close();
    }
    return closing;
  };
  const abort = () => {
    void close().catch(() => {});
  };
  try {
    const resourceIndex = foliateArchiveEntryIndex(archive.entries);
    const literalName = (uri: string): string | undefined => {
      if (closed) throw new DOMException('EPUB publication is closed.', 'AbortError');
      options.signal?.throwIfAborted();
      // Foliate passes package-relative URL paths. A missing optional resource is
      // null, but malformed paths, traversal and decoder failures remain errors.
      const decoded = validateArchivePath(decodeURIComponent(uri));
      const literal = resourceIndex.get(decoded) ?? resourceIndex.get(uri);
      return literal && !archive.entries.get(literal)?.directory ? literal : undefined;
    };
    const source: FoliateEpubSource = {
      async loadText(uri, maximum) {
        const literal = literalName(uri);
        if (!literal) return null;
        if (
          maximum !== undefined &&
          (archive.entries.get(literal)?.uncompressedSize ?? 0) > maximum
        )
          return archive.readText(literal, maximum); // Preserve the bounded-reader error type.
        let pending = texts.get(literal);
        if (!pending) {
          pending = archive.readText(literal, maximum);
          texts.set(literal, pending);
        }
        const value = await pending;
        literalName(uri);
        return value;
      },
      async loadBlob(uri) {
        const literal = literalName(uri);
        if (!literal) return null;
        let pending = blobs.get(literal);
        if (!pending) {
          pending = archive.readBlob(literal);
          blobs.set(literal, pending);
        }
        const value = await pending;
        literalName(uri);
        return value;
      },
      getSize(uri) {
        const literal = literalName(uri);
        return literal ? (archive.entries.get(literal)?.uncompressedSize ?? 0) : 0;
      }
    };
    epub = new EPUB({ ...source, resolveResource: resolveFoliateResource });
    options.signal?.addEventListener('abort', abort, { once: true });
    options.signal?.throwIfAborted();
    book = await epub.init();
    options.signal?.throwIfAborted();
    return { book, source, close };
  } catch (error) {
    await close();
    throw error;
  }
}
