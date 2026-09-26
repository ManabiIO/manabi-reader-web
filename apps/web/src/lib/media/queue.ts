/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { type ContentKey, type Scope, type Track, language } from './contracts.js';
import { MediaStore } from './store.js';
import { MOSS, type ModelProgress } from './model-cache.js';
import { parseMoss, planWindows, ownedCues } from './moss-output.js';
import { validateJob, ownsJob, releasedJob, JobOwnershipLost, JOB_LEASE_MS, type Job } from './jobs.js';
export type { Job } from './jobs.js';
export interface Engine {
  prepare(signal: AbortSignal, progress: (p: ModelProgress) => void): Promise<void>;
  transcribe(pcm: Float32Array, signal: AbortSignal): Promise<string>;
  dispose(): void | Promise<void>;
}
export interface QueueProgress {
  job: Job;
  stage: string;
  loaded: number;
  total: number;
}
/** One warm model per draining batch; the origin lock covers its whole lifetime.
 * The runtime is stopped before releasing the lock, not retained by idle tabs.
 * Durable owner tokens also fence old workers and cancellation at every checkpoint.
 * On browsers without Web Locks an expired lease can be reclaimed without allowing
 * its former owner to publish. This is not a promise of OS background execution.
 */
export class TranscriptionQueue {
  private running = false;
  private admitted = new Map<string, symbol>();
  private batch?: AbortController;
  private closing?: Promise<void>;
  private task?: Promise<void>;
  private rerun = false;
  private active?: {
    id: string;
    ownerId: string;
    controller: AbortController;
  };
  private closed = false;
  private stopStore?: () => void;
  private checking?: Promise<void>;
  private recovering?: Promise<void>;
  private checkAgain = false;
  constructor(
    private store: MediaStore,
    private scope: Scope,
    private engine: Engine,
    private decode: (job: Job, start: number, end: number, signal: AbortSignal) => Promise<Float32Array>,
    private changed: (p: QueueProgress) => void = () => {},
    private failed: (error: unknown) => void = () => {}
  ) {
    this.stopStore = store.subscribe?.(() => { void this.checkCancellation(); });
  }
  private report(error: unknown) { if (!this.closed) {
    try {
      this.failed(error);
    }
    catch { /* UI is not durable state. */ }
  } }
  private notify(p: QueueProgress) { if (!this.closed) {
    try {
      this.changed(p);
    }
    catch (e) {
      this.report(e);
    }
  } }
  private compatible(job: Job) {
    if (job.modelSha256 !== MOSS.sha256 || job.engineRevision !== MOSS.engineRevision)
      throw new Error('This job uses another model revision. Generate a new track instead.');
  }
  private async jobs() { return (await this.store.listLocal<unknown>(this.scope, 'jobs')).map(validateJob); }
  async enqueue(key: ContentKey, lang: string, audioTrack: string, duration: number): Promise<Job> {
    if (this.closed)
      throw new Error('The queue is closed');
    const draft = validateJob({ version: 1, id: crypto.randomUUID(), mediaKey: key, language: language(lang), audioTrack,
      duration, status: 'queued', nextWindow: 0, cues: [], modelSha256: MOSS.sha256,
      engineRevision: MOSS.engineRevision, createdAt: Date.now() });
    const job = await this.store.enqueueJob(this.scope, draft, () => {
      if (this.closed)
        throw new Error('The queue is closed');
    });
    this.admitted.set(job.id, Symbol());
    this.kick();
    return job;
  }
  async resume(id: string) {
    if (this.closed)
      throw new Error('The queue is closed');
    await this.store.updateLocal<Job>(this.scope, 'jobs', id, old => {
      if (!old)
        return old;
      const job = validateJob(old);
      if (job.id !== id)
        throw new Error('Wrong saved job identity');
      if (job.status === 'complete' || job.status === 'queued')
        return old;
      if (job.status === 'running' && (job.leaseUntil ?? 0) > Date.now())
        throw new Error('This job is still active in another tab. Cancel it before resuming.');
      this.compatible(job);
      if (this.closed)
        throw new Error('The queue is closed');
      const next = releasedJob(job, 'queued');
      delete next.error;
      return next;
    });
    this.admitted.set(id, Symbol());
    this.kick();
  }
  async cancel(id: string) {
    if (this.active?.id === id)
      this.active.controller.abort(new DOMException('Generation cancelled', 'AbortError'));
    await this.store.updateLocal<Job>(this.scope, 'jobs', id, old => {
      if (!old)
        return old;
      const job = validateJob(old);
      if (job.id !== id)
        throw new Error('Wrong saved job identity');
      if (job.status === 'complete')
        return old;
      // Retain the owner's newest checkpoint. Its next atomic publication sees this bit.
      return job.status === 'running' ? { ...job, cancelRequested: true } : releasedJob(job, 'paused');
    });
  }
  recover(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.recovering) return this.recovering;
    const task = this.recoverJobs();
    this.recovering = task;
    const settled = () => {
      if (this.recovering === task) this.recovering = undefined;
    };
    void task.then(settled, settled);
    return task;
  }
  private async recoverJobs() {
    const recover = async (exclusive: boolean) => {
      for (const job of await this.jobs()) {
        if (this.closed)
          return;
        await this.store.updateLocal<Job>(this.scope, 'jobs', job.id, old => {
          if (!old || this.closed)
            return old;
          const latest = validateJob(old);
          // A queued job can belong to a live workspace waiting for this
          // very lock. Startup is not evidence that its owner crashed.
          // Unadmitted queued jobs remain explicitly resumable in the UI.
          if (latest.status === 'running' && (exclusive || (latest.leaseUntil ?? 0) <= Date.now()))
            return releasedJob(latest, 'paused');
          return old;
        });
      }
    };
    if (navigator.locks)
      await navigator.locks.request('manabi-moss-inference', { ifAvailable: true }, async (lock) => { if (lock)
        await recover(true); });
    else
      await recover(false);
  }
  private checkCancellation(): Promise<void> {
    if (this.checking) {
      this.checkAgain = true;
      return this.checking;
    }
    const active = this.active;
    if (!active || active.controller.signal.aborted || this.closed)
      return Promise.resolve();
    const check = (async () => {
      try {
        const raw = await this.store.local<Job>(this.scope, 'jobs', active.id);
        if (this.active !== active)
          return;
        const job = raw && validateJob(raw);
        // A candidate may still be queued while its atomic claim is pending.
        if (job?.status === 'queued')
          return;
        if (!ownsJob(job, active.ownerId))
          active.controller.abort(new JobOwnershipLost());
      }
      catch (e) {
        if (this.active === active)
          active.controller.abort(e);
      }
    })();
    this.checking = check;
    void check.finally(() => {
      if (this.checking === check)
        this.checking = undefined;
      if (this.checkAgain) {
        this.checkAgain = false;
        void this.checkCancellation();
      }
    });
    return check;
  }
  private kick() {
    if (this.closed)
      return;
    this.rerun = true;
    if (this.running)
      return;
    // Observe background errors without converting the owned operation into a
    // successful promise: close() must still receive real teardown failures.
    const task = this.run();
    this.task = task;
    const settled = () => {
      if (this.task === task) this.task = undefined;
    };
    void task.then(settled, error => {
      settled();
      this.report(error);
    });
  }
  private async run() {
    if (this.running || this.closed)
      return;
    this.running = true;
    this.rerun = false;
    const batch = new AbortController();
    this.batch = batch;
    const drain = async () => {
      try {
        batch.signal.throwIfAborted();
        for (;;) {
          if (this.closed)
            break;
          this.rerun = false;
          // A queued record is account-shared, but its plain File may
          // exist only in the workspace that admitted it. Do not drain
          // another tab's jobs with this workspace's source resolver.
          const admitted = new Map(this.admitted);
          const jobs = new Map((await this.jobs()).map(job => [job.id, job]));
          let candidate: Job | undefined;
          for (const [id, token] of admitted) {
            if (this.admitted.get(id) !== token)
              continue;
            const job = jobs.get(id);
            if (job?.status === 'queued') {
              candidate ??= job;
            }
            else
              this.admitted.delete(id);
          }
          if (this.closed || !candidate)
            break;
          // Remove before running so a later explicit resume/enqueue
          // can independently admit the same id during completion.
          this.admitted.delete(candidate.id);
          const controller = new AbortController(), ownerId = crypto.randomUUID();
          this.active = { id: candidate.id, ownerId, controller };
          const signal = controller.signal;
          const work = async () => {
            signal.throwIfAborted();
            const claimed = await this.store.updateLocal<Job>(this.scope, 'jobs', candidate.id, old => {
              if (!old)
                return old;
              const job = validateJob(old);
              if (job.id !== candidate.id)
                throw new Error('Wrong saved job identity');
              if (job.status !== 'queued')
                return old;
              signal.throwIfAborted();
              return { ...job, status: 'running', ownerId, leaseUntil: Date.now() + JOB_LEASE_MS, cancelRequested: false };
            });
            if (!claimed || !ownsJob(claimed, ownerId))
              return;
            let job = claimed;
            let renewal: Promise<void> | undefined;
            const heartbeat = setInterval(() => {
              if (renewal || signal.aborted)
                return;
              renewal = this.store.updateLocal<Job>(this.scope, 'jobs', job.id, old => {
                signal.throwIfAborted();
                if (!ownsJob(old, ownerId))
                  throw new JobOwnershipLost();
                return { ...old!, leaseUntil: Date.now() + JOB_LEASE_MS };
              }).then(() => {}, e => controller.abort(e)).finally(() => { renewal = undefined; });
            }, 15000);
            const checkpoint = async () => {
              signal.throwIfAborted();
              const snapshot = validateJob(job);
              const saved = await this.store.updateLocal<Job>(this.scope, 'jobs', job.id, old => {
                if (!ownsJob(old, ownerId))
                  throw new JobOwnershipLost();
                signal.throwIfAborted();
                return { ...snapshot, leaseUntil: Date.now() + JOB_LEASE_MS };
              });
              job = saved!;
            };
            try {
              this.compatible(job);
              const windows = planWindows(job.duration);
              for (let i = job.nextWindow; i < windows.length; i++) {
                signal.throwIfAborted();
                const w = windows[i];
                this.notify({ job, stage: 'decoding', loaded: i, total: windows.length });
                const pcm = await this.decode(job, w.start, w.end, signal);
                signal.throwIfAborted();
                if (!(pcm instanceof Float32Array) || !pcm.length || pcm.length > 16000 * 64 || !pcm.every(Number.isFinite))
                  throw new Error('Invalid decoded audio window');
                this.notify({ job, stage: 'transcribing', loaded: i, total: windows.length });
                // Resolve/validate audio BEFORE downloading hundreds of MB of
                // weights. Exact silence needs no recognizer, not even preparation.
                // prepare() reuses the same live instance for the current batch.
                let raw = '';
                if (!pcm.every(x => x === 0)) {
                  await this.engine.prepare(signal, p => this.notify({ job, ...p }));
                  signal.throwIfAborted();
                  raw = await this.engine.transcribe(pcm, signal);
                }
                signal.throwIfAborted();
                job.cues.push(...ownedCues(parseMoss(raw, w.end - w.start), w));
                if (job.cues.length > 50000)
                  throw new Error('Transcript exceeds the caption limit');
                job.nextWindow = i + 1;
                await checkpoint();
                this.notify({ job, stage: 'transcribing', loaded: i + 1, total: windows.length });
              }
              job.completedAt ??= Date.now();
              await checkpoint(); // Stable provenance survives retry after publication failure.
              const track: Track = { version: 1, id: job.id, mediaKey: job.mediaKey, language: job.language,
                kind: 'transcription', origin: 'generated', label: `${job.language} · MOSS 0.9B`, cues: job.cues,
                complete: true, forced: false, createdAt: job.createdAt,
                provenance: { engine: 'moss-transcribe.cpp', engineRevision: job.engineRevision, model: MOSS.model,
                  modelRevision: MOSS.revision, modelSha256: job.modelSha256, quantization: MOSS.quantization,
                  audioTrack: job.audioTrack, windowSeconds: 60, overlapSeconds: 2, generatedAt: job.completedAt! } };
              const completed = releasedJob(job, 'complete');
              delete completed.error;
              signal.throwIfAborted();
              await this.store.saveTrack(this.scope, track, { ownerId, job: completed });
              job = completed;
              this.notify({ job, stage: 'complete', loaded: windows.length, total: windows.length });
            }
            catch (e) {
              const paused = signal.aborted || e instanceof JobOwnershipLost;
              const latest = await this.store.updateLocal<Job>(this.scope, 'jobs', job.id, old => {
                // Never replace a successor owner or its completed result with a stale error.
                if (!old || old.ownerId !== ownerId || old.status !== 'running')
                  return old;
                const next = releasedJob(validateJob(old), paused ? 'paused' : 'failed');
                next.error = (e instanceof Error ? e.message : String(e)).slice(0, 2048) || 'Transcription failed';
                return next;
              });
              if (latest && latest.status !== 'complete')
                this.notify({ job: latest, stage: latest.status, loaded: latest.nextWindow, total: planWindows(latest.duration).length });
            }
            finally {
              clearInterval(heartbeat);
              // Clearing the timer does not settle a transaction already admitted
              // by its callback. Keep it inside this job and the origin lock.
              await renewal;
            }
          };
          try {
            await work();
          }
          catch (e) {
            if (!signal.aborted || e !== signal.reason)
              throw e;
          }
          finally {
            this.active = undefined;
          }
        }
      }
      finally {
        // Keep the lease through shutdown of weights AND the pthread workers.
        // Successive queued files share a warm model; idle tabs do not retain it.
        await this.engine.dispose();
      }
    };
    try {
      if (navigator.locks)
        await navigator.locks.request('manabi-moss-inference', { signal: batch.signal }, drain);
      else
        await drain();
    }
    catch (error) {
      // Only the actual cancellation reason is expected. An aborted signal
      // does not turn a failed checkpoint or runtime retirement into success.
      if (!batch.signal.aborted || error !== batch.signal.reason)
        throw error;
    }
    finally {
      if (this.batch === batch)
        this.batch = undefined;
      this.running = false;
      if (this.rerun && !this.closed)
        this.kick();
    }
  }
  dispose(): Promise<void> {
    if (this.closing)
      return this.closing;
    this.closed = true;
    this.stopStore?.();
    this.admitted.clear();
    const reason = new DOMException('Video workspace closed', 'AbortError');
    this.batch?.abort(reason); // Also cancels a lock request before any job is claimed.
    this.active?.controller.abort(reason);
    // The draining batch is the sole runtime-retirement owner. It awaits
    // engine.dispose() before releasing the origin Web Lock. Calling dispose
    // again here would impose an undocumented idempotency requirement on Engine.
    this.closing = Promise.allSettled([this.task, this.checking, this.recovering]).then(results => {
      // A teardown error must not let the owner close storage while the
      // active job is still publishing its pause/checkpoint transaction.
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => r.reason);
      if (failures.length)
        throw new AggregateError(failures, 'Transcription queue shutdown failed');
    });
    return this.closing;
  }
}
