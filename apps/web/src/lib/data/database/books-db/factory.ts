/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { currentStorageVersion, type default as BooksDb } from './versions/books-db';
import { openDB, unwrap } from 'idb';
import upgradeBooksDbFromV2 from './versions/v2/upgrade';
import { ensureBooksSchema } from './schema';

export function createBooksDb(name = 'books') {
  let upgradeFailure: unknown;
  let failed = false;
  const opening = openDB<BooksDb>(name, currentStorageVersion, {
    upgrade(db, oldVersion, newVersion, transaction) {
      // idb does not await the upgrade callback's return value. Observe both
      // completion and conversion failure explicitly, before issuing requests.
      void transaction.done.catch(() => undefined);
      const abort = (cause: unknown) => {
        if (!failed) upgradeFailure = cause;
        failed = true;
        try {
          transaction.abort();
        } catch {
          // A native request may already have aborted the same transaction.
        }
      };
      const install = () => ensureBooksSchema(unwrap(db), unwrap(transaction));
      try {
        if (oldVersion === 2) {
          // Only IndexedDB awaits are allowed here; no Blob, network or timer
          // work. Parsing/conversion failures must roll back version and data.
          void upgradeBooksDbFromV2(db, oldVersion, newVersion, transaction)
            .then(install)
            .catch(abort);
        } else {
          install();
        }
      } catch (cause) {
        abort(cause);
      }
    }
  });
  return opening.catch((cause) => {
    throw failed ? upgradeFailure : cause;
  });
}
