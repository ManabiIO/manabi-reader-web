/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase } from 'idb';
import type BooksDb from '../data/database/books-db/versions/books-db';
import { commitTransaction } from '../data/database/books-db/commit-transaction.mjs';
import {
  captureReaderBridgeLocalBook,
  sameReaderBridgeStoredValue,
  type ReaderBridgeLocalScope
} from './reader-bridge-local-book';
import {
  captureDriveReaderPreview,
  recheckDriveReaderPreview,
  type DriveReaderPreview
} from './reader-bridge-source';
import { canonical } from './ttu-migration-format';
import {
  ReaderBridgeConnectionError,
  connectionUuid,
  validateReaderBridgeConnectionRecord,
  verifyReaderBridgeConnectionDescriptor,
  assertReaderBridgeConnectionCapacity,
  READER_BRIDGE_CONNECTION_LIMITS,
  type ReaderBridgeConnectionRecord,
  type ReaderBridgeConnectionDescriptor
} from './reader-bridge-connection-model';

function guard(scope: ReaderBridgeLocalScope) {
  const accountId = scope.profileId;
  if (!accountId) throw new ReaderBridgeConnectionError('changed');
  return () => {
    scope.signal?.throwIfAborted();
    scope.assertCurrent();
    if (scope.profileId !== accountId) throw new ReaderBridgeConnectionError('changed');
  };
}
const changed = (): never => {
  throw new ReaderBridgeConnectionError('changed');
};
function cancelTransaction(tx: { abort(): void }, signal?: AbortSignal) {
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  return () => signal?.removeEventListener('abort', abort);
}
function sameConnection(
  left: ReaderBridgeConnectionDescriptor,
  right: ReaderBridgeConnectionDescriptor
) {
  const stable = (value: ReaderBridgeConnectionDescriptor) => ({
    accountId: value.accountId,
    binding: value.binding,
    fingerprint: value.fingerprint,
    characters: value.characters,
    local: value.local,
    source: {
      ...value.source,
      observedRevision: undefined,
      files: value.source.files
        .map(({ role, id, version, md5 }) =>
          role === 'book' ? { role, id, version, md5 } : { role, id }
        )
        .sort((a, b) => a.role.localeCompare(b.role))
    }
  });
  return canonical(stable(left)) === canonical(stable(right));
}
/** Explicitly remembers a genuine compared pair. No reading state, journal
 * baseline, automatic receive or outgoing write is authorized by this record. */
export async function saveReaderBridgeConnection(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeLocalScope,
  preview: DriveReaderPreview,
  comparison: object
): Promise<ReaderBridgeConnectionRecord> {
  const scoped = guard(scope),
    remote = captureDriveReaderPreview(preview),
    local = captureReaderBridgeLocalBook(comparison);
  const check = () => {
    scoped();
    remote.assertCurrent();
    local.assertCurrent();
    if (
      scope.profileId !== remote.selection.owner ||
      scope.profileId !== local.profileId ||
      local.fingerprint !== preview.projection.snapshot.fingerprint ||
      local.snapshot.book.characters !== preview.characters
    )
      changed();
  };
  check();
  const snapshot = preview.projection.snapshot;
  const candidate: ReaderBridgeConnectionDescriptor = {
    accountId: scope.profileId!,
    binding: snapshot.binding,
    title: local.snapshot.book.title,
    fingerprint: local.fingerprint,
    characters: preview.characters,
    local: { bookId: local.snapshot.book.id, identity: crypto.randomUUID() },
    source: {
      provider: 'google',
      connection: remote.selection.connection,
      generation: remote.observation.generation,
      root: remote.selection.root,
      folder: remote.selection.folder,
      packageId: preview.packageId,
      profile: remote.selection.profile,
      observedRevision: remote.observation.revision,
      files: remote.observation.files.map(({ role, id, version, md5 }) => ({
        role,
        id,
        version,
        md5
      }))
    }
  };
  await verifyReaderBridgeConnectionDescriptor(candidate);
  await recheckDriveReaderPreview(preview, scope.signal);
  check();
  const tx = db.transaction(
    ['data', 'bookmark', 'readerBookScope', 'readerLocalIdentity', 'readerBridgeConnection'],
    'readwrite'
  );
  const stop = cancelTransaction(tx, scope.signal);
  try {
    return await commitTransaction(tx, async () => {
      check();
      const id = candidate.local.bookId;
      const [book, owner, resume, identity, identities, stored] = await Promise.all([
        tx.objectStore('data').get(id),
        tx.objectStore('readerBookScope').get(id),
        tx.objectStore('bookmark').get(id),
        tx.objectStore('readerLocalIdentity').get(id),
        tx.objectStore('readerLocalIdentity').getAll(),
        tx
          .objectStore('readerBridgeConnection')
          .index('accountId')
          .getAll(candidate.accountId, READER_BRIDGE_CONNECTION_LIMITS.records + 1)
      ]);
      check();
      if (!sameReaderBridgeStoredValue({ book, owner, resume }, local.snapshot)) changed();
      if (identity) {
        if (identity.bookId !== id || !connectionUuid(identity.uuid)) changed();
        candidate.local.identity = identity.uuid;
      }
      if (identities.some((row) => row.bookId !== id && row.uuid === candidate.local.identity))
        changed();
      const rows = stored.map(validateReaderBridgeConnectionRecord);
      assertReaderBridgeConnectionCapacity(rows);
      const existing = rows.filter(
        (row) =>
          row.state === 'linked' &&
          (row.binding === candidate.binding ||
            row.bookId === id ||
            row.descriptor.local.identity === candidate.local.identity)
      );
      if (existing.length) {
        if (existing.length !== 1 || !sameConnection(existing[0].descriptor, candidate))
          throw new ReaderBridgeConnectionError('exists');
        return existing[0]; // A repeated explicit save does not refresh or replace source identity.
      }
      const record: ReaderBridgeConnectionRecord = {
        id: crypto.randomUUID(),
        version: 1,
        revision: crypto.randomUUID(),
        state: 'linked',
        accountId: candidate.accountId,
        bookId: id,
        binding: candidate.binding,
        descriptor: candidate
      };
      validateReaderBridgeConnectionRecord(record);
      assertReaderBridgeConnectionCapacity([...rows, record]);
      if (!identity)
        await tx
          .objectStore('readerLocalIdentity')
          .put({ bookId: id, uuid: candidate.local.identity });
      check();
      if (!owner)
        await tx.objectStore('readerBookScope').put({ bookId: id, accountId: candidate.accountId });
      check();
      await tx.objectStore('readerBridgeConnection').add(record);
      check();
      return record;
    });
  } finally {
    stop();
  }
}
export async function listReaderBridgeConnections(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeLocalScope
) {
  const check = guard(scope);
  check();
  const rows = (
    await db.getAllFromIndex(
      'readerBridgeConnection',
      'accountId',
      scope.profileId!,
      READER_BRIDGE_CONNECTION_LIMITS.records + 1
    )
  ).map(validateReaderBridgeConnectionRecord);
  assertReaderBridgeConnectionCapacity(rows);
  for (const row of rows) {
    await verifyReaderBridgeConnectionDescriptor(row.descriptor);
    check();
  }
  check();
  return rows;
}
/** Forget only this saved pair or inactive hint. Reading data and recovery
 * evidence remain available; an old tab cannot remove a replacement record. */
export async function removeReaderBridgeConnection(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeLocalScope,
  id: string,
  revision: string
) {
  const check = guard(scope);
  check();
  if (!connectionUuid(revision) || typeof id !== 'string' || id.length > 100) changed();
  const tx = db.transaction('readerBridgeConnection', 'readwrite');
  const stop = cancelTransaction(tx, scope.signal);
  try {
    await commitTransaction(tx, async () => {
      check();
      const before = await tx.store.get(id);
      check();
      if (!before || before.accountId !== scope.profileId || before.revision !== revision)
        changed();
      validateReaderBridgeConnectionRecord(before);
      await tx.store.delete(id);
      check();
    });
  } finally {
    stop();
  }
}
