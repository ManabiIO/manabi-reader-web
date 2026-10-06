/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useMemo, useSyncExternalStore } from 'react';
type Subscription = (() => void) | { unsubscribe(): void };
export interface Subscribable<T> {
  subscribe(run: (value: T) => void): Subscription;
}
/** Cache the snapshot, including observables that emit new object identities on subscribe. */
export function useStore<T>(store: Subscribable<T>, initial?: T): T {
  const adapter = useMemo(() => {
    let value = initial as T;
    let version = 0;
    const initialStop = store.subscribe((next) => {
      value = next;
    });
    if (typeof initialStop === 'function') initialStop();
    else initialStop.unsubscribe();
    return {
      getSnapshot: () => version,
      getValue: () => value,
      subscribe: (notify: () => void) => {
        const stop = store.subscribe((next) => {
          if (!Object.is(value, next) || typeof next === 'object') {
            value = next;
            version++;
            notify();
          }
        });
        return () => {
          if (typeof stop === 'function') stop();
          else stop.unsubscribe();
        };
      }
    };
  }, [store]);
  useSyncExternalStore(adapter.subscribe, adapter.getSnapshot, adapter.getSnapshot);
  return adapter.getValue();
}
