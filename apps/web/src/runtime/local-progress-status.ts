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
let active: { token: symbol; retry(): Promise<void> } | undefined;

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
  const current = () => !retired && active?.token === token && isCurrent();
  const publish = (state: LocalProgressState) => {
    if (current()) {
      status.set({ ...scope, state });
      if (state === 'failed') onFailure?.();
    }
  };
  // A late close/save from a retired session must not take the active reader's
  // slot. Its existing commit still runs, but it cannot publish UI state.
  if (isCurrent()) {
    active = {
      token,
      retry: async () => {
        if (current()) await retry();
      }
    };
    publish('unknown');
  } else retired = true;
  return {
    async track<T>(commit: () => Promise<T>): Promise<T> {
      const serial = ++attempt;
      publish('saving');
      try {
        const value = await commit();
        if (serial === attempt) publish('saved');
        return value;
      } catch (error) {
        if (serial === attempt) publish('failed');
        throw error;
      }
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

export async function retryLocalProgressSave() {
  await active?.retry();
}
