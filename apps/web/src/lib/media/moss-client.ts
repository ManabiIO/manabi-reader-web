/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { type ModelProgress } from './model-cache.js';

/** One worker/model at a time. Constructor injection is reserved for test/custom hosting. */
export class MossClient {
  private worker?: Worker;
  private ready = false;
  private cancelFlag?: Int32Array;
  private busy = false;
  private serial = 0;
  private rejectActive?: (error: unknown) => void;
  private crashed = (event: Event) =>
    this.workerFailed(event, 'The transcription worker stopped. Completed windows were kept.');
  private unreadable = (event: Event) =>
    this.workerFailed(
      event,
      'The transcription worker returned an unreadable message. Retry transcription.'
    );
  private workerFailed(event: Event, message: string) {
    if (event.currentTarget !== this.worker) return;
    this.rejectActive?.(new Error(message));
    this.retire();
  }
  constructor(
    private runtimeBase: string,
    private workerURL?: URL
  ) {}
  private retire() {
    const worker = this.worker;
    this.worker = undefined;
    this.ready = false;
    this.cancelFlag = undefined;
    if (worker) {
      worker.removeEventListener('error', this.crashed);
      worker.removeEventListener('messageerror', this.unreadable);
      try {
        worker.postMessage({ type: 'dispose' });
      } catch {
        /* Already crashed/closed. */
      }
      setTimeout(() => worker.terminate(), 50);
    }
  }
  private call(
    type: 'prepare' | 'transcribe',
    fields: Record<string, unknown>,
    signal: AbortSignal,
    progress: (p: ModelProgress) => void = () => {},
    transfer: Transferable[] = []
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (this.busy) return Promise.reject(new Error('Concurrent MOSS calls are not supported'));
    let worker: Worker;
    try {
      // Keep the default Worker + URL expression literal: Vite must see and bundle it.
      if (!this.worker) {
        this.worker = this.workerURL
          ? new Worker(this.workerURL, { type: 'module' })
          : new Worker(new URL('./moss-worker.ts', import.meta.url), { type: 'module' });
        // Keep these listeners between calls: a warm worker can also crash while idle.
        this.worker.addEventListener('error', this.crashed);
        this.worker.addEventListener('messageerror', this.unreadable);
      }
      worker = this.worker;
    } catch (error) {
      return Promise.reject(error);
    }
    this.busy = true;
    // The C bridge stores operation IDs in a signed 32-bit cancellation word.
    // Avoid JS numbers eventually wrapping through an implementation-defined cast.
    this.serial = this.serial >= 0x7ffffffe ? 1 : this.serial + 1;
    const id = crypto.randomUUID(),
      operation = this.serial;
    return new Promise((yes, no) => {
      let done = false,
        timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error: unknown, value?: unknown) => {
        if (done) return;
        done = true;
        this.busy = false;
        this.rejectActive = undefined;
        clearTimeout(timer);
        worker.removeEventListener('message', message);
        signal.removeEventListener('abort', cancel);
        if (error) no(error);
        else yes(value);
      };
      const fail = (error: unknown) => {
        finish(error);
        this.retire();
      };
      this.rejectActive = (error) => finish(error);
      const message = (event: MessageEvent) => {
        if (!event.data || typeof event.data !== 'object' || event.data.id !== id) return;
        if (signal.aborted) {
          fail(signal.reason);
          return;
        }
        if (event.data.type === 'progress') {
          try {
            const p = event.data.value;
            if (
              !p ||
              !['checking', 'downloading', 'verifying', 'loading'].includes(p.stage) ||
              !Number.isSafeInteger(p.loaded) ||
              !Number.isSafeInteger(p.total) ||
              p.loaded < 0 ||
              p.total <= 0 ||
              p.loaded > p.total
            )
              throw new Error('Invalid model download progress');
            progress({ stage: p.stage, loaded: p.loaded, total: p.total });
          } catch (e) {
            fail(e);
          }
          return;
        }
        if (event.data.type === 'error') {
          fail(new Error(String(event.data.value)));
          return;
        }
        try {
          if (
            type === 'prepare' &&
            (event.data.type === 'runtime' || event.data.type === 'ready')
          ) {
            const p = event.data.value;
            if (p !== null) {
              if (
                !p ||
                typeof SharedArrayBuffer === 'undefined' ||
                !(p.buffer instanceof SharedArrayBuffer) ||
                !Number.isSafeInteger(p.offset) ||
                p.offset <= 0 ||
                p.offset % 4 ||
                p.offset + 4 > p.buffer.byteLength
              )
                throw new Error('Invalid transcription cancellation buffer');
              this.cancelFlag = new Int32Array(p.buffer, p.offset, 1);
            } else this.cancelFlag = undefined;
            // The early handshake only makes preparation cancellable. It
            // must not admit transcription until all weights are loaded.
            if (event.data.type === 'runtime') return;
            this.ready = true;
          } else if (
            type !== 'transcribe' ||
            event.data.type !== 'result' ||
            typeof event.data.value !== 'string' ||
            event.data.value.length > 1024 * 1024
          ) {
            throw new Error('Invalid transcription worker response');
          }
          finish(null, event.data.value);
        } catch (e) {
          fail(e);
        }
      };
      const cancel = () => {
        try {
          if (type === 'prepare') worker.postMessage({ type: 'cancel-download', id });
          if (this.cancelFlag) Atomics.store(this.cancelFlag, 0, operation);
          else if (type !== 'prepare') {
            fail(signal.reason);
            return;
          }
          timer = setTimeout(() => fail(signal.reason), type === 'prepare' ? 2000 : 15000);
        } catch {
          fail(signal.reason);
        }
      };
      worker.addEventListener('message', message);
      signal.addEventListener('abort', cancel, { once: true });
      try {
        signal.throwIfAborted();
        worker.postMessage({ id, type, operation, ...fields }, transfer);
      } catch (e) {
        fail(e);
      }
    });
  }
  async prepare(signal: AbortSignal, progress: (p: ModelProgress) => void) {
    signal.throwIfAborted();
    if (this.ready) return;
    const threaded = globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
    const threads = threaded
      ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))
      : 1;
    await this.call(
      'prepare',
      {
        url: `${this.runtimeBase}/${threaded ? 'threaded' : 'single'}/moss.mjs`,
        threads,
        threaded: !!threaded
      },
      signal,
      progress
    );
  }
  async transcribe(pcm: Float32Array, signal: AbortSignal) {
    if (!this.ready) throw new Error('Prepare the transcription model first');
    return (await this.call('transcribe', { pcm }, signal, () => {}, [
      pcm.buffer as ArrayBuffer
    ])) as string;
  }
  dispose() {
    this.rejectActive?.(new DOMException('Transcription runtime closed', 'AbortError'));
    this.retire();
  }
}
