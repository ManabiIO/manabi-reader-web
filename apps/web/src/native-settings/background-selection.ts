/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  IMPORT_CHUNK_BYTES,
  sameScope,
  type BridgeMethod,
  type BridgeScope
} from '../platform/bridge-contract';
import { bytesToBase64 } from '../platform/transfer-encoding';
import {
  parseBackgroundSlot,
  parseBackgroundImportTarget,
  BACKGROUND_IMPORT_MAX_BYTES,
  type BackgroundSlot
} from './background-contract';

interface BackgroundAsset {
  uri: string;
  name: string;
  mimeType?: string | null;
}
interface BackgroundFile {
  size: number;
  open(): { readBytes(length: number): Promise<Uint8Array>; close(): void };
}
export interface BackgroundSelectionDependencies {
  scope(): BridgeScope;
  pick(): Promise<{ canceled: boolean; assets?: BackgroundAsset[] | null }>;
  file(uri: string): BackgroundFile;
  command(method: BridgeMethod, payload: Record<string, unknown>): Promise<unknown>;
}
let serial = 0;
/** Only native user-selected bytes enter this upload. The DOM never receives a URI. */
export async function selectNativeBackground(
  dependencies: BackgroundSelectionDependencies,
  selection: BackgroundSlot,
  signal: AbortSignal
): Promise<boolean> {
  const { session, epoch } = dependencies.scope();
  const owner = { session, epoch };
  const target = { ...selection };
  const check = () => {
    signal.throwIfAborted();
    if (!owner.session || !sameScope(owner, dependencies.scope()))
      throw new Error(
        'The reader or account changed. Reopen background images before choosing a file.'
      );
  };
  check();
  const selected = await dependencies.pick();
  check();
  if (selected.canceled) return false;
  if (selected.assets?.length !== 1) throw new Error('Choose one background image.');
  const asset = selected.assets[0];
  const slot = parseBackgroundSlot(target);
  const extension = asset.name.split('.').pop()?.toLowerCase();
  const fallback =
    extension === 'png'
      ? 'image/png'
      : extension === 'webp'
        ? 'image/webp'
        : extension === 'jpg' || extension === 'jpeg'
          ? 'image/jpeg'
          : '';
  const type = ['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType ?? '')
    ? asset.mimeType
    : fallback;
  const background = parseBackgroundImportTarget({ ...slot, type });
  const file = dependencies.file(asset.uri);
  const size = file.size;
  check();
  if (!Number.isSafeInteger(size) || size < 1 || size > BACKGROUND_IMPORT_MAX_BYTES)
    throw new Error('Choose a background image no larger than 8 MB.');
  const transferId = `background_upload_${Date.now()}_${++serial}`;
  let handle: ReturnType<BackgroundFile['open']> | undefined;
  let completed = false;
  let commitSent = false;
  const cancel = () => {
    if (!completed && sameScope(owner, dependencies.scope()))
      return dependencies.command('import.cancel', { transferId }).catch(() => {});
    return Promise.resolve();
  };
  let cancelling: Promise<unknown> | undefined;
  const abort = () => {
    cancelling ??= cancel();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    check();
    await dependencies.command('import.begin', { transferId, name: asset.name, size, background });
    check();
    handle = file.open();
    let sent = 0;
    let sequence = 0;
    while (sent < size) {
      check();
      const bytes = await handle.readBytes(Math.min(IMPORT_CHUNK_BYTES, size - sent));
      check();
      if (!bytes.length || bytes.length > Math.min(IMPORT_CHUNK_BYTES, size - sent))
        throw new Error('The selected image changed or ended before its declared size.');
      await dependencies.command('import.chunk', {
        transferId,
        sequence: sequence++,
        data: bytesToBase64(bytes)
      });
      check();
      sent += bytes.length;
    }
    // Re-check the picker-owned cached copy before committing. No source is changed.
    if (file.size !== size) throw new Error('The selected image changed during upload.');
    check();
    commitSent = true;
    await dependencies.command('import.commit', { transferId });
    completed = true;
    check();
    return true;
  } catch (cause) {
    if (commitSent && signal.aborted)
      throw new Error(
        'The image save was interrupted. Refresh saved backgrounds to reconcile its saved state before trying again.'
      );
    throw cause;
  } finally {
    signal.removeEventListener('abort', abort);
    try {
      handle?.close();
    } finally {
      // Never replay a commit or cancel a different transfer/current account after a
      // lost reply. A matching cancel only releases still-buffered bytes.
      if (!completed) await (cancelling ?? cancel());
    }
  }
}
