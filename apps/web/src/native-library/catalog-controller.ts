/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { NativeCatalogState } from './catalog-contract';
type CatalogCommand = (
  method:
    | 'library.catalog.start'
    | 'library.catalog.read'
    | 'library.catalog.open'
    | 'library.catalog.cancel',
  payload: Record<string, unknown>
) => Promise<unknown>;
export interface CatalogScreenState {
  result?: NativeCatalogState;
  pending: boolean;
  opening: string;
  error: string;
}
export class NativeCatalogController {
  state: CatalogScreenState = { pending: false, opening: '', error: '' };
  private generation = 0;
  private readGeneration = 0;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private command: CatalogCommand,
    private changed: (state: CatalogScreenState) => void,
    private interval = 500
  ) {}
  private publish(change: Partial<CatalogScreenState>) {
    this.state = { ...this.state, ...change };
    if (!this.disposed) this.changed(this.state);
  }
  private cancelToken(token: string) {
    void this.command('library.catalog.cancel', { token }).catch(() => {});
  }
  cancel() {
    this.generation++;
    this.readGeneration++;
    clearTimeout(this.timer);
    if (this.state.result) this.cancelToken(this.state.result.token);
    this.publish({ result: undefined, pending: false, opening: '', error: '' });
  }
  async start() {
    if (this.disposed) return;
    this.cancel();
    const generation = this.generation;
    this.publish({ pending: true });
    try {
      const result = (await this.command('library.catalog.start', {})) as NativeCatalogState;
      if (this.disposed || generation !== this.generation) {
        this.cancelToken(result.token);
        return;
      }
      this.publish({ result, pending: false });
      this.poll();
    } catch {
      if (!this.disposed && generation === this.generation)
        this.publish({
          pending: false,
          error: 'Editor’s Picks could not load. Check your connection and try again.'
        });
    }
  }
  private poll() {
    clearTimeout(this.timer);
    if (!this.disposed && this.state.result?.status === 'loading' && !this.state.opening)
      this.timer = setTimeout(() => void this.load(0), this.interval);
  }
  async load(offset: number) {
    const result = this.state.result;
    if (this.disposed || !result || this.state.opening) return;
    clearTimeout(this.timer);
    const generation = this.generation;
    const request = ++this.readGeneration;
    try {
      const next = (await this.command('library.catalog.read', {
        token: result.token,
        offset
      })) as NativeCatalogState;
      if (
        this.disposed ||
        generation !== this.generation ||
        request !== this.readGeneration ||
        next.token !== result.token
      )
        return;
      this.publish({
        result: next,
        error:
          next.status === 'error'
            ? 'Editor’s Picks are unavailable right now. Check your connection and try again.'
            : ''
      });
      this.poll();
    } catch {
      if (!this.disposed && generation === this.generation && request === this.readGeneration) {
        this.cancelToken(result.token);
        this.publish({
          result: undefined,
          error: 'The catalog expired. Load Editor’s Picks again.'
        });
      }
    }
  }
  async open(key: string, navigate: (id: number) => void) {
    const result = this.state.result;
    if (
      this.disposed ||
      !result ||
      this.state.opening ||
      result.status !== 'ready' ||
      !result.items.some((item) => item.key === key)
    )
      return;
    const generation = this.generation;
    clearTimeout(this.timer);
    this.readGeneration++;
    this.publish({ opening: key, error: '' });
    try {
      const value = await this.command('library.catalog.open', { token: result.token, key });
      if (
        !value ||
        typeof value !== 'object' ||
        !('bookId' in value) ||
        !Number.isSafeInteger(value.bookId) ||
        Number(value.bookId) < 1
      )
        throw new Error('Invalid reader admission.');
      if (this.disposed || generation !== this.generation) return;
      // Relinquish catalog cleanup before the intentional reader route unmounts us.
      // The native navigation owner already holds the admitted reader identity.
      this.publish({ result: undefined, opening: '' });
      navigate(Number(value.bookId));
    } catch {
      if (!this.disposed && generation === this.generation) {
        this.cancelToken(result.token);
        this.publish({
          result: undefined,
          opening: '',
          error:
            'Opening did not finish. A copy may already be saved. Refresh the Library before trying again.'
        });
      }
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
