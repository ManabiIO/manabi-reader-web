/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { StackRouter, type StackRouterOptions } from 'expo-router';

/**
 * A browser entry and a mounted screen have different identities. Expo must
 * push a distinct stack entry (and its own history ID) for every Library or
 * Snippets destination, while their contiguous visits keep the live controller.
 *
 * Only the focused Slot is mounted. Transfer its key to the next same-screen
 * entry, giving the outgoing, now-unmounted entry the unused replacement key.
 * Earlier immutable states retain their original keys and params, so Expo's
 * browser Back/Forward snapshots restore that same live screen. No history IDs,
 * route parameters or native Stack behavior are synthesized here.
 */
export function WebSlotRouter(options: StackRouterOptions): ReturnType<typeof StackRouter> {
  const router = StackRouter(options);
  return {
    ...router,
    getStateForAction(...args: Parameters<typeof router.getStateForAction>) {
      const [state] = args;
      const next = router.getStateForAction(...args);
      // A partial reset still needs Expo's normal rehydration before it has
      // stable route keys; never assign mounted identities to partial state.
      if (!next || next === state || next.stale !== false) return next;
      const previous = state.routes[state.index];
      const focused = next.routes[next.index];
      if (
        !['manage', 'snippets'].includes(previous.name) ||
        focused.name !== previous.name ||
        focused.key === previous.key
      )
        return next;
      return {
        ...next,
        routes: next.routes.map((route, index) =>
          index === next.index
            ? { ...route, key: previous.key }
            : route.key === previous.key
              ? { ...route, key: focused.key }
              : route
        )
      };
    }
  };
}
