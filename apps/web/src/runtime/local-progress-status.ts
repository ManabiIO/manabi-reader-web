/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { writable, readonly } from '../lib/state/store';

export type LocalProgressState = 'unknown' | 'saving' | 'saved' | 'failed';
export interface LocalProgressScope {
  bookId: number;
  profileId: string | null;
  generation: number;
}
export interface LocalProgressStatus extends LocalProgressScope {
  state: LocalProgressState;
}
const status = writable<LocalProgressStatus | null>(null);
export const localProgressStatus = readonly(status);
let active: { token: symbol; retry(expected?: LocalProgressStatus): Promise<void> } | undefined;

/** Observes the existing database commit; never writes progress or persists a
 * second success flag. Session ownership and latest-attempt fencing keep older
 * completions from describing a newer book, profile, or save attempt. */
export function createLocalProgressOwner({
  scope,
  isCurrent,
  retry,
  onFailure
}: {
  scope: LocalProgressScope;
  isCurrent(): boolean;
  retry(): Promise<void>;
  onFailure?(): void;
}) {
  const token = Symbol('reading-progress');
  let retired = false;
  let attempt = 0;
  let published: LocalProgressStatus | undefined;
  let retrying: Promise<void> | undefined;
  let retryStatus: LocalProgressStatus | undefined;
  const current = () => !retired && active?.token === token && isCurrent();
  const publish = (state: LocalProgressState) => {
    if (current()) {
      status.set((published = { ...scope, state }));
      if (state === 'failed') onFailure?.();
    }
  };
  // A late close/save from a retired session must not take the active reader's
  // slot. Its existing commit still runs, but it cannot publish UI state.
  if (isCurrent()) {
    active = {
      token,
      retry: (expected) => {
        // A rendered Retry belongs to that exact acknowledgement, including
        // when another session has since opened the same book and profile.
        if (!current()) return Promise.resolve();
        if (retrying) return !expected || expected === retryStatus ? retrying : Promise.resolve();
        if (published?.state !== 'failed' || (expected && expected !== published))
          return Promise.resolve();
        retryStatus = published;
        retrying = (async () => {
          await retry();
        })().finally(() => {
          retrying = undefined;
          retryStatus = undefined;
        });
        return retrying;
      }
    };
    publish('unknown');
  } else retired = true;
  return {
    fail() {
      ++attempt;
      publish('failed');
    },
    async track<T>(commit: () => Promise<T>, acknowledge?: (value: T) => void): Promise<T> {
      const serial = ++attempt;
      publish('saving');
      let value: T;
      try {
        value = await commit();
      } catch (error) {
        if (serial === attempt) publish('failed');
        throw error;
      }
      if (serial === attempt && current()) {
        publish('saved');
        if (serial === attempt && current()) acknowledge?.(value);
      }
      return value;
    },
    dispose() {
      retired = true;
      if (active?.token === token) {
        active = undefined;
        status.set(null);
      }
    }
  };
}

export async function retryLocalProgressSave(expected?: LocalProgressStatus) {
  await active?.retry(expected);
}
