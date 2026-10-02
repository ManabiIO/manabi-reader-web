/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Navigation } from '../runtime/navigation';
const activeOwners = new Set<WebReaderDeparture>();
export function hasActiveWebReaderDeparture() {
  return [...activeOwners].some((owner) => owner.active);
}

export interface WebReaderDepartureOwner {
  /** The same route admission and account must still own every async result. */
  isCurrent(): boolean;
  suspend(): Promise<boolean>;
  resume(): void;
  /** Resolves only after the actual reader and its controllers have unmounted. */
  retire(): Promise<void>;
  /** Re-admit saved content if another guard canceled after retirement started. */
  restore(): Promise<void>;
  failed(error: unknown): void;
}

/** One web admission holds departure until its data and DOM owners settle.
 * This gate is deliberately independent of Expo: push and browser traversal
 * enter the same Navigation protocol and retain their exact retry action. */
export class WebReaderDeparture {
  private disposed = false;
  private working = false;
  private phase: 'active' | 'approved' | 'retiring' | 'retired' | 'departed' = 'active';
  private latest?: Navigation;
  private approved?: symbol;
  private retirement?: Promise<void>;
  private drain?: Promise<void>;

  constructor(private readonly owner: WebReaderDepartureOwner) {
    activeOwners.add(this);
  }
  get active() {
    return this.current() && !this.departed;
  }

  get departed() {
    return this.phase === 'departed';
  }

  private current() {
    return !this.disposed && this.owner.isCurrent();
  }

  beforeNavigate = (navigation: Navigation) => {
    if (!this.current() || this.departed || !navigation.to || navigation.willUnload) return;
    if (navigation.type === 'fragment') return;
    const from = navigation.from.url,
      to = navigation.to.url;
    if (
      navigation.type === 'goto' &&
      from.pathname === to.pathname &&
      from.search === to.search &&
      (to.hash !== '' || to.hash !== from.hash)
    )
      return;
    if (navigation.intent === this.approved) {
      navigation.retainOwner(() => this.current() && navigation.intent === this.latest?.intent);
      navigation.beforeCommit(async () => {
        if (!this.current() || navigation.intent !== this.latest?.intent) {
          navigation.cancel();
          return;
        }
        this.retirement ??= this.retire();
        await this.retirement;
        if (!this.current() || navigation.intent !== this.latest?.intent) {
          navigation.cancel();
          return;
        }
      });
      navigation.afterCommit(() => {
        if (this.current() && navigation.intent === this.latest?.intent) this.phase = 'departed';
      });
      return;
    }
    navigation.cancel();
    this.latest = navigation;
    if (this.working) return;
    this.working = true;
    this.drain = this.finishDeparture();
  };

  private async retire() {
    this.phase = 'retiring';
    await this.owner.retire();
    this.phase = 'retired';
  }

  private async keepReader() {
    if (!this.current()) return;
    if (this.retirement) await this.owner.restore();
    else this.owner.resume();
    if (!this.current()) return;
    this.phase = 'active';
    this.retirement = undefined;
  }

  private async finishDeparture() {
    try {
      const saved = await this.owner.suspend();
      if (!this.current()) return;
      if (!saved) {
        await this.keepReader();
        return;
      }
      this.phase = 'approved';
      while (this.current() && this.latest) {
        const pending = this.latest;
        this.approved = pending.intent;
        await pending.retry();
        if (!this.current() || this.departed) return;
        if (this.latest !== pending) continue;
        // An independent guard rejected the replay. Keep the original mounted
        // admission, or restore its saved state if cleanup had already begun.
        await this.keepReader();
        return;
      }
    } catch (error) {
      if (!this.current()) return;
      await this.keepReader();
      if (this.current()) this.owner.failed(error);
    } finally {
      this.latest = undefined;
      this.approved = undefined;
      this.working = false;
    }
  }

  /** Test/host settlement boundary; no polling or timing assumption is needed. */
  settled(): Promise<void> {
    return this.drain ?? Promise.resolve();
  }

  dispose() {
    activeOwners.delete(this);
    this.disposed = true;
    this.latest = undefined;
  }
}
