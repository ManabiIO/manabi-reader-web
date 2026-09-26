/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Readers hold shared ownership while mounted. A receive/apply must not run
 * behind another tab's live autosave state. Locks are origin-local, not a
 * replacement for server ETags between different devices. */
const name = 'manabi-webdav-reader-lifetime-v1';
export function acquireReaderLease(signal: AbortSignal): Promise<void> {
  if (!navigator.locks) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    void navigator.locks
      .request(name, { mode: 'shared', signal }, async () => {
        signal.throwIfAborted();
        resolve();
        await new Promise<void>((release) => {
          if (signal.aborted) release();
          else signal.addEventListener('abort', () => release(), { once: true });
        });
      })
      .catch(reject);
  });
}
export async function withWebDavApplyLease<T>(work: () => Promise<T>): Promise<T> {
  if (!navigator.locks)
    throw new Error(
      'Safe WebDAV reading-data sync requires Web Locks in this browser. Book import and local reading still work.'
    );
  return navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true }, (lock) => {
    if (!lock)
      throw new Error(
        'A book is open in another tab. Return all reader tabs to the Library before syncing reading data.'
      );
    return work();
  });
}
