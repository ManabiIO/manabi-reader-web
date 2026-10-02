/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export type Subscribable<T> = {
  subscribe(callback: (value: T) => void): (() => void) | { unsubscribe(): void };
};
export type StoreValue<S> = S extends Subscribable<infer T> ? T : never;

/** A per-mounted reader lifetime. Owns subscriptions, async cancellation and
 * explicit derived effects; React owns rendering and subscribes to revisions. */
export class ReaderController {
  private revision = 0;
  private listeners = new Set<() => void>();
  private cleanups: Array<() => void> = [];
  private mounts: Array<() => unknown> = [];
  private effects: Array<{ read: () => unknown[]; run: () => void; previous?: unknown[] }> = [];
  private queued = false;
  private started = false;
  disposed = false;
  onChange?: () => void;
  getSnapshot = () => this.revision;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  changed = <T>(value: T): T => {
    this.invalidate();
    return value;
  };
  change = <T>(operation: () => T): T => {
    const result = operation();
    this.invalidate();
    return result;
  };
  invalidate = () => {
    if (this.disposed || this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (this.disposed || !this.started) return;
      this.flush();
      this.revision++;
      this.onChange?.();
      for (const listener of this.listeners) listener();
    });
  };
  read = <T>(store: Subscribable<T>): T => {
    let value!: T;
    const subscription = store.subscribe((next) => {
      value = next;
    });
    typeof subscription === 'function' ? subscription() : subscription.unsubscribe();
    return value;
  };
  observe = <T>(store: Subscribable<T>, callback: (value: T) => void) => {
    const subscription = store.subscribe((value) => {
      if (this.disposed) return;
      callback(value);
      this.invalidate();
    });
    this.onDestroy(() =>
      typeof subscription === 'function' ? subscription() : subscription.unsubscribe()
    );
  };
  observeSource = <T>(source: () => Subscribable<T> | undefined, callback: (value: T) => void) => {
    let stop: (() => void) | undefined;
    this.effect(
      () => [source()],
      () => {
        stop?.();
        stop = undefined;
        const store = source();
        if (!store) return;
        const subscription = store.subscribe((value) => {
          if (!this.disposed) {
            callback(value);
            this.invalidate();
          }
        });
        stop = () =>
          typeof subscription === 'function' ? subscription() : subscription.unsubscribe();
      }
    );
    this.onDestroy(() => stop?.());
  };
  effect = (read: () => unknown[], run: () => void) => {
    this.effects.push({ read, run });
  };
  onMount = (callback: () => unknown) => {
    this.mounts.push(callback);
  };
  onDestroy = (callback: () => void) => {
    this.cleanups.push(callback);
  };
  private flush() {
    // Effects may publish state consumed by a later effect. Each effect runs
    // only when its explicit inputs changed, including asynchronous store data.
    for (let pass = 0; pass < 30; pass++) {
      let changed = false;
      for (const effect of this.effects) {
        const next = effect.read();
        if (
          effect.previous &&
          next.length === effect.previous.length &&
          next.every((value, index) => Object.is(value, effect.previous![index]))
        )
          continue;
        effect.previous = next;
        effect.run();
        changed = true;
      }
      if (!changed) return;
    }
    throw new Error('Reader state effects did not converge');
  }
  prepare() {
    if (!this.disposed) this.flush();
  }
  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    this.flush();
    for (const mount of this.mounts.splice(0)) {
      const result = mount();
      if (typeof result === 'function') this.onDestroy(result as () => void);
      else if (result instanceof Promise)
        void result.catch((error) => {
          if (!this.disposed) console.error('Reader lifetime failed', error);
        });
    }
    this.invalidate();
  }
  destroy = () => {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
    this.effects.length = 0;
    this.listeners.clear();
  };
}

/** A DOM commit boundary, including iframe and typography layout. */
export const readerTick = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function writeStore<T>(store: { next?(value: T): void; set?(value: T): void }, value: T): T {
  if (store.next) store.next(value);
  else if (store.set) store.set(value);
  else throw new Error('This reader value is read-only.');
  return value;
}

export interface ControlledReader {
  controller: ReaderController;
  updateProps(props: Record<string, unknown>): void;
}

/** Construct only inside an effect: abandoned concurrent React renders and
 * Strict Mode probes never leak listeners, database leases or object URLs. */
export function useReaderController<T extends ControlledReader>(
  factory: () => T,
  props: object,
  identity: unknown = null
): T | undefined {
  const factoryRef = useRef(factory);
  factoryRef.current = factory;
  const incoming = useRef(props);
  incoming.current = props;
  const received = useRef(new WeakMap<ControlledReader, Record<string, unknown>>());
  const [instance, setInstance] = useState<T>();
  useEffect(() => {
    const value = factoryRef.current();
    received.current.set(value, { ...incoming.current });
    value.controller.prepare();
    setInstance(value);
    return () => value.controller.destroy();
  }, [identity]);
  useEffect(() => {
    if (!instance || instance.controller.disposed) return;
    const next = props as Record<string, unknown>;
    const previous = received.current.get(instance) ?? {};
    const changes = changedReaderProps(previous, next);
    received.current.set(instance, { ...next });
    if (Object.keys(changes).length) instance.updateProps(changes);
    instance.controller.start();
  });
  useSyncExternalStore(
    instance?.controller.subscribe ?? emptySubscribe,
    instance?.controller.getSnapshot ?? zero,
    zero
  );
  return instance?.controller.disposed ? undefined : instance;
}
const emptySubscribe = () => () => {};
const zero = () => 0;

/** Only new parent input owns a prop update. Reapplying an unchanged parent
 * snapshot would overwrite local navigation before two-way bindings publish. */
export function changedReaderProps(
  previous: Record<string, unknown>,
  next: Record<string, unknown>
) {
  const changes: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (!Object.is(previous[key], next[key])) changes[key] = next[key];
  }
  return changes;
}
