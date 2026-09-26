/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Detach a caller promptly while observing a non-cooperating task's late result.
 * This does not pretend to cancel that task; resource owners still receive signal.
 */
export function abortable<T>(signal: AbortSignal, task: () => T | PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled)
        return;
      settled = true;
      signal.removeEventListener('abort', abort);
      action();
    };
    const abort = () => finish(() => reject(signal.reason));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    try {
      Promise.resolve(task()).then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    }
    catch (error) {
      finish(() => reject(error));
    }
  });
}
/** Join operation and workspace lifetimes without leaving parent listeners behind. */
export async function inAbortScope<T>(parents: readonly AbortSignal[], task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  try {
    for (const parent of new Set(parents)) {
      const abort = () => controller.abort(parent.reason);
      if (parent.aborted) {
        abort();
        break;
      }
      listeners.set(parent, abort);
      parent.addEventListener('abort', abort, { once: true });
    }
    return await abortable(controller.signal, () => task(controller.signal));
  }
  finally {
    for (const [parent, abort] of listeners)
      parent.removeEventListener('abort', abort);
  }
}
