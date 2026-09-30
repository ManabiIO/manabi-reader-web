/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { abortable } from './abort.js';

export interface DecodePipeline {
  decode(trackId: number, start: number, end: number, signal: AbortSignal): Promise<Float32Array>;
  dispose(): void;
}

interface Session {
  signal: AbortSignal;
  controller: AbortController;
  stop: () => void;
  ready: Promise<DecodePipeline>;
  pipeline?: DecodePipeline;
}

/** Reuse decoder/container state only for one queue-owner signal.
 * A successor owner with the same durable job ID always receives a fresh session.
 * Cancellation retires the decoder immediately; a non-cooperating late open is
 * observed and disposed rather than being allowed to resurrect the session.
 */
export class DecodeSessionCache<Job extends { id: string }> {
  private sessions = new Map<string, Session>();
  private closed = false;

  constructor(private open: (job: Job, signal: AbortSignal) => Promise<DecodePipeline>) {}

  private create(job: Job, signal: AbortSignal): Session {
    // A caller can retain its job object. Retirement owns the ID admitted here,
    // not a later mutation of that object while opening or decoding is pending.
    const id = job.id;
    const controller = new AbortController();
    const raw = Promise.resolve().then(() => {
      // Opening is deliberately deferred. Cancel/Close can win before it starts.
      controller.signal.throwIfAborted();
      return this.open(job, controller.signal);
    });
    const externalAbort = () => this.retire(id, entry, signal.reason);
    const entry: Session = {
      signal,
      controller,
      stop: () => signal.removeEventListener('abort', externalAbort),
      ready: abortable(controller.signal, () => raw)
    };
    this.sessions.set(id, entry);
    signal.addEventListener('abort', externalAbort, { once: true });
    if (signal.aborted) externalAbort();

    void raw.then(
      (pipeline) => {
        if (controller.signal.aborted || this.sessions.get(id) !== entry) {
          pipeline.dispose();
          return;
        }
        entry.pipeline = pipeline;
      },
      () => {
        /* ready carries the authoritative open failure. */
      }
    );
    void entry.ready.catch((error) => {
      if (this.sessions.get(id) === entry) this.retire(id, entry, error);
    });
    return entry;
  }

  async decode(
    job: Job,
    trackId: number,
    start: number,
    end: number,
    signal: AbortSignal
  ): Promise<Float32Array> {
    signal.throwIfAborted();
    if (this.closed) throw new Error('The decoder cache is closed');
    let entry = this.sessions.get(job.id);
    if (entry && entry.signal !== signal) {
      this.retire(
        job.id,
        entry,
        new DOMException('Transcription decoder owner changed', 'AbortError')
      );
      entry = undefined;
    }
    entry ??= this.create(job, signal);
    const pipeline = await entry.ready;
    // Disposing a decoder does not guarantee that its pending promise settles.
    // Detach the retired caller, observe late failure, and never return stale PCM.
    return await abortable(entry.controller.signal, () =>
      pipeline.decode(trackId, start, end, entry.controller.signal)
    );
  }

  private retire(id: string, entry: Session, reason: unknown): void {
    if (this.sessions.get(id) === entry) this.sessions.delete(id);
    entry.stop();
    const pipeline = entry.pipeline;
    entry.pipeline = undefined;
    if (!entry.controller.signal.aborted) entry.controller.abort(reason);
    pipeline?.dispose();
    // If open ignored cancellation and returns later, the raw observer above
    // sees the retired entry and disposes that late pipeline exactly once.
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, entry] of [...this.sessions])
      this.retire(id, entry, new DOMException('Decoder cache closed', 'AbortError'));
  }
}
