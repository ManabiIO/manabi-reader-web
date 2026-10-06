/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** DOM only. No route hint, raw book ID or supplied title grants Library access. */
import type { NativeLibraryService } from '../native-library/service';
import {
  readStatisticsSnapshot,
  admitStatisticsLibrarySelection,
  type NativeStatisticsAuthority
} from './native-service';

export async function readNativeStatisticsRequest(
  payload: Record<string, unknown>,
  authority: NativeStatisticsAuthority,
  library: Pick<NativeLibraryService, 'admitAccess'>
) {
  if (Object.hasOwn(payload, 'sharedVersion')) {
    const { readSharedStatisticsRequest } = await import('../features/statistics/native-owner.dom');
    return readSharedStatisticsRequest(payload, authority);
  }
  if (!Object.hasOwn(payload, 'librarySelection'))
    return readStatisticsSnapshot(payload, authority);
  const selection = payload.librarySelection;
  const admissionOnly = Object.hasOwn(payload, 'admissionVersion');
  if (
    Object.keys(payload).length !== (admissionOnly ? 2 : 1) ||
    (admissionOnly && payload.admissionVersion !== 1) ||
    Object.keys(payload).some((key) => key !== 'librarySelection' && key !== 'admissionVersion') ||
    !selection ||
    typeof selection !== 'object' ||
    Array.isArray(selection) ||
    Object.keys(selection).length !== 2 ||
    !('token' in selection) ||
    !('key' in selection) ||
    (admissionOnly &&
      (typeof selection.token !== 'string' ||
        !selection.token.length ||
        selection.token.length > 128 ||
        typeof selection.key !== 'string' ||
        !selection.key.length ||
        selection.key.length > 128))
  )
    throw new Error('Invalid Library statistics selection.');
  const identities = await library.admitAccess(
    { token: selection.token, keys: [selection.key], operation: 'open' },
    authority
  );
  authority.assertCurrent();
  authority.signal.throwIfAborted();
  if (identities.length !== 1) throw new Error('Select one imported book.');
  return admissionOnly
    ? admitStatisticsLibrarySelection(identities[0], authority)
    : readStatisticsSnapshot({}, authority, identities[0]);
}
