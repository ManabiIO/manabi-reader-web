/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database } from '../data/store';
import { captureLibraryOperation } from './operation-scope';
import { captureDriveReaderPreview, type DriveReaderPreview } from './reader-bridge-source';
import {
  listReaderBridgeLocalBooks,
  compareReaderBridgeLocalBook,
  type ReaderBridgeLocalScope
} from './reader-bridge-local-book';

async function withPreview<T>(
  preview: DriveReaderPreview,
  signal: AbortSignal | undefined,
  work: (
    prepared: ReturnType<typeof captureDriveReaderPreview>,
    scope: ReaderBridgeLocalScope
  ) => Promise<T>
) {
  const prepared = captureDriveReaderPreview(preview);
  const operation = captureLibraryOperation(prepared.selection.owner);
  const scope = {
    profileId: operation.profileId,
    signal: signal ? AbortSignal.any([signal, operation.signal]) : operation.signal,
    assertCurrent() {
      prepared.assertCurrent();
      operation.assertCurrent();
      if (operation.profileId !== prepared.selection.owner)
        throw new Error('The signed-in account changed. Refresh the Drive preview.');
    }
  };
  try {
    scope.signal.throwIfAborted();
    scope.assertCurrent();
    const value = await work(prepared, scope);
    scope.signal.throwIfAborted();
    scope.assertCurrent();
    return value;
  } finally {
    operation.stop();
  }
}

export function listDriveReaderLocalBooks(preview: DriveReaderPreview, signal?: AbortSignal) {
  return withPreview(preview, signal, async (_prepared, scope) =>
    listReaderBridgeLocalBooks(await database.db, scope)
  );
}

export function compareDriveReaderLocalBook(
  preview: DriveReaderPreview,
  bookId: number,
  signal?: AbortSignal
) {
  return withPreview(preview, signal, async (prepared, scope) =>
    compareReaderBridgeLocalBook(
      await database.db,
      scope,
      prepared.content,
      preview.characters,
      bookId,
      document
    )
  );
}
