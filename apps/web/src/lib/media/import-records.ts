/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  isContentKey,
  validateInfo,
  type ContentKey,
  type Scope,
  type VideoInfo
} from './contracts.js';
import { validateCloudLocator, type CloudLocator } from './cloud-locator.js';
import { edit, validatePayload } from './replica.js';
import type { MediaStore } from './store.js';

export interface SourceAlias {
  key: ContentKey;
  name: string;
  handle?: FileSystemFileHandle;
  cloud?: CloudLocator;
}

/** A File selection is transient. Do not erase an existing reconnectable source
 * merely because the same bytes were selected without a retained handle.
 * A newly supplied durable locator deliberately replaces the previous locator.
 */
export async function rememberSourceAlias(
  store: MediaStore,
  scope: Scope,
  input: SourceAlias,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  const snapshot: SourceAlias = {
    key: input.key,
    name: input.name,
    ...(input.handle ? { handle: input.handle } : {}),
    ...(input.cloud ? { cloud: validateCloudLocator(input.cloud) } : {})
  };
  if (
    !isContentKey(snapshot.key) ||
    typeof snapshot.name !== 'string' ||
    !snapshot.name ||
    snapshot.name.length > 1024
  )
    throw new Error('Invalid video source alias');
  await store.updateLocal<SourceAlias>(scope, 'aliases', snapshot.key, (old) => {
    signal.throwIfAborted();
    if (old && old.key !== snapshot.key) throw new Error('Saved video source identity changed');
    if (!snapshot.handle && !snapshot.cloud && (old?.handle || old?.cloud))
      return {
        ...snapshot,
        ...(old.handle ? { handle: old.handle } : { cloud: validateCloudLocator(old.cloud) })
      };
    return snapshot;
  });
}

/** Initial metadata is a create-only operation, not an edit based on a stale
 * earlier read. Preserve existing local edits, synced state and tombstones.
 */
export async function ensureVideoInfo(
  store: MediaStore,
  scope: Scope,
  key: ContentKey,
  input: VideoInfo,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  const snapshot = { ...validateInfo(input) };
  validatePayload('video_info', key, key, snapshot);
  await store.change(scope, 'video_info', key, (old) => {
    signal.throwIfAborted();
    if (old) {
      if (old.mediaKey !== key) throw new Error('Saved video metadata identity changed');
      validatePayload('video_info', old.id, old.mediaKey, old.payload);
      return old;
    }
    return edit(undefined, scope, 'video_info', key, key, snapshot, crypto.randomUUID());
  });
}
