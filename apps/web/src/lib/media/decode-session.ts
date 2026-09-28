/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { abortable } from './abort.js';

export interface DecodePipeline {
  decode(
    trackId: number,
    start: number,
    end: number,
    signal: AbortSignal
  ): Promise<Float32Array>;
  dispose(): void;
}

interface Session {
  signal: AbortSignal;
  controller: AbortController;
  stop: () => void;
  raw: Promise<DecodePipeline>;
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

  constructor(
    private open: (job: Job, signal: AbortSignal) => Promise<DecodePipeline>
  ) {}

  private create(job: Job, signal: AbortSignal): Session {
    const controller = new AbortController();
    let entry!: Session;
    const externalAbort = () => this.retire(job.id, entry, signal.reason);
    const stop = () => signal.removeEventListener('abort', externalAbort);
    entry = {
      signal,
      controller,
      stop,
      raw: Promise.resolve().then(() => this.open(job, controller.signal)),
      ready: undefined as unknown as Promise<DecodePipeline>
    };
    this.sessions.set(job.id, entry);
    signal.addEventListener('abort', externalAbort, { once: true });
    if (signal.aborted) externalAbort();

    void entry.raw.then(
      (pipeline) => {
        if (controller.signal.aborted || this.sessions.get(job.id) !== entry) {
          pipeline.dispose();
          return;
        }
        entry.pipeline = pipeline;
      },
      () => {
        /* ready carries the authoritative open failure. */
      }
    );
    entry.ready = abortable(controller.signal, () => entry.raw);
    void entry.ready.catch((error) => {
      if (this.sessions.get(job.id) === entry)
        this.retire(job.id, entry, error);
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
    entry.controller.signal.throwIfAborted();
    return await pipeline.decode(trackId, start, end, entry.controller.signal);
  }

  release(id: string): void {
    const entry = this.sessions.get(id);
    if (entry)
      this.retire(id, entry, new DOMException('Transcription decoder released', 'AbortError'));
  }

  private retire(id: string, entry: Session, reason: unknown): void {
    if (this.sessions.get(id) === entry) this.sessions.delete(id);
    entry.stop();
    if (!entry.controller.signal.aborted) entry.controller.abort(reason);
    entry.pipeline?.dispose();
    // If open ignored cancellation and returns later, the raw observer above
    // sees the retired entry and disposes that late pipeline exactly once.
  }

  dispose(): void {
    for (const [id, entry] of [...this.sessions])
      this.retire(id, entry, new DOMException('Decoder cache closed', 'AbortError'));
  }
}
