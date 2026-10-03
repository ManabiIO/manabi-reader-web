/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type {
  ContentSearchView,
  NativeContentHit,
  NativeContentSearchState
} from './content-search-contract';

type SearchCommand = (
  method: 'library.content.start' | 'library.content.read' | 'library.content.cancel' | 'open',
  payload: Record<string, unknown>
) => Promise<unknown>;
export interface ContentSearchScreenState {
  result?: NativeContentSearchState;
  pending: boolean;
  opening: boolean;
  error: string;
}
/** Native lifecycle only; all projection, matching, identity and passage admission stay in DOM. */
export class NativeContentSearchController {
  state: ContentSearchScreenState = { pending: false, opening: false, error: '' };
  private generation = 0;
  private readGeneration = 0;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private command: SearchCommand,
    private changed: (state: ContentSearchScreenState) => void,
    private interval = 350
  ) {}
  private publish(change: Partial<ContentSearchScreenState>) {
    this.state = { ...this.state, ...change };
    if (!this.disposed) this.changed(this.state);
  }
  private cancelToken(token: string) {
    void this.command('library.content.cancel', { token }).catch(() => {});
  }
  cancel() {
    this.generation++;
    this.readGeneration++;
    clearTimeout(this.timer);
    if (this.state.result) this.cancelToken(this.state.result.token);
    this.publish({ result: undefined, pending: false, opening: false, error: '' });
  }
  async start(query: string, view: ContentSearchView) {
    if (this.disposed) return;
    this.cancel();
    if (!query.trim() || [...query].length > 512) {
      this.publish({ error: 'Enter a passage search of 1–512 characters.' });
      return;
    }
    const generation = this.generation;
    this.publish({ pending: true });
    try {
      const result = (await this.command('library.content.start', {
        query,
        view
      })) as NativeContentSearchState;
      if (generation !== this.generation || this.disposed) {
        this.cancelToken(result.token);
        return;
      }
      this.publish({ result, pending: false });
      this.poll();
    } catch {
      if (generation === this.generation && !this.disposed)
        this.publish({ pending: false, error: 'Passage search could not start. Try again.' });
    }
  }
  private poll() {
    clearTimeout(this.timer);
    if (this.state.result?.status === 'loading' && !this.state.opening && !this.disposed)
      this.timer = setTimeout(() => void this.load(this.state.result?.offset ?? 0), this.interval);
  }
  async load(offset: number) {
    const result = this.state.result;
    if (!result || this.disposed || this.state.opening) return;
    clearTimeout(this.timer);
    const generation = this.generation;
    const request = ++this.readGeneration;
    try {
      const next = (await this.command('library.content.read', {
        token: result.token,
        offset,
        limit: result.limit
      })) as NativeContentSearchState;
      if (
        this.disposed ||
        generation !== this.generation ||
        request !== this.readGeneration ||
        next.token !== result.token
      )
        return;
      this.publish({ result: next, error: next.error ?? '' });
      this.poll();
    } catch {
      if (!this.disposed && generation === this.generation && request === this.readGeneration) {
        this.cancelToken(result.token);
        this.publish({ result: undefined, error: 'This passage search expired. Search again.' });
      }
    }
  }
  async open(hit: NativeContentHit, navigate: (bookId: number) => void) {
    const result = this.state.result;
    if (
      !result ||
      this.disposed ||
      this.state.opening ||
      !result.items.some((item) => item.key === hit.key && item.bookId === hit.bookId)
    )
      return;
    const generation = this.generation;
    clearTimeout(this.timer);
    this.readGeneration++;
    this.publish({ opening: true, error: '' });
    try {
      await this.command('open', {
        bookId: hit.bookId,
        librarySearchToken: result.token,
        librarySearchHit: hit.key
      });
      if (generation === this.generation && !this.disposed) navigate(hit.bookId);
    } catch {
      if (generation === this.generation && !this.disposed) {
        this.cancelToken(result.token);
        this.publish({
          result: undefined,
          error: 'This passage could not be opened. Search again.'
        });
      }
    } finally {
      if (generation === this.generation && !this.disposed) this.publish({ opening: false });
    }
  }
  activate() {
    this.disposed = false;
  }
  dispose() {
    this.disposed = true;
    this.cancel();
  }
}
