/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { EditorsPick } from '../lib/library/editors-picks';
import type { BookAccessIdentity } from '../lib/data/database/books-db/book-identity';
import type { LibraryAuthority } from './contract';
import { CATALOG_LIFETIME, CATALOG_PAGE_LIMIT, type NativeCatalogState } from './catalog-contract';

export interface CatalogRepository {
  load(authority: LibraryAuthority): Promise<EditorsPick[]>;
  prepare(pick: EditorsPick, authority: LibraryAuthority): Promise<BookAccessIdentity>;
}
interface CatalogRun {
  token: string;
  created: number;
  authority: LibraryAuthority;
  controller: AbortController;
  picks: Map<string, EditorsPick>;
  state: NativeCatalogState;
  consumed: boolean;
  timer?: ReturnType<typeof setTimeout>;
  release(): void;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const token = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;
const text = (value: string, limit: number) => value.replace(/<[^>]*>/g, '').slice(0, limit);

/** One DOM-owned catalog and one import slot; cancellation never frees a still-running import. */
export class NativeCatalogService {
  private run?: CatalogRun;
  private importing = false;
  constructor(
    private repository: CatalogRepository,
    private makeToken = () => crypto.randomUUID(),
    private now = () => Date.now()
  ) {}
  private assert(authority: LibraryAuthority) {
    authority.signal.throwIfAborted();
    authority.assertCurrent();
  }
  private current(run: CatalogRun) {
    this.assert(run.authority);
    if (
      this.run !== run ||
      this.now() < run.created ||
      this.now() - run.created >= CATALOG_LIFETIME
    )
      throw new Error('The catalog selection expired. Load Editor’s Picks again.');
  }
  private stop(run: CatalogRun) {
    run.controller.abort();
    clearTimeout(run.timer);
    run.release();
    run.picks.clear();
    if (this.run === run) this.run = undefined;
  }
  start(payload: unknown, authority: LibraryAuthority): NativeCatalogState {
    this.assert(authority);
    if (!record(payload) || Object.keys(payload).length)
      throw new Error('Invalid catalog request.');
    if (this.run) this.stop(this.run);
    const controller = new AbortController();
    const run: CatalogRun = {
      token: this.makeToken(),
      created: this.now(),
      controller,
      authority: {
        key: authority.key,
        signal: AbortSignal.any([authority.signal, controller.signal]),
        assertCurrent: () => this.assert(authority)
      },
      picks: new Map(),
      consumed: false,
      state: {
        token: '',
        status: 'loading',
        items: [],
        total: 0,
        offset: 0,
        limit: CATALOG_PAGE_LIMIT
      },
      release: () => authority.signal.removeEventListener('abort', cancel)
    };
    const cancel = () => this.stop(run);
    authority.signal.addEventListener('abort', cancel, { once: true });
    run.state.token = run.token;
    this.run = run;
    run.timer = setTimeout(cancel, CATALOG_LIFETIME);
    void this.load(run);
    return structuredClone(run.state);
  }
  private async load(run: CatalogRun) {
    try {
      const picks = await this.repository.load(run.authority);
      this.current(run);
      if (picks.length > 1000) throw new Error('Catalog limit exceeded.');
      run.state.items = picks.map((pick) => {
        const key = this.makeToken();
        run.picks.set(key, structuredClone(pick));
        return {
          key,
          title: text(pick.title, 1000),
          author: text(pick.author, 1000),
          summary: text(pick.summary, 2000)
        };
      });
      run.state.total = picks.length;
      run.state.status = 'ready';
    } catch {
      if (this.run !== run || run.authority.signal.aborted) return;
      run.picks.clear();
      run.state = { ...run.state, status: 'error', items: [], total: 0 };
    }
  }
  private selected(payload: unknown, authority: LibraryAuthority, fields: string[]) {
    this.assert(authority);
    if (
      !record(payload) ||
      Object.keys(payload).some((key) => !['token', ...fields].includes(key)) ||
      !token(payload.token)
    )
      throw new Error('Invalid catalog selection.');
    const run = this.run;
    if (!run || run.token !== payload.token || run.authority.key !== authority.key || run.consumed)
      throw new Error('The catalog selection expired. Load Editor’s Picks again.');
    this.current(run);
    return { run, payload };
  }
  read(payload: unknown, authority: LibraryAuthority): NativeCatalogState {
    const { run, payload: value } = this.selected(payload, authority, ['offset']);
    const offset = value.offset ?? 0;
    if (!Number.isSafeInteger(offset) || Number(offset) < 0 || Number(offset) > 1000)
      throw new Error('Invalid catalog page.');
    const response = structuredClone({
      ...run.state,
      offset: Number(offset),
      items: run.state.items.slice(Number(offset), Number(offset) + CATALOG_PAGE_LIMIT)
    });
    if (new TextEncoder().encode(JSON.stringify(response)).length > 384 * 1024)
      throw new Error('The catalog page exceeds the native size limit.');
    return response;
  }
  async open(payload: unknown, authority: LibraryAuthority) {
    const { run, payload: value } = this.selected(payload, authority, ['key']);
    if (!token(value.key) || !run.picks.has(value.key) || run.state.status !== 'ready')
      throw new Error('This book is outside the current catalog.');
    if (this.importing)
      throw new Error(
        'A catalog import is still settling. Refresh the Library before trying again.'
      );
    const pick = structuredClone(run.picks.get(value.key)!);
    run.consumed = true;
    this.importing = true;
    try {
      const identity = await this.repository.prepare(pick, run.authority);
      this.assert(authority);
      this.current(run);
      return { identity, assertCurrent: () => this.current(run) };
    } catch {
      throw new Error(
        'The catalog book could not be opened. A copy may already be saved. Refresh the Library before trying again.'
      );
    } finally {
      this.importing = false;
    }
  }
  cancel(payload: unknown, authority: LibraryAuthority) {
    this.assert(authority);
    if (
      !record(payload) ||
      Object.keys(payload).some((key) => key !== 'token') ||
      !token(payload.token)
    )
      throw new Error('Invalid catalog cancellation.');
    if (this.run?.token === payload.token && this.run.authority.key === authority.key)
      this.stop(this.run);
    return { cancelled: true };
  }
  dispose() {
    if (this.run) this.stop(this.run);
  }
}
