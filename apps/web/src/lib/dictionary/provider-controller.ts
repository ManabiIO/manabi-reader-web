/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { Provider } from './api';

export interface ManagedProvider {
  start(signal: AbortSignal): Promise<void>;
  /** Must synchronously stop admissions and invalidate pending popup results. */
  stopAccepting(): void;
  /** Must settle owned work and surrender scanner/storage ownership. */
  close(): Promise<void>;
}
export interface TransitionState { provider: Provider; phase: 'idle' | 'switching' | 'active' | 'failed'; error?: Error }

/** Serialized ownership, not just event-listener replacement. No implicit provider selection. */
export class ProviderController {
  private tail: Promise<void> = Promise.resolve();
  private owned?: ManagedProvider;
  private pending?: AbortController;
  private epoch = 0;
  private disposed = false;
  private failure?: Error;
  constructor(
    private readonly create: (provider: Provider) => ManagedProvider,
    private readonly changed: (state: TransitionState) => void
  ) {}

  select(provider: Provider): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Dictionary provider controller is closed'));
    const epoch = ++this.epoch;
    this.pending?.abort();
    this.owned?.stopAccepting();
    const abort = new AbortController(); this.pending = abort;
    this.changed({ provider, phase: 'switching' });
    const transition = async () => {
      if (this.failure) throw this.failure;
      await this.release();
      if (this.disposed || epoch !== this.epoch) return;
      const next = this.create(provider);
      this.owned = next;
      try {
        await next.start(abort.signal);
        if (abort.signal.aborted || this.disposed || epoch !== this.epoch) { await this.release(); return; }
        this.changed({ provider, phase: 'active' });
      } catch (error) {
        await this.release();
        if (!abort.signal.aborted && epoch === this.epoch) throw error;
      }
    };
    const operation = this.tail.then(transition).catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (epoch === this.epoch && !this.disposed) this.changed({ provider, phase: 'failed', error: failure });
      throw failure;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }

  private async release() {
    const previous = this.owned;
    if (!previous) return;
    previous.stopAccepting();
    try { await previous.close(); this.owned = undefined; }
    catch (error) {
      // Ownership is uncertain: do not start a second managed scanner.
      this.failure = error instanceof Error ? error : new Error(String(error));
      throw this.failure;
    }
  }

  close(): Promise<void> {
    this.disposed = true; this.epoch += 1;
    this.pending?.abort(); this.owned?.stopAccepting();
    return this.tail.then(() => this.release());
  }
}
