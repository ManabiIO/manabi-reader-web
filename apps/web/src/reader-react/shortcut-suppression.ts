/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

type ShortcutStore = {
  getValue(): boolean;
  next(value: boolean): void;
  subscribe(callback: (value: boolean) => void): { unsubscribe(): void };
};
interface Suppression {
  previous: boolean;
  users: Set<symbol>;
  revision: number;
  ownRevision: number;
  subscription?: { unsubscribe(): void };
}
const suppressions = new WeakMap<ShortcutStore, Suppression>();

/** Share our temporary suppression, but never undo a newer dialog's direct
 * publication, even when it writes the same boolean during an async upload. */
export function suppressReaderShortcuts(store: ShortcutStore) {
  const token = Symbol('reader-shortcuts');
  let state = suppressions.get(store);
  if (!state) {
    state = {
      previous: store.getValue(),
      users: new Set([token]),
      revision: 0,
      ownRevision: 0
    };
    const current = state;
    suppressions.set(store, current);
    current.subscription = store.subscribe(() => current.revision++);
    current.ownRevision = current.revision + (current.previous ? 0 : 1);
    if (!current.previous) store.next(true);
  } else state.users.add(token);
  const current = state;
  return () => {
    if (!current.users.delete(token) || current.users.size) return;
    current.subscription?.unsubscribe();
    suppressions.delete(store);
    if (current.revision === current.ownRevision && store.getValue() === true)
      store.next(current.previous);
  };
}
