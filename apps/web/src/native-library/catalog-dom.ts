/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** The existing DOM runtime remains the sole downloader, importer and database owner. */
import { loadEditorsPicks, downloadEditorsPick } from '../lib/library/editors-picks';
import {
  EditorsPickStorageHandler,
  findEditorsPickCopy,
  validateEditorsPickCopy
} from '../lib/library/editors-pick-storage';
import { captureLibraryOperation } from '../lib/manabi/operation-scope';
import { sha256 } from '../lib/manabi/sources';
import { importData } from '../lib/functions/replication/replicator';
import {
  database,
  replicationSaveBehavior$,
  statisticsMergeMode$,
  readingGoalsMergeMode$
} from '../lib/data/store';
import { snapshotBookAccessIdentity } from '../lib/data/database/books-db/book-identity';
import { readAdmittedBook } from '../lib/data/database/books-db/admitted-book-read';
import { NativeCatalogService } from './catalog-service';

// Fixed existing public origin. The native bridge never supplies a URL, cookie or endpoint.
export const NATIVE_CATALOG_ORIGIN = 'https://manabi.io';
export function createNativeCatalogService() {
  return new NativeCatalogService({
    load: (authority) => loadEditorsPicks(NATIVE_CATALOG_ORIGIN, authority.signal),
    async prepare(pick, authority) {
      const operation = captureLibraryOperation();
      const signal = AbortSignal.any([authority.signal, operation.signal]);
      const check = () => {
        signal.throwIfAborted();
        operation.assertCurrent();
        authority.assertCurrent();
      };
      try {
        check();
        const owner = operation.profileId;
        const file = await downloadEditorsPick(pick, signal);
        check();
        const digest = await sha256(await file.arrayBuffer());
        check();
        let id = await findEditorsPickCopy(digest, owner, signal);
        check();
        if (id === undefined) {
          // The ordinary importer may find a newly arrived copy before parsing.
          // Capture that exact ID using the same catalog-specific ownership check.
          class CatalogStorage extends EditorsPickStorageHandler {
            override async findReusableBookByContentHash(hash: string) {
              check();
              if (hash !== digest) throw new Error('The catalog download changed.');
              this.savedId = await findEditorsPickCopy(hash, owner, signal);
              check();
              return this.savedId;
            }
          }
          const handler = new CatalogStorage(window, digest, owner, signal);
          handler.updateSettings(
            window,
            true,
            replicationSaveBehavior$.getValue(),
            statisticsMergeMode$.getValue(),
            readingGoalsMergeMode$.getValue()
          );
          const error = await importData(document, handler, [file], signal);
          check();
          if (error) throw new Error(error);
          id = handler.savedId;
        }
        if (id === undefined) throw new Error('The catalog book could not be saved.');
        await validateEditorsPickCopy(id, digest, owner, signal);
        check();
        const db = await database.db;
        const book = await db.get('data', id);
        check();
        if (
          !book ||
          book.contentHash?.toLowerCase() !== digest ||
          book.storageSource ||
          !book.elementHtml
        )
          throw new Error('The catalog copy changed. Refresh the Library.');
        const identity = snapshotBookAccessIdentity({
          bookId: id,
          contentHash: digest,
          readerBookKey: `content:${digest}`,
          title: book.title,
          lastBookModified: book.lastBookModified
        });
        const admitted = await readAdmittedBook(db, identity, {
          profileId: owner,
          signal,
          assertCurrent: check
        });
        check();
        if (admitted.storageSource || !admitted.elementHtml)
          throw new Error('The catalog copy changed. Refresh the Library.');
        return identity;
      } finally {
        operation.stop();
      }
    }
  });
}
