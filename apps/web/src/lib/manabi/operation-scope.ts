/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { accountScope, localProfileUser, localUser, IntegrationError } from './client';

/** Capture at the public entry, before admission or asynchronous preparation.
 * Local operations work offline, but a profile change permanently revokes them.
 * Cloud operations additionally retain the authenticated session generation.
 */
export function captureLibraryOperation(owner: string | null = null) {
  const profileId = localProfileUser()?.id ?? null;
  const authenticated = owner === null ? undefined : accountScope();
  if (authenticated && authenticated.userId !== owner)
    throw new IntegrationError('account_changed');
  const controller = new AbortController();
  const stop = localUser.subscribe((user) => {
    if ((user?.id ?? null) !== profileId) controller.abort();
  });
  const assertCurrent = () => {
    if (controller.signal.aborted || (localProfileUser()?.id ?? null) !== profileId)
      throw new IntegrationError('account_changed');
    if (authenticated) {
      const current = accountScope();
      if (
        current.userId !== authenticated.userId ||
        current.generation !== authenticated.generation
      )
        throw new IntegrationError('account_changed');
    }
  };
  return { profileId, assertCurrent, signal: controller.signal, stop };
}

/** Source reads also serve metadata-only actions, not just guarded imports. */
export async function withLibraryOperation<T>(owner: string | null, work: () => Promise<T>) {
  const scope = captureLibraryOperation(owner);
  try {
    scope.assertCurrent();
    const result = await work();
    scope.assertCurrent();
    return result;
  } finally {
    scope.stop();
  }
}
