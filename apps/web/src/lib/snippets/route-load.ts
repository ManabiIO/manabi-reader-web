/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface RouteLoad {
  current(): boolean;
  guard(): void;
  replace(key: string): void;
}
/**
 * Navigation ownership is deliberately not reactive UI state. A recovered draft
 * replaces its URL without starting another load; leaving and returning to the
 * same URL still revokes the earlier asynchronous request (including ABA).
 */
export function createRouteLoads() {
  let key: string | undefined;
  let active: object | undefined;
  return {
    begin(next: string): RouteLoad | undefined {
      if (key === next) return;
      key = next;
      const token = (active = {});
      const current = () => active === token;
      const guard = () => {
        if (!current()) throw new DOMException('Snippet navigation changed.', 'AbortError');
      };
      return {
        current,
        guard,
        replace(nextKey) {
          guard();
          key = nextKey;
        }
      };
    },
    reset() {
      key = undefined;
      active = undefined;
    }
  };
}
