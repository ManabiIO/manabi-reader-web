/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { account, currentUser } from './client';
import { MediaStore } from '$lib/media/store';

const store = new MediaStore();
const profileKind = 'media-offline-profile';

/** Device-local display identity only. This is never authentication authority. */
export async function offlineMediaProfile(): Promise<string | null> {
  const profile = await store.local<{ userId: string }>('guest', profileKind, 'last');
  return profile && typeof profile.userId === 'string' && profile.userId.length <= 128
    ? profile.userId
    : null;
}

/** Mount with ManabiRuntime, not only on /videos, so signing out elsewhere clears it. */
export function startMediaProfileWatcher(): () => void {
  let writes = Promise.resolve();
  return account.subscribe((state) => {
    if (state.status !== 'available') return;
    const userId = currentUser()?.id ?? null;
    // Serialize account transitions: an older pending write cannot restore a
    // signed-out profile after a newer clear. No cookies or tokens are persisted.
    writes = writes
      .then(async () => {
        if (userId === null) await store.deleteLocal('guest', profileKind, 'last');
        else await store.putLocal('guest', profileKind, 'last', { userId });
      })
      .catch(() => {
        /* Storage errors still appear in the video workspace. */
      });
  });
}
