/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database } from '../data/store';
import { captureLibraryOperation } from './operation-scope';
import {
  connectionUuid,
  ReaderBridgeConnectionError,
  validateReaderBridgeConnectionRecord,
  type ReaderBridgeConnectionRecord
} from './reader-bridge-connection-model';
import { ReaderBridgeLocalStateError } from './reader-bridge-local-state';
import { ReaderBridgeJournalError } from './reader-bridge-journal';
import { checkSavedDriveReaderConnection } from './reader-bridge-saved';
import { reviewDriveReaderChanges, receiveDriveReaderChanges } from './reader-bridge-local';
import { canonical } from './ttu-migration-format';

export interface ReaderBridgeAutomaticReceiveResult {
  state: 'received' | 'unchanged' | 'review';
  observedAt: string;
}

/** Incoming-only three-way merge. Shared agreement is acknowledged once, local
 * edits remain local, and divergent or missing values wait for explicit review.
 * The normal reader lease, remote rechecks and durable receive journal apply;
 * consent is checked again within the transaction that saves reading data. */
export async function receiveSavedDriveReaderChanges(
  owner: string,
  id: string,
  revision: string,
  signal?: AbortSignal
): Promise<ReaderBridgeAutomaticReceiveResult> {
  if (!owner || !connectionUuid(id) || !connectionUuid(revision))
    throw new ReaderBridgeConnectionError('changed');
  signal?.throwIfAborted();
  const operation = captureLibraryOperation(owner);
  const lifetime = signal ? AbortSignal.any([signal, operation.signal]) : operation.signal;
  const check = () => {
    lifetime.throwIfAborted();
    operation.assertCurrent();
    if (operation.profileId !== owner) throw new ReaderBridgeConnectionError('changed');
  };
  const result = (state: ReaderBridgeAutomaticReceiveResult['state']) => ({
    state,
    observedAt: new Date().toISOString()
  });
  try {
    check();
    const db = await database.db;
    check();
    const readConsent = async (expected?: ReaderBridgeConnectionRecord) => {
      const stored = await db.get('readerBridgeConnection', id);
      check();
      if (!stored) throw new ReaderBridgeConnectionError('changed');
      const record = validateReaderBridgeConnectionRecord(stored);
      if (
        record.accountId !== owner ||
        record.id !== id ||
        record.revision !== revision ||
        record.state !== 'linked' ||
        record.automaticChecks !== true ||
        record.automaticReceive !== true ||
        (expected && canonical(record) !== canonical(expected))
      )
        throw new ReaderBridgeConnectionError('changed');
      return record;
    };
    const record = await readConsent();
    const { preview, comparison } = await checkSavedDriveReaderConnection(
      owner,
      id,
      revision,
      lifetime
    );
    check();
    const review = await reviewDriveReaderChanges(preview, comparison, lifetime);
    check();
    await readConsent(record);
    if (review.plan.state !== 'ready') return result('review');
    // No repeated journal entries when only local pending edits or an already
    // acknowledged remote state remain. A new equality still establishes the
    // baseline needed to detect later changes on just one side.
    if (!review.needsAcceptance) return result('unchanged');
    await receiveDriveReaderChanges(review, 'incoming', lifetime, record);
    check();
    return result(review.plan.pull.length ? 'received' : 'unchanged');
  } catch (error) {
    check();
    if (
      error instanceof ReaderBridgeConnectionError ||
      error instanceof ReaderBridgeLocalStateError ||
      error instanceof ReaderBridgeJournalError
    )
      return result('review');
    throw error;
  } finally {
    operation.stop();
  }
}
