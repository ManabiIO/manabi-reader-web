/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Scope } from './contracts.js';

export interface ProfileEvent<Connection> {
  status: 'loading' | 'available' | 'unavailable' | 'offline';
  userId: string | null;
  connection?: Connection;
}
export interface ProfileWorkspace<Connection> {
  setConnection(connection: Connection | undefined): void;
  dispose(): Promise<void>;
}

/** Account transitions serialize teardown. A delayed offline read cannot mount an old owner. */
export class ProfileLifetime<Connection> {
  private epoch = 0;
  private stopped = false;
  private scope?: Scope;
  private workspace?: ProfileWorkspace<Connection>;
  private chain: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;

  constructor(
    private offlineProfile: () => Promise<string | null>,
    private mount: (scope: Scope, connection?: Connection) => ProfileWorkspace<Connection>,
    private onError: (error: unknown) => void
  ) {}

  update(event: ProfileEvent<Connection>): Promise<void> {
    if (this.stopped) return this.closing ?? this.chain;
    const epoch = ++this.epoch;
    // Same-account available refreshes already contain enough identity to update
    // authority synchronously. Let the workspace compare connection generations
    // instead of revoking healthy cloud playback on every session-store emission.
    const sameAvailableScope =
      event.status === 'available' &&
      !!event.userId &&
      this.scope === `account:${event.userId}` &&
      !!this.workspace;
    if (sameAvailableScope) this.workspace!.setConnection(event.connection);
    else this.workspace?.setConnection(undefined);
    if (event.status === 'loading') return this.chain;
    this.chain = this.chain
      .then(async () => {
        if (this.stopped || epoch !== this.epoch) return;
        const userId =
          event.userId ?? (event.status === 'offline' ? await this.offlineProfile() : null);
        if (this.stopped || epoch !== this.epoch) return;
        const scope: Scope = userId ? `account:${userId}` : 'guest';
        // Offline display identity is never used to create an authenticated connection.
        const connection =
          event.status === 'available' && event.userId ? event.connection : undefined;
        if (scope === this.scope && this.workspace) {
          this.workspace.setConnection(connection);
          return;
        }
        const retired = this.workspace;
        this.workspace = undefined;
        this.scope = undefined;
        await retired?.dispose();
        if (this.stopped || epoch !== this.epoch) return;
        this.workspace = this.mount(scope, connection);
        this.scope = scope;
      })
      .catch((error) => {
        if (!this.stopped && epoch === this.epoch) this.onError(error);
      });
    return this.chain;
  }

  stop(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopped = true;
    ++this.epoch;
    this.workspace?.setConnection(undefined);
    this.closing = this.chain.then(async () => {
      const retired = this.workspace;
      this.workspace = undefined;
      this.scope = undefined;
      await retired?.dispose();
    });
    return this.closing;
  }
}
