/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface PagerControls {
  previous: { readonly current: unknown };
  next: { readonly current: unknown };
  choose: { readonly current: unknown };
}
/** Native focus remains owned by the native control system. */
export function usePagerKeyboardFocus(_page: number, _busy: boolean, _controls: PagerControls) {
  return (_source: unknown, _preferred?: keyof PagerControls) => {};
}
