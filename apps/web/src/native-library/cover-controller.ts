/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  LIBRARY_COVER_CACHE_LIMIT,
  LIBRARY_COVER_CONCURRENCY,
  LIBRARY_COVER_VISIBLE_LIMIT,
  validNativeLibraryCover,
  type LibraryCoverReply,
  type NativeLibraryCover
} from './cover-contract';

type CoverCommand = (
  method: 'library.cover.read' | 'library.cover.cancel',
  payload: Record<string, unknown>
) => Promise<unknown>;
export interface NativeCoverState {
  token: string;
  images: ReadonlyMap<string, NativeLibraryCover | null>;
}
let instances = 0;
/** Native-only viewport/cache ownership. No database, paths, provider URLs or DOM imports. */
export class NativeLibraryCoverController {
  private token = '';
  private generation = 0;
  private sequence = 0;
  private instance = ++instances;
  private active = true;
  private mayRefreshExpiredView = true;
  private disposed = false;
  private admitted = new Set<string>();
  private visible: string[] = [];
  private cache = new Map<string, NativeLibraryCover | null>();
  private pending = new Map<
    string,
    { key: string; token: string; generation: number; cancelled: boolean }
  >();
  constructor(
    private command: CoverCommand,
    private changed: (state: NativeCoverState) => void,
    private refreshExpiredView?: () => void
  ) {}
  private publish() {
    if (!this.disposed) this.changed({ token: this.token, images: new Map(this.cache) });
  }
  private cancel(token: string, requests?: string[]) {
    if (token)
      void this.command('library.cover.cancel', { token, ...(requests ? { requests } : {}) }).catch(
        () => {}
      );
  }
  setView(token = '', keys: readonly string[] = []) {
    if (token === this.token) return;
    this.cancel(this.token);
    this.generation++;
    for (const pending of this.pending.values()) pending.cancelled = true;
    this.token = token;
    this.admitted = new Set(keys);
    this.cache.clear();
    this.publish();
    this.pump();
  }
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.generation++;
    if (!active) {
      const requests: string[] = [];
      for (const [request, pending] of this.pending)
        if (pending.token === this.token && !pending.cancelled) {
          pending.cancelled = true;
          requests.push(request);
        }
      if (requests.length) this.cancel(this.token, requests);
      this.cache.clear();
      this.publish();
    }
    this.pump();
  }
  viewport(keys: readonly string[]) {
    // A user viewport change may refresh one expired admission. A replacement
    // token alone must not turn a repeated failure into an automatic retry loop.
    this.mayRefreshExpiredView = true;
    this.visible = [...new Set(keys)].slice(0, LIBRARY_COVER_VISIBLE_LIMIT);
    const requests: string[] = [];
    for (const [request, pending] of this.pending)
      if (
        pending.token === this.token &&
        !pending.cancelled &&
        !this.visible.includes(pending.key)
      ) {
        pending.cancelled = true;
        requests.push(request);
      }
    if (requests.length) this.cancel(this.token, requests);
    this.pump();
  }
  private pump() {
    if (!this.active || this.disposed || !this.token) return;
    for (const key of this.visible) {
      if (this.pending.size >= LIBRARY_COVER_CONCURRENCY) return;
      if (!this.admitted.has(key)) continue;
      if (
        this.cache.has(key) ||
        [...this.pending.values()].some((job) => job.key === key && job.token === this.token)
      )
        continue;
      const request = `cover_${this.instance}_${++this.sequence}`;
      const job = { key, token: this.token, generation: this.generation, cancelled: false };
      this.pending.set(request, job);
      void this.command('library.cover.read', { token: job.token, key, request })
        .then((value) => {
          const reply = value as LibraryCoverReply | undefined;
          if (!this.current(job)) return;
          const valid =
            reply?.token === job.token &&
            reply.key === key &&
            reply.request === request &&
            validNativeLibraryCover(reply.image);
          this.cache.set(key, valid ? reply.image : null);
          this.trim();
          this.publish();
        })
        .catch((cause) => {
          // Broken or missing images keep the title card. A long-idle read
          // admission can be refreshed once for this user viewport change.
          if (this.current(job)) {
            this.cache.set(key, null);
            this.trim();
            this.publish();
            if (
              cause instanceof Error &&
              cause.message === 'This Library cover view expired.' &&
              this.mayRefreshExpiredView &&
              this.refreshExpiredView
            ) {
              this.mayRefreshExpiredView = false;
              this.refreshExpiredView();
            }
          }
        })
        .finally(() => {
          // Keep a cancelled slot occupied until its bridge command actually settles.
          this.pending.delete(request);
          this.pump();
        });
    }
  }
  private current(job: { token: string; generation: number; cancelled: boolean }) {
    return (
      !this.disposed &&
      this.active &&
      !job.cancelled &&
      job.token === this.token &&
      job.generation === this.generation
    );
  }
  private trim() {
    while (this.cache.size > LIBRARY_COVER_CACHE_LIMIT) {
      const oldest = [...this.cache.keys()].find((key) => !this.visible.includes(key));
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }
  activate() {
    this.disposed = false;
  }
  dispose() {
    this.setView();
    this.disposed = true;
  }
}
