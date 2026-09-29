/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { kinds, remote, type Replica } from './replica.js';
import { type Scope } from './contracts.js';
import { MediaStore, type MediaWriteGuard } from './store.js';
import { abortable } from './abort.js';
export interface SyncTransport {
  userId: string;
  isCurrent(): boolean;
  request<T>(
    path: string,
    options?: {
      method?: 'POST';
      value?: unknown;
      userId?: string;
    }
  ): Promise<T>;
}
export interface SyncStatus {
  state: 'idle' | 'syncing' | 'synced' | 'pending' | 'conflict' | 'error';
  message: string;
  conflicts: Replica[];
}
/** Same authenticated personal feed, but an independent cursor and typed video records. */
export async function syncMedia(
  store: MediaStore,
  transport: SyncTransport,
  signal: AbortSignal,
  publish: (s: SyncStatus) => void = () => {}
) {
  const userId = transport.userId;
  const isCurrent = transport.isCurrent.bind(transport);
  const scope: Scope = `account:${userId}`;
  const current = () => {
    try {
      return transport.userId === userId && isCurrent();
    } catch {
      return false;
    }
  };
  const guard = () => {
    signal.throwIfAborted();
    if (!current()) throw new Error('The signed-in account changed');
  };
  const writeGuard: MediaWriteGuard = { signal, check: guard };
  const notify = (status: SyncStatus) => {
    try {
      publish(status);
    } catch {
      /* UI status is not synchronization authority. */
    }
  };
  const work = async () => {
    guard();
    notify({ state: 'syncing', message: 'Syncing video progress and subtitles…', conflicts: [] });
    let cursor = (await store.local<number>(scope, 'sync', 'cursor')) ?? 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid saved sync cursor');
    // Drain before pushing: never overwrite unknown cloud history from a fresh browser.
    for (let pages = 0; ; pages++) {
      guard();
      if (pages > 10000) throw new Error('Sync feed is unexpectedly large');
      const feed = await abortable(signal, () =>
        transport.request<{
          items: unknown[];
          next_cursor: number;
          has_more: boolean;
        }>(`personal/changes/?cursor=${cursor}&limit=3`, { userId })
      );
      guard();
      if (
        !feed ||
        !Array.isArray(feed.items) ||
        feed.items.length > 3 ||
        !Number.isSafeInteger(feed.next_cursor) ||
        feed.next_cursor < cursor ||
        typeof feed.has_more !== 'boolean' ||
        (feed.has_more && feed.next_cursor === cursor)
      )
        throw new Error('Invalid sync feed');
      let previous = cursor;
      for (const item of feed.items) {
        if (!item || typeof item !== 'object' || Array.isArray(item))
          throw new Error('Invalid sync record');
        const value = item as Record<string, unknown>;
        if (
          !Number.isSafeInteger(value.sequence) ||
          (value.sequence as number) <= previous ||
          (value.sequence as number) > feed.next_cursor
        )
          throw new Error('Invalid sync sequence');
        previous = value.sequence as number;
        if (kinds.includes(value.kind as never)) {
          guard();
          await store.accept(scope, remote(value), writeGuard);
        }
      }
      if (feed.next_cursor !== previous) throw new Error('Sync cursor skips unseen records');
      guard();
      await store.putLocal(scope, 'sync', 'cursor', feed.next_cursor, writeGuard);
      cursor = feed.next_cursor;
      if (!feed.has_more) break;
    }
    const pending = (await store.records(scope))
      .filter((r) => r.dirty || r.pending)
      .sort((a, b) => (a.kind === 'video_track' ? 1 : 0) - (b.kind === 'video_track' ? 1 : 0));
    for (const candidate of pending) {
      guard();
      if (candidate.conflict) continue;
      const r = await store.prepare(scope, candidate.kind, candidate.id, writeGuard);
      if (!r.pending) continue;
      // Snapshot the admitted mutation before any asynchronous transport work.
      // The closure must not depend on a later re-read of optional pending state.
      const pendingRequest = r.pending.request;
      guard();
      try {
        const response = await abortable(signal, () =>
          transport.request<{
            accepted: boolean;
            mutation_id: string;
            record: unknown;
          }>('personal/mutations/', {
            method: 'POST',
            value: pendingRequest,
            userId
          })
        );
        guard();
        if (response.accepted !== true || response.mutation_id !== pendingRequest.mutation_id)
          throw new Error('Invalid sync acknowledgement');
        await store.ack(scope, r.kind, r.id, response.mutation_id, response.record, writeGuard);
      } catch (e) {
        signal.throwIfAborted();
        const error = e as { status?: number; current?: unknown } | null | undefined;
        if (error?.status === 412 && error.current) {
          if (!current()) throw e;
          await store.conflict(
            scope,
            r.kind,
            r.id,
            remote(error.current),
            pendingRequest.mutation_id,
            writeGuard
          );
        } else throw e;
      }
    }
    guard();
    const remaining = await store.records(scope);
    const conflicts = remaining.filter((r) => r.conflict);
    const stillPending = remaining.some((r) => !r.conflict && (r.dirty || r.pending));
    guard();
    notify({
      state: conflicts.length ? 'conflict' : stillPending ? 'pending' : 'synced',
      message: conflicts.length
        ? 'Both copies changed. Choose which version to keep.'
        : stillPending
          ? 'New changes are saved on this device and waiting to sync.'
          : 'Video progress and subtitles synced.',
      conflicts
    });
  };
  try {
    if (navigator.locks)
      await navigator.locks.request(`manabi-video-sync/${userId}`, { signal }, work);
    else await work();
  } catch (error) {
    if (!signal.aborted && current())
      notify({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
        conflicts: []
      });
    throw error;
  }
}
