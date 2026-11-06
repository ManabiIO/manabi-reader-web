/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { isActionHandled, StackRouter, type StackRouterOptions } from 'expo-router';

/**
 * A browser entry and a mounted screen have different identities. Expo must
 * push a distinct stack entry (and its own history ID) for every Library or
 * Snippets destination, while their contiguous visits keep the live controller.
 *
 * Only the focused Slot is mounted. Transfer its key to the next same-screen
 * entry, giving the outgoing, now-unmounted entry the unused replacement key.
 * Earlier immutable states retain their original keys and params, so Expo's
 * browser Back/Forward snapshots restore that same live screen. SDK 58 action
 * metadata follows the remapped route keys; history operations,
 * route parameters and native Stack behavior remain owned by Expo.
 */
export function WebSlotRouter(options: StackRouterOptions): ReturnType<typeof StackRouter> {
  const router = StackRouter(options);
  return {
    ...router,
    getStateForAction(...args: Parameters<typeof router.getStateForAction>) {
      const [state] = args;
      const result = router.getStateForAction(...args);
      if (!isActionHandled(result)) return result;
      const next = result.state;
      // Only complete accepted states can transfer a mounted screen identity.
      if (next === state || next.stale !== false) return result;
      const previous = state.routes[state.index];
      const focused = next.routes[next.index];
      if (
        !previous ||
        !focused ||
        !['manage', 'snippets'].includes(previous.name) ||
        focused.name !== previous.name ||
        focused.key === previous.key
      )
        return result;
      const remapKey = (key: string | undefined) =>
        key === focused.key ? previous.key : key === previous.key ? focused.key : key;
      return {
        ...result,
        state: {
          ...next,
          routes: next.routes.map((route) => ({ ...route, key: remapKey(route.key)! }))
        },
        affectedRouteKey: remapKey(result.affectedRouteKey),
        // These root Slot entries intentionally reuse a mounted route key.
        // SDK 58 otherwise finds the nearest matching key for POP_TO_TOP, which
        // can stop at an intermediate Library visit. Keep Expo's exact pop count.
        browserHistory:
          result.browserHistory?.type === 'pop'
            ? { type: 'pop', count: result.browserHistory.count }
            : result.browserHistory
      };
    }
  };
}
