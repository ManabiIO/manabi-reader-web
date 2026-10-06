/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Framework-independent synchronous stores. React subscribes with useSyncExternalStore.
 */
export type Unsubscriber = () => void;
export type Subscriber<T> = (value: T) => void;
export type Invalidator<T> = (value?: T) => void;
export interface Readable<T> {
  subscribe(run: Subscriber<T>, invalidate?: Invalidator<T>): Unsubscriber;
}
export interface Writable<T> extends Readable<T> {
  set(value: T): void;
  update(fn: (value: T) => T): void;
}
export type StartStopNotifier<T> = (
  set: (value: T) => void,
  update: (fn: (value: T) => T) => void
) => void | Unsubscriber;
const queue: Array<() => void> = [];
let flushing = false;
const changed = (a: unknown, b: unknown) =>
  a !== a ? b === b : a !== b || (a !== null && (typeof a === 'object' || typeof a === 'function'));
export function writable<T>(initial: T, start: StartStopNotifier<T> = () => {}): Writable<T> {
  let value = initial;
  let stop: Unsubscriber | undefined;
  const listeners = new Set<[Subscriber<T>, Invalidator<T>]>();
  const set = (next: T) => {
    if (!changed(value, next)) return;
    value = next;
    if (!stop) return;
    for (const [run, invalidate] of listeners) {
      invalidate();
      queue.push(() => run(next));
    }
    if (flushing) return;
    flushing = true;
    try {
      for (let i = 0; i < queue.length; i++) queue[i]();
    } finally {
      queue.length = 0;
      flushing = false;
    }
  };
  const update = (fn: (value: T) => T) => set(fn(value));
  return {
    set,
    update,
    subscribe(run, invalidate = () => {}) {
      const pair: [Subscriber<T>, Invalidator<T>] = [run, invalidate];
      listeners.add(pair);
      if (listeners.size === 1) stop = start(set, update) || (() => {});
      run(value);
      return () => {
        listeners.delete(pair);
        if (!listeners.size) {
          stop?.();
          stop = undefined;
        }
      };
    }
  };
}
export function readable<T>(value: T, start?: StartStopNotifier<T>): Readable<T> {
  return { subscribe: writable(value, start).subscribe };
}
export function get<T>(
  store: Readable<T> | { subscribe(run: Subscriber<T>): { unsubscribe(): void } }
): T {
  let value!: T;
  const stop = store.subscribe((next) => {
    value = next;
  });
  if (typeof stop === 'function') stop();
  else stop.unsubscribe();
  return value;
}
type Stores = Readable<any> | readonly Readable<any>[];
type Values<S> =
  S extends Readable<infer T> ? T : { [K in keyof S]: S[K] extends Readable<infer T> ? T : never };
export function derived<const S extends Stores, T>(
  stores: S,
  fn: (values: Values<S>) => T,
  initial?: T
): Readable<T>;
export function derived<const S extends Stores, T>(
  stores: S,
  fn: (
    values: Values<S>,
    set: (value: T) => void,
    update: (fn: (value: T) => T) => void
  ) => void | Unsubscriber,
  initial?: T
): Readable<T>;
export function derived<const S extends Stores, T>(
  stores: S,
  fn: (
    values: Values<S>,
    set: (value: T) => void,
    update: (fn: (value: T) => T) => void
  ) => T | void | Unsubscriber,
  initial?: T
): Readable<T> {
  const single = !Array.isArray(stores);
  const list = (single ? [stores] : stores) as Readable<any>[];
  return readable(initial as T, (set, update) => {
    let ready = false;
    let cleanup: void | Unsubscriber;
    const values: unknown[] = [];
    const pending = new Set<number>();
    const sync = () => {
      if (!ready || pending.size) return;
      cleanup?.();
      const result = fn((single ? values[0] : values) as Values<S>, set, update);
      if (fn.length < 2) set(result as T);
      else cleanup = typeof result === 'function' ? (result as Unsubscriber) : undefined;
    };
    const stops = list.map((store, index) =>
      store.subscribe(
        (value) => {
          values[index] = value;
          pending.delete(index);
          sync();
        },
        () => pending.add(index)
      )
    );
    ready = true;
    sync();
    return () => {
      stops.forEach((stop) => stop());
      cleanup?.();
      ready = false;
    };
  });
}
export function readonly<T>(store: Readable<T>): Readable<T> {
  return { subscribe: store.subscribe.bind(store) };
}
