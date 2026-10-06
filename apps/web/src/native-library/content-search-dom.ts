/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Import only in the existing single DOM reader runtime. */
import { captureLibraryOperation } from '../lib/manabi/operation-scope';
import { readerBookKeyFor } from '../lib/reader-identity';
import { searchBookContents } from '../lib/search/book-content-source';
import { snapshotReaderLocator } from '../lib/reader-location';
import type { NativeLibraryService } from './service';
import { NativeLibraryContentSearchService } from './content-search-service';

export function createNativeLibraryContentSearchService(library: NativeLibraryService) {
  return new NativeLibraryContentSearchService({
    books: (view, authority) => library.searchBooks(view, authority),
    async search(query, books, authority, receive) {
      // The bridge command has already returned. Own this profile subscription until the
      // existing worker finishes or the native query, route, account or runtime is cancelled.
      const operation = captureLibraryOperation();
      const signal = AbortSignal.any([authority.signal, operation.signal]);
      let stopped = false;
      let stopWorker: (() => void) | undefined;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        stopWorker?.();
        operation.stop();
        signal.removeEventListener('abort', stop);
      };
      signal.addEventListener('abort', stop, { once: true });
      try {
        signal.throwIfAborted();
        operation.assertCurrent();
        authority.assertCurrent();
        stopWorker = await searchBookContents(
          query,
          books,
          operation.profileId,
          signal,
          (batch) => {
            if (stopped) return;
            try {
              signal.throwIfAborted();
              operation.assertCurrent();
              authority.assertCurrent();
              receive(batch);
            } catch (cause) {
              stop();
              throw cause;
            } finally {
              if (!batch.busy) stop();
            }
          },
          { progress: false }
        );
        if (stopped) stopWorker();
        return stop;
      } catch (cause) {
        stop();
        throw cause;
      }
    },
    async validate(book, locator, authority) {
      const identity = await library.validateSearchBook(book, authority);
      authority.signal.throwIfAborted();
      authority.assertCurrent();
      const readerBookKey = await readerBookKeyFor(identity.bookId, identity.contentHash);
      authority.signal.throwIfAborted();
      authority.assertCurrent();
      if (!snapshotReaderLocator(locator, readerBookKey))
        throw new Error('This passage belongs to a different saved copy. Search again.');
      return { ...identity, readerBookKey };
    }
  });
}
