/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { account, accountGeneration } from './client';
import { isOnline$ } from '../data/store';
import { get, writable, readonly } from '../state/store';
import { listDriveReaderConnections } from './reader-bridge-local';
import { observeSavedDriveReaderConnection } from './reader-bridge-saved';
import { receiveSavedDriveReaderChanges } from './reader-bridge-automatic-receive';
import { readerBridgeRecoveryChanges } from './reader-bridge-recovery';
import {
  createReaderBridgeScheduler,
  type ReaderBridgeCheckStatus
} from './reader-bridge-scheduler';

export interface ReaderBridgeAutomaticStatus {
  owner: string | null;
  available: boolean;
  records: Readonly<Record<string, ReaderBridgeCheckStatus>>;
}
const status = writable<ReaderBridgeAutomaticStatus>({
  owner: null,
  available: false,
  records: {}
});
export const readerBridgeAutomaticStatus = readonly(status);
const interval = 60_000;
const lockName = 'manabi-reader-bridge-automatic-v1';

/** A queued origin-local Web Lock gives exactly one visible online tab ownership.
 * Every new leader waits a minute before its first pass, including after reload.
 * The in-memory account scope keeps cooldowns across foreground/offline changes;
 * no service-worker execution or observation state survives a restart. */
export function startReaderBridgeAutomaticChecks() {
  let stopped = false;
  let current:
    | {
        key: string;
        scheduler: ReturnType<typeof createReaderBridgeScheduler>;
        detach(): void;
      }
    | undefined;
  let leader: { key: string; abort: AbortController } | undefined;
  const release = () => {
    const previous = leader;
    leader = undefined;
    previous?.abort.abort();
    current?.scheduler.cancel();
  };
  const reset = () => {
    release();
    const previous = current;
    current = undefined;
    previous?.detach();
    previous?.scheduler.stop();
  };
  const reconcile = () => {
    if (stopped) return;
    const session = get(account);
    const owner = session.session?.user?.id ?? null;
    const key = owner ? JSON.stringify([owner, accountGeneration()]) : '';
    const eligible =
      session.status === 'available' &&
      owner !== null &&
      get(isOnline$) === true &&
      document.visibilityState === 'visible' &&
      !!navigator.locks;
    if (current?.key !== key) reset();
    if (!eligible || !owner) {
      release();
      status.set({ owner, available: false, records: {} });
      return;
    }
    if (leader?.key === key) return;
    if (!current) {
      let receiving = false;
      const scheduler = createReaderBridgeScheduler({
        now: () => performance.now(),
        list: (signal) => listDriveReaderConnections(owner, signal),
        observe: (record, signal) =>
          observeSavedDriveReaderConnection(owner, record.id, record.revision, signal),
        receive: async (record, signal) => {
          receiving = true;
          try {
            return await receiveSavedDriveReaderChanges(owner, record.id, record.revision, signal);
          } finally {
            receiving = false;
          }
        },
        publish: (records) => {
          if (current?.key === key && leader?.key === key && !leader.abort.signal.aborted)
            status.set({ owner, available: true, records });
        }
      });
      const changed = () => {
        // Receive announces its committed journal before returning the receipt.
        // Concurrent consent edits are also checked inside the receive transaction.
        if (!receiving) scheduler.invalidate();
      };
      readerBridgeRecoveryChanges.addEventListener('change', changed);
      current = {
        key,
        scheduler,
        detach: () => readerBridgeRecoveryChanges.removeEventListener('change', changed)
      };
    }
    const scheduler = current.scheduler;
    const abort = new AbortController();
    const ownership = { key, abort };
    leader = ownership;
    status.set({ owner, available: true, records: {} });
    const wait = () =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          abort.signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, interval);
        abort.signal.addEventListener('abort', done, { once: true });
        if (abort.signal.aborted) done();
      });
    void navigator.locks
      .request(lockName, { signal: abort.signal }, async () => {
        while (!abort.signal.aborted) {
          await wait();
          if (abort.signal.aborted) break;
          await scheduler.tick();
        }
      })
      .catch(() => {
        if (!abort.signal.aborted && leader === ownership) {
          release();
          status.set({ owner, available: false, records: {} });
        }
      });
  };
  const stopAccount = account.subscribe(reconcile);
  const online = isOnline$.subscribe(reconcile);
  document.addEventListener('visibilitychange', reconcile);
  return () => {
    stopped = true;
    stopAccount();
    online.unsubscribe();
    document.removeEventListener('visibilitychange', reconcile);
    reset();
    status.set({ owner: null, available: false, records: {} });
  };
}
