/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved.
 * Small framework-independent controller subscription boundary. Mutable state is
 * immediately visible to async transaction guards; React receives batched notices.
 */
import { get } from '$lib/state/store';
import type { Subscribable } from '$runtime/use-store';
type Stop = () => void;
const snapshots = new WeakMap<object, unknown>();
export function readStore<T>(store: Subscribable<T>): T {
    return snapshots.has(store) ? snapshots.get(store) as T : get(store);
}
export function writeStore<T>(store: {
    next?(value: T): void;
    set?(value: T): void;
}, value: T) {
    if (store.next)
        store.next(value);
    else
        store.set?.(value);
}
export const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
interface State {
    revision: number;
    active: boolean;
    queued: boolean;
    reconciling: boolean;
    listeners: Set<Stop>;
    stops: Stop[];
    cache: Map<PropertyKey, unknown>;
    methods: Map<PropertyKey, Function>;
}
const states = new WeakMap<object, State>();
export class ObservableController {
    constructor() {
        const state: State = { revision: 0, active: false, queued: false, reconciling: false, listeners: new Set(), stops: [], cache: new Map(), methods: new Map() };
        let proxy: this;
        proxy = new Proxy(this, {
            get(target, key, receiver) {
                let prototype: object | null = target;
                let descriptor: PropertyDescriptor | undefined;
                while (prototype && !descriptor) {
                    descriptor = Object.getOwnPropertyDescriptor(prototype, key);
                    prototype = Object.getPrototypeOf(prototype);
                }
                if (descriptor?.get) {
                    if (!state.cache.has(key))
                        state.cache.set(key, Reflect.get(target, key, receiver));
                    return state.cache.get(key);
                }
                const value = Reflect.get(target, key, receiver);
                // Prototype methods remain bound when used as React callbacks or observers.
                if (typeof value === 'function' && !Object.prototype.hasOwnProperty.call(target, key)) {
                    if (!state.methods.has(key))
                        state.methods.set(key, value.bind(proxy));
                    return state.methods.get(key);
                }
                return value;
            },
            set(target, key, value, receiver) {
                if (Object.is(Reflect.get(target, key, receiver), value))
                    return true;
                const previous = Reflect.get(target, key, receiver);
                const result = Reflect.set(target, key, value, receiver);
                if (typeof Element !== "undefined" && (value instanceof Element || previous instanceof Element))
                    return result;
                if (result) {
                    state.cache.clear();
                    state.revision++;
                    proxy.invalidate();
                }
                return result;
            }
        });
        states.set(proxy, state);
        states.set(this, state);
        return proxy;
    }
    subscribe(listener: Stop) { const state = states.get(this)!; state.listeners.add(listener); return () => { state.listeners.delete(listener); }; }
    getSnapshot() { return states.get(this)!.revision; }
    invalidate() {
        const state = states.get(this)!;
        state.cache.clear();
        if (!state.active || state.queued || state.reconciling)
            return;
        state.queued = true;
        queueMicrotask(() => {
            state.queued = false;
            if (!state.active)
                return;
            this.flush();
        });
    }
    flush() {
        const state = states.get(this)!;
        if (state.reconciling)
            return;
        state.cache.clear();
        state.reconciling = true;
        try {
            this.reconcile();
        }
        finally {
            state.reconciling = false;
        }
        state.revision++;
        for (const listener of state.listeners)
            listener();
    }
    watch(...stores: Subscribable<unknown>[]) {
        const state = states.get(this)!;
        for (const store of stores) {
            const subscription = store.subscribe(value => { snapshots.set(store, value); state.revision++; this.invalidate(); });
            state.stops.push(typeof subscription === 'function' ? subscription : () => subscription.unsubscribe());
        }
    }
    retain(stop: Stop) { states.get(this)!.stops.push(stop); }
    activate() {
        const state = states.get(this)!;
        if (state.active)
            return () => { };
        state.active = true;
        const stop = this.start();
        if (stop)
            state.stops.push(stop);
        this.flush();
        return () => {
            state.active = false;
            for (const cleanup of state.stops.splice(0).reverse())
                cleanup();
            state.cache.clear();
        };
    }
    reconcile(): void { }
    start(): void | Stop { }
}

