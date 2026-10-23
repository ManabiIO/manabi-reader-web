/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database } from '../data/store';
import { captureLibraryOperation } from './operation-scope';
import {
  readReaderBridgeJournal,
  exportReaderBridgeRecovery,
  restoreReaderBridgeRecovery,
  abandonReaderBridgeDraft,
  type ReaderBridgeJournalScope
} from './reader-bridge-journal';

export const readerBridgeRecoveryChanges = new EventTarget();
export function announceReaderBridgeRecoveryChange() {
  readerBridgeRecoveryChanges.dispatchEvent(new Event('change'));
}
async function withRecovery<T>(
  owner: string,
  signal: AbortSignal | undefined,
  work: (scope: ReaderBridgeJournalScope) => Promise<T>
) {
  const operation = captureLibraryOperation(); // Recovery remains available offline.
  const scope = {
    accountId: owner,
    signal: signal ? AbortSignal.any([signal, operation.signal]) : operation.signal,
    assertCurrent() {
      operation.assertCurrent();
      if (operation.profileId !== owner)
        throw new Error('Switch back to this account before opening sync recovery.');
    }
  };
  try {
    scope.assertCurrent();
    scope.signal.throwIfAborted();
    const value = await work(scope);
    scope.assertCurrent();
    scope.signal.throwIfAborted();
    return value;
  } finally {
    operation.stop();
  }
}
export function readDriveReaderRecovery(owner: string, signal?: AbortSignal) {
  return withRecovery(owner, signal, async (scope) =>
    (await readReaderBridgeJournal(await database.db, scope)).map((row) => ({
      id: row.id,
      revision: row.revision,
      title: row.entry.evidence.book.title,
      phase: row.phase
    }))
  );
}
export function exportDriveReaderRecovery(owner: string, signal?: AbortSignal) {
  return withRecovery(owner, signal, async (scope) =>
    exportReaderBridgeRecovery(await database.db, scope)
  );
}
export async function restoreDriveReaderRecovery(
  owner: string,
  json: string,
  signal?: AbortSignal
) {
  const value = await withRecovery(owner, signal, async (scope) =>
    restoreReaderBridgeRecovery(await database.db, scope, json)
  );
  announceReaderBridgeRecoveryChange();
  return value;
}
export async function abandonDriveReaderDraft(
  owner: string,
  id: string,
  revision: string,
  signal?: AbortSignal
) {
  await withRecovery(owner, signal, async (scope) =>
    abandonReaderBridgeDraft(await database.db, scope, id, revision)
  );
  announceReaderBridgeRecoveryChange();
}
