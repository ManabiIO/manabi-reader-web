/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database } from '../data/store';
import { commitTransaction } from '../data/database/books-db/commit-transaction.mjs';
import { assertBookPersonalAccess } from '../data/database/books-db/book-records';
import { captureLibraryOperation } from './operation-scope';
import { captureDriveReaderPreview, previewDriveReaderBridge } from './reader-bridge-source';
import {
  captureReaderBridgeLocalBook,
  compareReaderBridgeLocalBook,
  sameReaderBridgeStoredValue,
  type ReaderBridgeLocalBookSnapshot
} from './reader-bridge-local-book';
import {
  connectionUuid,
  ReaderBridgeConnectionError,
  validateReaderBridgeConnectionRecord,
  verifyReaderBridgeConnectionDescriptor,
  type ReaderBridgeConnectionRecord
} from './reader-bridge-connection-model';
import { canonical } from './ttu-migration-format';

function changed(): never {
  throw new ReaderBridgeConnectionError('changed');
}

/** Reopen an explicitly saved pair as a fresh, read-only comparison. A saved
 * title, numeric local ID or old Drive digest is not authority to select another
 * copy. Progress may advance on the same source files; replacements need a new
 * explicit pairing. This does not acknowledge a baseline or enable auto-sync. */
export async function checkSavedDriveReaderConnection(
  owner: string,
  id: string,
  revision: string,
  signal?: AbortSignal
) {
  if (!owner || !connectionUuid(id) || !connectionUuid(revision)) changed();
  signal?.throwIfAborted();
  const operation = captureLibraryOperation(owner);
  const scope = {
    profileId: operation.profileId,
    signal: signal ? AbortSignal.any([signal, operation.signal]) : operation.signal,
    assertCurrent() {
      operation.assertCurrent();
      if (operation.profileId !== owner) changed();
    }
  };
  const check = () => {
    scope.signal.throwIfAborted();
    scope.assertCurrent();
  };
  try {
    check();
    const db = await database.db;
    check();
    const read = async (
      expected?: ReaderBridgeConnectionRecord,
      compared?: ReaderBridgeLocalBookSnapshot
    ) => {
      check();
      const tx = db.transaction([
        'readerBridgeConnection',
        'readerLocalIdentity',
        'data',
        'readerBookScope',
        'bookmark'
      ]);
      return commitTransaction(tx, async () => {
        const stored = await tx.objectStore('readerBridgeConnection').get(id);
        check();
        if (
          !stored ||
          stored.id !== id ||
          stored.accountId !== owner ||
          stored.revision !== revision ||
          stored.state !== 'linked'
        )
          changed();
        const record = validateReaderBridgeConnectionRecord(stored);
        if (expected && canonical(record) !== canonical(expected)) changed();
        const bookId = record.descriptor.local.bookId;
        const [book, identity, identities, account, resume] = await Promise.all([
          tx.objectStore('data').get(bookId),
          tx.objectStore('readerLocalIdentity').get(bookId),
          tx.objectStore('readerLocalIdentity').getAll(),
          tx.objectStore('readerBookScope').get(bookId),
          tx.objectStore('bookmark').get(bookId)
        ]);
        check();
        if (
          !book ||
          book.id !== bookId ||
          book.characters !== record.descriptor.characters ||
          !identity ||
          identity.bookId !== bookId ||
          identity.uuid !== record.descriptor.local.identity ||
          !account ||
          account.bookId !== bookId ||
          account.accountId !== owner ||
          identities.some((row) => row.bookId !== bookId && row.uuid === identity.uuid)
        )
          changed();
        try {
          assertBookPersonalAccess(book, account, owner);
        } catch {
          changed();
        }
        if (compared && !sameReaderBridgeStoredValue({ book, owner: account, resume }, compared))
          changed();
        return record;
      });
    };
    const record = await read();
    const descriptor = await verifyReaderBridgeConnectionDescriptor(record.descriptor);
    check();
    const source = descriptor.source;
    const preview = await previewDriveReaderBridge(
      {
        owner,
        connection: source.connection,
        root: source.root,
        folder: source.folder,
        profile: source.profile
      },
      scope.signal
    );
    check();
    const prepared = captureDriveReaderPreview(preview);
    const observed = prepared.observation;
    const snapshot = preview.projection.snapshot;
    if (
      prepared.selection.owner !== owner ||
      prepared.selection.connection !== source.connection ||
      prepared.selection.root !== source.root ||
      prepared.selection.folder !== source.folder ||
      prepared.selection.profile !== source.profile ||
      observed.generation !== source.generation ||
      observed.profile !== source.profile ||
      observed.folder.id !== source.folder ||
      canonical(observed.folder.parents) !== canonical([source.root]) ||
      preview.packageId !== source.packageId ||
      snapshot.binding !== descriptor.binding ||
      snapshot.fingerprint !== descriptor.fingerprint ||
      snapshot.profile !== source.profile ||
      snapshot.generation !== source.generation ||
      preview.characters !== descriptor.characters ||
      observed.files.length !== source.files.length
    )
      changed();
    for (const saved of source.files) {
      const current = observed.files.find((file) => file.role === saved.role);
      if (
        !current ||
        current.id !== saved.id ||
        (saved.role === 'book' && (current.version !== saved.version || current.md5 !== saved.md5))
      )
        changed();
    }
    const comparison = await compareReaderBridgeLocalBook(
      db,
      scope,
      prepared.content,
      preview.characters,
      descriptor.local.bookId,
      document
    );
    check();
    prepared.assertCurrent();
    if (!comparison.matches) changed();
    const compared = captureReaderBridgeLocalBook(comparison);
    if (compared.profileId !== owner || compared.fingerprint !== descriptor.fingerprint) changed();
    await read(record, compared.snapshot);
    check();
    prepared.assertCurrent();
    compared.assertCurrent();
    return { preview, comparison };
  } finally {
    operation.stop();
  }
}
