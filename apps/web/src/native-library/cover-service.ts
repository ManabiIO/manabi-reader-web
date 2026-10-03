/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ShelfBook } from '../lib/library/view-model';
import type { LibraryAuthority } from './contract';
import {
  LIBRARY_COVER_CONCURRENCY,
  validNativeLibraryCover,
  type LibraryCoverReply,
  type LibraryCoverRequest,
  type NativeLibraryCover
} from './cover-contract';

export interface LibraryCoverTarget {
  book: ShelfBook;
  /** Canonical content hash or existing legacy UUID; never serialized to native. */
  readerBookKey: string;
}
export type RenderLibraryCover = (
  target: LibraryCoverTarget,
  authority: LibraryAuthority
) => Promise<NativeLibraryCover | null>;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const handle = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;
interface CoverView {
  token: string;
  scope: string;
  created: number;
  targets: Map<string, LibraryCoverTarget>;
}
/** A separate read admission; never consumes or renews a Library mutation token. */
export class NativeLibraryCoverService {
  private view?: CoverView;
  private jobs = new Map<string, { view: CoverView; controller: AbortController }>();
  constructor(
    private render?: RenderLibraryCover,
    private now = () => Date.now()
  ) {}
  install(token: string, scope: string, targets: Map<string, LibraryCoverTarget>) {
    this.dispose();
    this.view = { token, scope, targets, created: this.now() };
  }
  private assert(view: CoverView, authority: LibraryAuthority) {
    authority.signal.throwIfAborted();
    authority.assertCurrent();
    if (
      this.view !== view ||
      view.scope !== authority.key ||
      this.now() < view.created ||
      this.now() - view.created > 10 * 60 * 1000
    )
      throw new Error('This Library cover view expired.');
  }
  async read(payload: unknown, authority: LibraryAuthority): Promise<LibraryCoverReply> {
    if (
      !record(payload) ||
      Object.keys(payload).some((key) => !['token', 'key', 'request'].includes(key)) ||
      !handle(payload.token) ||
      !handle(payload.key) ||
      !handle(payload.request)
    )
      throw new Error('Invalid Library cover request.');
    const request = { ...payload } as unknown as LibraryCoverRequest;
    const view = this.view;
    if (!view || request.token !== view.token) throw new Error('This Library cover view expired.');
    this.assert(view, authority);
    const target = view.targets.get(request.key);
    if (!target) throw new Error('This cover is outside the current Library view.');
    if (this.jobs.has(request.request) || this.jobs.size >= LIBRARY_COVER_CONCURRENCY)
      throw new Error('Too many Library covers are loading.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    authority.signal.addEventListener('abort', abort, { once: true });
    const guard: LibraryAuthority = {
      key: authority.key,
      signal: controller.signal,
      assertCurrent: () => {
        controller.signal.throwIfAborted();
        this.assert(view, authority);
      }
    };
    this.jobs.set(request.request, { view, controller });
    try {
      guard.assertCurrent();
      const image = (await this.render?.(target, guard)) ?? null;
      guard.assertCurrent();
      return { ...request, image: validNativeLibraryCover(image) ? image : null };
    } catch (cause) {
      if (!controller.signal.aborted) throw cause;
      authority.signal.throwIfAborted();
      authority.assertCurrent();
      return { ...request, image: null };
    } finally {
      authority.signal.removeEventListener('abort', abort);
      this.jobs.delete(request.request);
    }
  }
  cancel(payload: unknown, authority: LibraryAuthority): { cancelled: true } {
    if (
      !record(payload) ||
      Object.keys(payload).some((key) => !['token', 'requests'].includes(key)) ||
      !handle(payload.token) ||
      (payload.requests !== undefined &&
        (!Array.isArray(payload.requests) ||
          payload.requests.length > LIBRARY_COVER_CONCURRENCY ||
          payload.requests.some((request) => !handle(request))))
    )
      throw new Error('Invalid Library cover cancellation.');
    authority.signal.throwIfAborted();
    authority.assertCurrent();
    for (const [request, job] of this.jobs)
      if (
        job.view.token === payload.token &&
        job.view.scope === authority.key &&
        (payload.requests === undefined || (payload.requests as string[]).includes(request))
      )
        job.controller.abort();
    if (payload.requests === undefined && this.view?.token === payload.token) this.view = undefined;
    return { cancelled: true };
  }
  dispose() {
    this.view = undefined;
    // Keep occupied slots until decode actually settles; cancellation cannot start an unbounded queue.
    for (const job of this.jobs.values()) job.controller.abort();
  }
}
