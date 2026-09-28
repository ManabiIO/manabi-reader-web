/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export type ReaderChromeMode = 'hidden' | 'transient' | 'pinned';
export interface ChromeScheduler {
  schedule(callback: () => void, delay: number): unknown;
  cancel(handle: unknown): void;
}
const browserScheduler: ChromeScheduler = {
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};
/** Explicit reveal is never turned back into a timed reveal by subsequent pointer motion. */
export class ReaderChrome {
  mode: ReaderChromeMode = 'transient';
  private timer: unknown;
  private revision = 0;
  private disposed = false;
  private changed: (mode: ReaderChromeMode) => void;
  private protectedInteraction: () => boolean;
  private scheduler: ChromeScheduler;
  readonly delay: number;
  constructor(
    changed: (mode: ReaderChromeMode) => void,
    protectedInteraction: () => boolean = () => false,
    scheduler = browserScheduler,
    delay = 3000
  ) {
    this.changed = changed;
    this.protectedInteraction = protectedInteraction;
    this.scheduler = scheduler;
    this.delay = delay;
    this.arm();
  }
  private clear() {
    this.revision++;
    if (this.timer !== undefined) this.scheduler.cancel(this.timer);
    this.timer = undefined;
  }
  private set(mode: ReaderChromeMode) {
    if (this.disposed) return;
    this.clear();
    this.mode = mode;
    this.changed(mode);
    if (mode === 'transient') this.arm();
  }
  private arm() {
    this.clear();
    const revision = this.revision;
    this.timer = this.scheduler.schedule(() => {
      if (this.disposed || revision !== this.revision || this.mode !== 'transient') return;
      this.timer = undefined;
      if (this.protectedInteraction()) this.arm();
      else this.set('hidden');
    }, this.delay);
  }
  pointer() {
    if (this.mode !== 'pinned') this.set('transient');
  }
  pin() {
    this.set('pinned');
  }
  hide() {
    this.set('hidden');
  }
  toggle() {
    this.set(this.mode === 'pinned' ? 'hidden' : 'pinned');
  }
  reading() {
    if (!this.protectedInteraction()) this.hide();
  }
  dispose() {
    this.clear();
    this.disposed = true;
  }
}
