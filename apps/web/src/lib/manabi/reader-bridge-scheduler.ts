/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReaderBridgeConnectionRecord } from './reader-bridge-connection-model';

export const READER_BRIDGE_SCHEDULE = Object.freeze({
  interval: 5 * 60_000,
  outcomeLifetime: 15 * 60_000,
  retryMaximum: 30 * 60_000,
  perPass: 5,
  receivesPerPass: 1
});
export type ReaderBridgeCheckState =
  | 'checking'
  | 'unchanged'
  | 'changed'
  | 'received'
  | 'review'
  | 'retry'
  | 'paused';
export interface ReaderBridgeCheckStatus {
  revision: string;
  state: ReaderBridgeCheckState;
  observedAt?: string;
}
interface Services {
  now(): number;
  list(signal: AbortSignal): Promise<ReaderBridgeConnectionRecord[]>;
  observe(
    record: ReaderBridgeConnectionRecord,
    signal: AbortSignal
  ): Promise<{
    state: 'unchanged' | 'changed';
    observedAt: string;
    observedRevision: string;
  }>;
  receive(
    record: ReaderBridgeConnectionRecord,
    signal: AbortSignal
  ): Promise<{
    state: 'received' | 'unchanged' | 'review';
    observedAt: string;
  }>;
  publish(value: Readonly<Record<string, ReaderBridgeCheckStatus>>): void;
}
interface Memory {
  revision: string;
  next: number;
  failures: number;
  outcome?: {
    revision: string;
    state: 'received' | 'unchanged' | 'review';
    expires: number;
  };
  status?: ReaderBridgeCheckStatus;
}

/** One foreground leader calls this controller. Receipts and timers are disposable;
 * authoritative consent, ownership and receive preconditions live in IndexedDB.
 * The scheduler cannot authorize remote writes or resolve a conflict. */
export function createReaderBridgeScheduler(services: Services) {
  const memory = new Map<string, Memory>();
  let active = true;
  let running = false;
  let retryAt = 0;
  let failures = 0;
  let cursor = 0;
  let pending: AbortController | undefined;
  const publish = () => {
    if (active)
      services.publish(
        Object.fromEntries(
          [...memory].flatMap(([id, value]) => (value.status ? [[id, value.status]] : []))
        )
      );
  };
  const retry = (count: number, error: unknown) => {
    const requested =
      error && typeof error === 'object' && 'retryAfter' in error
        ? Number(error.retryAfter) * 1000
        : 0;
    return Math.max(
      Number.isFinite(requested) ? Math.min(3_600_000, Math.max(0, requested)) : 0,
      Math.min(
        READER_BRIDGE_SCHEDULE.retryMaximum,
        READER_BRIDGE_SCHEDULE.interval * 2 ** Math.min(count - 1, 8)
      )
    );
  };
  const cancel = () => {
    pending?.abort();
    // A suspended pass is no longer checking. Keep its existing cooldown, but
    // never redisplay an orphaned spinner when the foreground leader resumes.
    for (const entry of memory.values())
      if (entry.status?.state === 'checking') entry.status = undefined;
  };
  return {
    async tick() {
      if (!active || running || services.now() < retryAt) return;
      running = true;
      const operation = new AbortController();
      pending = operation;
      const check = () => operation.signal.throwIfAborted();
      try {
        const listed = await services.list(operation.signal);
        check();
        const rows = listed.filter((row) => row.state === 'linked' && row.automaticChecks === true);
        const live = new Set(rows.map((row) => row.id));
        for (const id of memory.keys()) if (!live.has(id)) memory.delete(id);
        for (const row of rows) {
          if (memory.get(row.id)?.revision !== row.revision)
            memory.set(row.id, { revision: row.revision, next: 0, failures: 0 });
        }
        publish();
        failures = 0;
        let checks = 0;
        let receives = 0;
        let afterReceive: number | undefined;
        const ordered = [
          ...rows.slice(cursor % (rows.length || 1)),
          ...rows.slice(0, cursor % (rows.length || 1))
        ];
        for (const row of ordered) {
          check();
          const entry = memory.get(row.id)!;
          if (services.now() < entry.next) continue;
          if (checks++ >= READER_BRIDGE_SCHEDULE.perPass) break;
          cursor = rows.indexOf(row) + 1;
          entry.next = services.now() + READER_BRIDGE_SCHEDULE.interval;
          entry.status = { revision: row.revision, state: 'checking' };
          publish();
          try {
            const result = await services.observe(row, operation.signal);
            check();
            let status: ReaderBridgeCheckStatus = {
              revision: row.revision,
              state: result.state,
              observedAt: result.observedAt
            };
            if (
              row.automaticReceive === true &&
              (entry.outcome?.revision !== result.observedRevision ||
                services.now() >= entry.outcome.expires)
            ) {
              if (receives < READER_BRIDGE_SCHEDULE.receivesPerPass) {
                receives++;
                afterReceive = rows.indexOf(row) + 1;
                const received = await services.receive(row, operation.signal);
                check();
                status = { revision: row.revision, ...received };
                // A bounded cache saves full-book downloads. Expiry also catches
                // changes made in another tab without a local recovery event.
                // Keep outcomes separate from transient network/checking status.
                entry.outcome = {
                  revision: result.observedRevision,
                  state: received.state,
                  expires: services.now() + READER_BRIDGE_SCHEDULE.outcomeLifetime
                };
              } else {
                // Give the next bounded pass a chance without starving later books.
                // Metadata cannot resolve a known conflict, even when its cached
                // comparison expired or the remote files have changed again.
                if (entry.outcome?.state === 'review') status.state = 'review';
                entry.next = services.now();
              }
            } else if (
              row.automaticReceive === true &&
              entry.outcome?.revision === result.observedRevision
            ) {
              status.state = entry.outcome.state === 'review' ? 'review' : 'unchanged';
            }
            entry.status = status;
            entry.failures = 0;
          } catch (error) {
            check();
            const code =
              error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
            const paused = [
              'changed',
              'invalid',
              'not_found',
              'needs_reconnect',
              'unauthorized',
              'forbidden',
              'unsupported'
            ].includes(code);
            entry.status = { revision: row.revision, state: paused ? 'paused' : 'retry' };
            entry.next = paused ? Infinity : services.now() + retry(++entry.failures, error);
          }
          publish();
        }
        // Observation and full comparison have different budgets. Rotate past
        // the last receive attempt so a frequently changing first book cannot
        // consume the only receive slot every pass and starve the other books.
        if (afterReceive !== undefined) cursor = afterReceive;
      } catch (error) {
        if (!operation.signal.aborted) retryAt = services.now() + retry(++failures, error);
      } finally {
        if (pending === operation) pending = undefined;
        running = false;
      }
    },
    cancel,
    invalidate() {
      cancel();
      memory.clear();
      retryAt = 0;
      cursor = 0;
      publish();
    },
    stop() {
      active = false;
      cancel();
      memory.clear();
      services.publish({});
    }
  };
}
