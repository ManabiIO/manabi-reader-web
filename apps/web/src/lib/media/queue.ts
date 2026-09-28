/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { type ContentKey, type Cue, type Scope, type Track, language } from './contracts.js';
import { MediaStore } from './store.js';
import { MOSS, type ModelProgress } from './model-cache.js';
import { audioProofAsync } from './audio-proof.js';
import type { DeviceKey } from './device-checkpoint.js';
import { parseMoss, parseMossPreview, planWindows, ownedCues } from './moss-output.js';
import { newProgressiveState } from './moss-progressive.js';
import { retainAcceptedRepair } from './moss-repair.js';
import { transcribeWithPreview } from './moss-preview.js';
import { transcribeProgressively } from './progressive-transcription.js';
import {
  newSparseState,
  assertSparseRepairTiming,
  pendingSparseSeam,
  sparseModelPcm,
  sparseBounds,
  acceptedSparseCues,
  nextSparseWindow,
  sparseCoverage,
  assembleSparse
} from './sparse-transcription.js';
import {
  validateJob,
  ownsJob,
  releasedJob,
  JobOwnershipLost,
  JOB_LEASE_MS,
  jobCanResume,
  jobContentKey,
  type Job
} from './jobs.js';
export type { Job } from './jobs.js';
class AwaitVerifiedIdentity extends Error {
  constructor() {
    super('Waiting for the full video identity before publishing captions.');
  }
}
const ENGINE_SOURCE = '190a569c13b4b247450f2fb3b2a431244e84833e';
const ENGINE_PREFIX = `${ENGINE_SOURCE}+`;
const PORT_ORDER = new Map([
  ['manabi-web-v3', 3],
  ['manabi-web-v4', 4],
  ['manabi-web-v5', 5],
  ['manabi-web-v6', 6],
  ['manabi-web-v7', 7]
]);
function runtimePorts(revision: string): string[] | undefined {
  if (!revision.startsWith(ENGINE_PREFIX)) return undefined;
  const ports = revision.slice(ENGINE_PREFIX.length).split(',');
  if (!ports.length || ports.some((port) => !PORT_ORDER.has(port))) return undefined;
  for (let i = 0; i < ports.length; i++) {
    if (i && PORT_ORDER.get(ports[i - 1])! >= PORT_ORDER.get(ports[i])!) return undefined;
  }
  return ports;
}
function continuedRuntime(revision: string, hasPriorWindows: boolean): string {
  if (!hasPriorWindows) return MOSS.engineRevision;
  const ports = runtimePorts(revision);
  if (!ports)
    throw new Error('This job uses another model revision. Generate a new track instead.');
  const current = MOSS.engineRevision.slice(ENGINE_PREFIX.length);
  return ports.includes(current) ? revision : `${ENGINE_PREFIX}${[...ports, current].join(',')}`;
}
function missingAccepted(accepted: readonly Cue[], next: readonly Cue[]) {
  const byId = new Map(next.map((cue) => [cue.id, cue]));
  return accepted.filter((cue) => {
    const kept = byId.get(cue.id);
    return (
      !kept ||
      kept.start !== cue.start ||
      kept.end !== cue.end ||
      kept.text !== cue.text ||
      kept.speaker !== cue.speaker
    );
  });
}
function preserveAccepted(accepted: readonly Cue[], next: readonly Cue[]) {
  if (missingAccepted(accepted, next).length)
    throw new Error(
      'Sparse reconciliation would remove an accepted caption; saved hypotheses were kept.'
    );
}
export interface Engine {
  prepare(signal: AbortSignal, progress: (p: ModelProgress) => void): Promise<void>;
  transcribe(
    pcm: Float32Array,
    signal: AbortSignal,
    partial?: (text: string) => void
  ): Promise<string>;
  dispose(): void | Promise<void>;
}
/** Automatic continuation is conditional, unlike an explicit user Resume.
 * The saved pause reason and viewed media are checked in the write transaction;
 * isCurrent also fences a replaced workspace after that transaction commits.
 */
export interface AutomaticResume {
  readonly mediaKey: ContentKey;
  readonly expected: 'queued' | 'switch' | 'identity';
  readonly isCurrent: () => boolean;
}
export interface QueueProgress {
  /** Uncommitted, operation-scoped output. Never written to caption pages or synced. */
  provisional?: Cue[];
  job: Job;
  stage: string;
  loaded: number;
  total: number;
}
type Admission = { isCurrent?: () => boolean };
type ActiveJob = {
  id: string;
  ownerId: string;
  controller: AbortController;
  admission: Admission;
};

/** One warm model per draining batch; the origin lock covers its whole lifetime.
 * The runtime is stopped before releasing the lock, not retained by idle tabs.
 * Durable owner tokens also fence old workers and cancellation at every checkpoint.
 * On browsers without Web Locks an expired lease can be reclaimed without allowing
 * its former owner to publish. This is not a promise of OS background execution.
 */
export class TranscriptionQueue {
  private running = false;
  private admitted = new Map<string, Admission>();
  private targets = new Map<string, number>();
  private batch?: AbortController;
  /** Set only while this batch is queued for the origin inference lock. */
  private lockWait?: AbortController;
  private closing?: Promise<void>;
  private task?: Promise<void>;
  private rerun = false;
  private active?: ActiveJob;
  private closed = false;
  private stopStore?: () => void;
  private checking?: Promise<void>;
  private recovering?: Promise<void>;
  private checkAgain = false;
  constructor(
    private store: MediaStore,
    private scope: Scope,
    private engine: Engine,
    private decode: (
      job: Job,
      start: number,
      end: number,
      signal: AbortSignal
    ) => Promise<Float32Array>,
    private changed: (p: QueueProgress) => void = () => {},
    private failed: (error: unknown) => void = () => {}
  ) {
    this.stopStore = store.subscribe?.(() => {
      void this.checkCancellation();
    });
  }
  private report(error: unknown) {
    if (!this.closed) {
      try {
        this.failed(error);
      } catch {
        /* UI is not durable state. */
      }
    }
  }
  private notify(p: QueueProgress) {
    if (!this.closed) {
      try {
        this.changed(p);
      } catch (e) {
        this.report(e);
      }
    }
  }
  private compatible(job: Job) {
    if (job.modelSha256 !== MOSS.sha256 || !runtimePorts(job.engineRevision))
      throw new Error('This job uses another model revision. Generate a new track instead.');
  }
  private async jobs() {
    return (await this.store.listLocal<unknown>(this.scope, 'jobs')).map(validateJob);
  }
  private requireOriginLock() {
    // Production browser inference must have origin-wide admission. A durable
    // job lease fences writes but cannot stop two tabs allocating model RAM.
    if (typeof window !== 'undefined' && typeof navigator.locks?.request !== 'function')
      throw new Error(
        'Transcription needs browser Web Locks to coordinate model memory across tabs.'
      );
  }
  async enqueue(
    key: ContentKey,
    lang: string,
    audioTrack: string,
    duration: number,
    targetSeconds?: number,
    provisional = false,
    sourceSample?: DeviceKey,
    isCurrent?: () => boolean
  ): Promise<Job> {
    if (this.closed) throw new Error('The queue is closed');
    this.requireOriginLock();
    const draft = validateJob({
      version: targetSeconds === undefined ? 2 : 3,
      ...(targetSeconds === undefined
        ? { progressive: newProgressiveState() }
        : { sparse: newSparseState(duration, targetSeconds) }),
      id: crypto.randomUUID(),
      mediaKey: key,
      ...(provisional ? { provisional: true } : {}),
      ...(provisional && sourceSample ? { sourceSample, audioProofs: [] } : {}),
      language: language(lang),
      audioTrack,
      duration,
      status: 'queued',
      nextWindow: 0,
      cues: [],
      modelSha256: MOSS.sha256,
      engineRevision: MOSS.engineRevision,
      createdAt: Date.now()
    });
    const job = await this.store.enqueueJob(this.scope, draft, () => {
      if (this.closed) throw new Error('The queue is closed');
    });
    // Multiple tabs may persist one deduplicated queued job. Admission is local
    // authority, however: a Generate call that outlived its video/player must not
    // make that old job runnable after the storage transaction finally returns.
    const current = () => {
      if (this.closed) return false;
      try {
        return isCurrent?.() ?? true;
      } catch {
        return false;
      }
    };
    if (!current()) return job;
    this.admitted.set(job.id, isCurrent ? { isCurrent: current } : {});
    this.kick();
    return job;
  }
  /** The full digest may finish while a window is running. Keep its checkpoint
   * owner and attach only the verified portable key in the same local record. */
  async verifyProvisional(
    mediaKey: ContentKey,
    verified: ContentKey,
    id?: string,
    recoveredJob?: Job
  ) {
    const proofSnapshot = recoveredJob?.audioProofs?.map((proof) => ({ ...proof }));
    if (recoveredJob && !proofSnapshot?.length)
      throw new Error('Recovered transcription has no saved audio proof');
    const records = id
      ? [await this.store.local<unknown>(this.scope, 'jobs', id)]
      : await this.store.listLocal<unknown>(this.scope, 'jobs');
    for (const raw of records) {
      if (!raw) continue;
      const job = validateJob(raw);
      if (!job.provisional || job.mediaKey !== mediaKey || (id && job.id !== id)) continue;
      await this.store.updateLocal<Job>(this.scope, 'jobs', job.id, (old) => {
        if (!old) return old;
        const current = validateJob(old);
        if (!current.provisional || current.mediaKey !== mediaKey)
          throw new Error('Provisional transcription identity changed');
        if (
          proofSnapshot &&
          ((current.status !== 'paused' && current.status !== 'failed') ||
            current.sourceSample !== recoveredJob?.sourceSample ||
            current.audioTrack !== recoveredJob?.audioTrack ||
            current.duration !== recoveredJob?.duration ||
            JSON.stringify(current.audioProofs) !== JSON.stringify(proofSnapshot))
        )
          throw new JobOwnershipLost();
        if (current.verifiedMediaKey && current.verifiedMediaKey !== verified)
          throw new Error('Provisional transcription belongs to another video');
        return current.verifiedMediaKey ? old : { ...current, verifiedMediaKey: verified };
      });
    }
  }
  /** Playback and seeks affect the next input, not an in-flight model call. */
  prioritize(id: string, seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0 || this.closed) return;
    this.targets.set(id, seconds);
  }
  resume(id: string): Promise<Job>;
  resume(id: string, automatic: AutomaticResume): Promise<Job | undefined>;
  async resume(id: string, automatic?: AutomaticResume): Promise<Job | undefined> {
    // Snapshot the caller's authority before awaiting storage. The predicate
    // may observe a changing lifetime; replacing the options object may not.
    const condition = automatic && { ...automatic };
    const current = () => !this.closed && (!condition || condition.isCurrent());
    if (condition && !current()) return undefined;
    if (this.closed) throw new Error('The queue is closed');
    this.requireOriginLock();
    let admitted = false;
    const resumed = await this.store.updateLocal<Job>(this.scope, 'jobs', id, (old) => {
      if (condition && (!old || !current())) return old;
      if (!old) throw new Error('The saved transcription no longer exists');
      const job = validateJob(old);
      if (job.id !== id) throw new Error('Wrong saved job identity');
      if (
        condition &&
        (jobContentKey(job) !== condition.mediaKey ||
          job.cancelRequested ||
          (condition.expected === 'queued'
            ? job.status !== 'queued'
            : job.status !== 'paused' || job.pauseReason !== condition.expected))
      )
        return old; // A newer user action, owner or identity wins without a write.
      if (job.status === 'complete') throw new Error('This transcript is already complete');
      if (job.pauseReason === 'identity' && !job.verifiedMediaKey)
        throw new Error('Wait for full video verification before resuming this transcript.');
      if (job.status === 'queued') {
        admitted = true;
        return old;
      }
      if (job.status === 'running' && (job.leaseUntil ?? 0) > Date.now())
        throw new Error('This job is still active in another tab. Cancel it before resuming.');
      if ((job.status === 'paused' || job.status === 'failed') && !jobCanResume(job))
        throw new Error(
          'This saved seam cannot be retried safely with the current window policy. Accepted lines were kept; start a new transcription only after choosing a different policy.'
        );
      this.compatible(job);
      if (this.closed) throw new Error('The queue is closed');
      const next = releasedJob(job, 'queued');
      delete next.error;
      admitted = true;
      return next;
    });
    // A committed queued record is harmless without this queue's admission.
    // A newer tab or explicit Resume may still pick it up; never cancel it here.
    if (condition && (!admitted || !current())) return undefined;
    if (!resumed) throw new Error('The saved transcription no longer exists');
    this.admitted.set(id, condition ? { isCurrent: current } : {});
    this.kick();
    return validateJob(resumed);
  }
  async cancel(id: string) {
    this.targets.delete(id);
    const admission = this.admitted.get(id);
    const active = this.active?.id === id ? this.active : undefined;
    let pending: Promise<Job | undefined>;
    try {
      // Admit the durable user intent before aborting. Its transaction must
      // precede the runner's pause write, without delaying local cancellation.
      pending = this.store.updateLocal<Job>(this.scope, 'jobs', id, (old) => {
        if (!old) return old;
        const job = validateJob(old);
        if (job.id !== id) throw new Error('Wrong saved job identity');
        if (job.status === 'complete') return old;
        // Retain the owner's newest checkpoint. Its next atomic publication sees this bit.
        return job.status === 'running'
          ? { ...job, cancelRequested: true, pauseReason: 'user' }
          : { ...releasedJob(job, 'paused'), pauseReason: 'user' };
      });
    } finally {
      // Revoke only the admission that existed when Cancel began. A newer
      // Resume may already have installed a successor token for the same ID.
      if (admission && this.admitted.get(id) === admission) this.admitted.delete(id);
      active?.controller.abort(new DOMException('Generation cancelled', 'AbortError'));
      // If this tab has no other work and has not acquired the origin lock yet,
      // withdraw its Web Locks request instead of later cutting ahead for no work.
      if (!this.active && !this.admitted.size && this.lockWait === this.batch)
        this.batch?.abort(new DOMException('No local transcription jobs remain', 'AbortError'));
    }
    await pending;
  }
  /** Leaving a video pauses owned inference and revokes local queued admissions. */
  pauseSparseForMedia(
    mediaKey: ContentKey,
    isCurrent: () => boolean = () => true
  ): Promise<string[]> {
    return this.pauseOwnedForMedia(mediaKey, true, isCurrent);
  }
  /** A revoked source also pauses locally owned bulk jobs, never another tab's work. */
  pauseForMedia(mediaKey: ContentKey): Promise<string[]> {
    return this.pauseOwnedForMedia(mediaKey, false);
  }
  private async pauseOwnedForMedia(
    mediaKey: ContentKey,
    sparseOnly: boolean,
    isCurrent: () => boolean = () => true
  ): Promise<string[]> {
    const current = () => !this.closed && isCurrent();
    if (!current()) return [];
    // Capture request identity before the scan. A later explicit Resume/Generate
    // may reuse the same job ID, but not the old local admission token.
    const admissions = new Map(this.admitted),
      activeAtStart = this.active;
    if (activeAtStart && !admissions.has(activeAtStart.id))
      admissions.set(activeAtStart.id, activeAtStart.admission);
    const pending: Job[] = [];
    for (const raw of await this.store.listLocal<unknown>(this.scope, 'jobs')) {
      if (!current()) return [];
      if (
        !raw ||
        typeof raw !== 'object' ||
        ((raw as Job).mediaKey !== mediaKey && (raw as Job).verifiedMediaKey !== mediaKey)
      )
        continue;
      const job = validateJob(raw);
      const token = admissions.get(job.id);
      const local =
        token !== undefined &&
        this.localAdmission(job.id) === token &&
        (job.status === 'queued' ||
          (job.status === 'running' &&
            this.active?.id === job.id &&
            this.active.ownerId === job.ownerId));
      if ((!sparseOnly || job.sparse) && local) pending.push(job);
    }
    // Stop queued alternatives before aborting the current inference, so the
    // drain cannot claim another old-video job in between transactions.
    const paused: string[] = [];
    for (const job of [
      ...pending.filter((job) => job.status === 'queued'),
      ...pending.filter((job) => job.status === 'running')
    ]) {
      if (!current()) break;
      if (
        await this.pauseLocal(job.id, sparseOnly, admissions.get(job.id)!, activeAtStart, current)
      )
        paused.push(job.id);
    }
    return paused;
  }
  private localAdmission(id: string): Admission | undefined {
    return this.admitted.get(id) ?? (this.active?.id === id ? this.active.admission : undefined);
  }
  private async pauseLocal(
    id: string,
    sparseOnly: boolean,
    token: Admission,
    activeAtStart: ActiveJob | undefined,
    current: () => boolean
  ) {
    if (!current() || this.localAdmission(id) !== token) return false;
    this.targets.delete(id);
    // Only revoke this captured request, never a later admission of the same ID.
    const revoked = this.admitted.get(id) === token;
    if (revoked) this.admitted.delete(id);
    const active =
      this.active?.id === id && (this.active === activeAtStart || this.active.admission === token)
        ? this.active
        : undefined;
    if (!active) {
      if (!this.active && !this.admitted.size && this.lockWait === this.batch)
        this.batch?.abort(new DOMException('No local transcription jobs remain', 'AbortError'));
      return revoked;
    }
    let paused = false,
      writeFailed = true;
    try {
      await this.store.updateLocal<Job>(this.scope, 'jobs', id, (old) => {
        if (!old || !current() || this.active !== active || this.admitted.has(id)) return old;
        const job = validateJob(old);
        if (sparseOnly && !job.sparse) return old;
        // A claimed job may still be awaiting its queued -> running write. Its
        // controller fences that write; another tab's owner is never cancelled.
        if (job.status === 'queued') {
          paused = true;
          return old;
        }
        if (
          job.status === 'running' &&
          active.ownerId === job.ownerId &&
          job.pauseReason !== 'user'
        ) {
          paused = true;
          return { ...job, cancelRequested: true, pauseReason: 'switch' };
        }
        return old;
      });
      writeFailed = false;
    } finally {
      // Storage failure cannot retain a model owned by a revoked source/view.
      // Preserve that failure for the caller, but still cancel the exact runner.
      // A newer same-ID admission or replaced view retains its own authority.
      if ((paused || writeFailed) && current() && this.active === active && !this.admitted.has(id))
        active.controller.abort(new DOMException('Generation paused', 'AbortError'));
    }
    return revoked || paused;
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
        if (this.closed) return;
        await this.store.updateLocal<Job>(this.scope, 'jobs', job.id, (old) => {
          if (!old || this.closed) return old;
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
      await navigator.locks.request(
        'manabi-moss-inference',
        { ifAvailable: true },
        async (lock) => {
          if (lock) await recover(true);
        }
      );
    else await recover(false);
  }
  private checkCancellation(): Promise<void> {
    if (this.checking) {
      this.checkAgain = true;
      return this.checking;
    }
    const active = this.active;
    if (!active || active.controller.signal.aborted || this.closed) return Promise.resolve();
    const check = (async () => {
      try {
        const raw = await this.store.local<Job>(this.scope, 'jobs', active.id);
        if (this.active !== active) return;
        const job = raw && validateJob(raw);
        // A candidate may still be queued while its atomic claim is pending.
        if (job?.status === 'queued') return;
        if (!ownsJob(job, active.ownerId)) active.controller.abort(new JobOwnershipLost());
      } catch (e) {
        if (this.active === active) active.controller.abort(e);
      }
    })();
    this.checking = check;
    void check.finally(() => {
      if (this.checking === check) this.checking = undefined;
      if (this.checkAgain) {
        this.checkAgain = false;
        void this.checkCancellation();
      }
    });
    return check;
  }
  private kick() {
    if (this.closed) return;
    this.rerun = true;
    if (this.running) return;
    // Observe background errors without converting the owned operation into a
    // successful promise: close() must still receive real teardown failures.
    const task = this.run();
    this.task = task;
    const settled = () => {
      if (this.task === task) this.task = undefined;
    };
    void task.then(settled, (error) => {
      settled();
      this.report(error);
    });
  }
  private async run() {
    if (this.running || this.closed) return;
    this.running = true;
    this.rerun = false;
    const batch = new AbortController();
    this.batch = batch;
    const drain = async () => {
      try {
        batch.signal.throwIfAborted();
        for (;;) {
          if (this.closed) break;
          this.rerun = false;
          // A queued record is account-shared, but its plain File may
          // exist only in the workspace that admitted it. Do not drain
          // another tab's jobs with this workspace's source resolver.
          const admitted = new Map(this.admitted);
          const jobs = new Map((await this.jobs()).map((job) => [job.id, job]));
          let candidate: Job | undefined;
          for (const [id, token] of admitted) {
            if (this.admitted.get(id) !== token) continue;
            if (token.isCurrent && !token.isCurrent()) {
              this.admitted.delete(id);
              continue;
            }
            const job = jobs.get(id);
            if (job?.status === 'queued') {
              // A video being watched should start before queued batch work.
              // The latest sparse request wins when the viewer changes videos.
              if (
                !candidate ||
                (job.sparse && (!candidate.sparse || job.createdAt >= candidate.createdAt))
              )
                candidate = job;
            } else this.admitted.delete(id);
          }
          if (this.closed || !candidate) break;
          // Remove before running so a later explicit resume/enqueue
          // can independently admit the same id during completion.
          const admission = this.admitted.get(candidate.id)!;
          this.admitted.delete(candidate.id);
          const controller = new AbortController(),
            ownerId = crypto.randomUUID();
          this.active = { id: candidate.id, ownerId, controller, admission };
          const signal = controller.signal;
          const work = async () => {
            signal.throwIfAborted();
            const claimed = await this.store.updateLocal<Job>(
              this.scope,
              'jobs',
              candidate.id,
              (old) => {
                if (!old) return old;
                const job = validateJob(old);
                if (job.id !== candidate.id) throw new Error('Wrong saved job identity');
                if (job.status !== 'queued' || (admission.isCurrent && !admission.isCurrent()))
                  return old;
                signal.throwIfAborted();
                return {
                  ...job,
                  status: 'running',
                  ownerId,
                  leaseUntil: Date.now() + JOB_LEASE_MS,
                  cancelRequested: false
                };
              }
            );
            if (!claimed || !ownsJob(claimed, ownerId)) return;
            let job = claimed;
            let renewal: Promise<void> | undefined;
            const heartbeat = setInterval(() => {
              if (renewal || signal.aborted) return;
              renewal = this.store
                .updateLocal<Job>(this.scope, 'jobs', job.id, (old) => {
                  signal.throwIfAborted();
                  if (!ownsJob(old, ownerId)) throw new JobOwnershipLost();
                  return { ...old!, leaseUntil: Date.now() + JOB_LEASE_MS };
                })
                .then(
                  () => {},
                  (e) => controller.abort(e)
                )
                .finally(() => {
                  renewal = undefined;
                });
            }, 15000);
            const checkpoint = async () => {
              signal.throwIfAborted();
              const snapshot = validateJob(job);
              if (snapshot.sparse) assertSparseRepairTiming(snapshot.sparse);
              const saved = await this.store.updateLocal<Job>(this.scope, 'jobs', job.id, (old) => {
                if (!ownsJob(old, ownerId)) throw new JobOwnershipLost();
                signal.throwIfAborted();
                return {
                  ...snapshot,
                  ...(old!.verifiedMediaKey ? { verifiedMediaKey: old!.verifiedMediaKey } : {}),
                  ...(snapshot.sparse
                    ? {
                        sparse: {
                          ...snapshot.sparse,
                          targetSeconds: Math.min(
                            snapshot.duration,
                            this.targets.get(snapshot.id) ?? snapshot.sparse.targetSeconds
                          )
                        }
                      }
                    : {}),
                  leaseUntil: Date.now() + JOB_LEASE_MS
                };
              });
              job = saved!;
            };
            try {
              this.compatible(job);
              const hasWork =
                job.version === 1
                  ? job.nextWindow < planWindows(job.duration).length
                  : job.version === 2
                    ? job.progressive!.windows.at(-1)?.coreEndSample !==
                      Math.ceil(job.duration * 16000)
                    : job.nextWindow < job.sparse!.windows.length ||
                      pendingSparseSeam(job.sparse!) !== undefined;
              if (job.engineRevision !== MOSS.engineRevision && hasWork) {
                job = {
                  ...job,
                  engineRevision: continuedRuntime(job.engineRevision, job.nextWindow > 0)
                };
                await checkpoint();
              }
              const windows = job.version === 1 ? planWindows(job.duration) : [];
              if (job.version === 2) {
                job = await transcribeProgressively(job, {
                  engine: this.engine,
                  decode: this.decode,
                  signal,
                  checkpoint: async (next) => {
                    job = next;
                    await checkpoint();
                    return job;
                  },
                  notify: (p) => this.notify(p)
                });
              }
              if (job.version === 3) {
                assertSparseRepairTiming(job.sparse!);
                const repairSparseSeam = async (seam: number) => {
                  signal.throwIfAborted();
                  if (job.sparse!.repairs[seam])
                    throw new Error(
                      'An adjacent repaired seam remains ambiguous; saved hypotheses were kept.'
                    );
                  const first = sparseBounds(seam, job.duration);
                  const second = sparseBounds(seam + 1, job.duration);
                  if (second.end - first.start > 60)
                    throw new Error(
                      'A transcript seam exceeds the safe repair input; saved hypotheses were kept.'
                    );
                  this.notify({
                    job,
                    stage: 'repairing',
                    loaded: sparseCoverage(job.sparse!, job.duration),
                    total: job.duration
                  });
                  const decoded = await this.decode(job, first.start, second.end, signal);
                  signal.throwIfAborted();
                  const pcm = sparseModelPcm(decoded, first.start, second.end, 60);
                  const proof = job.audioProofs
                    ? await audioProofAsync(first.start, second.end, pcm, signal)
                    : undefined;
                  const inputDuration = pcm.length / 16000;
                  const exactSilence = pcm.every((sample) => sample === 0);
                  if (!exactSilence)
                    await this.engine.prepare(signal, (p) => this.notify({ job, ...p }));
                  const raw = exactSilence
                    ? ''
                    : await transcribeWithPreview(this.engine, pcm, signal);
                  const hypothesis = parseMoss(raw, inputDuration).map((cue, n) => ({
                    ...cue,
                    id: `w${seam}/repair-${n}`,
                    start: cue.start + first.start,
                    end: cue.end + first.start,
                    ...(cue.speaker ? { speaker: `w${seam}/${cue.speaker}` } : {})
                  }));
                  if (
                    !hypothesis.length &&
                    (job.sparse!.windows[seam]!.cues.length ||
                      job.sparse!.windows[seam + 1]!.cues.length)
                  )
                    throw new Error(
                      'Seam repair returned no speech while the original windows contain speech; saved hypotheses were kept.'
                    );
                  // Equivalent whole-cue resegmentation may preserve the accepted
                  // originals; different speech or ambiguous repeated matches may not.
                  const repair = retainAcceptedRepair(
                    job.cues,
                    hypothesis,
                    first.start,
                    second.end
                  );
                  if (!repair)
                    throw new Error(
                      'Seam repair conflicts with an accepted caption; saved hypotheses were kept.'
                    );
                  const next = { ...job.sparse!, repairs: [...job.sparse!.repairs] };
                  next.repairs[seam] = repair;
                  let safe = acceptedSparseCues(next, job.duration);
                  // A whole cue accepted across the repair input's outer edge
                  // cannot be reproduced from this input alone. Retain its
                  // matching saved partial hypothesis when the new result left
                  // that interval empty; conflicting new speech still fails.
                  const original = [
                    ...job.sparse!.windows[seam]!.cues,
                    ...job.sparse!.windows[seam + 1]!.cues
                  ];
                  for (const accepted of missingAccepted(job.cues, safe)) {
                    if (!missingAccepted([accepted], safe).length) continue;
                    if (
                      !(
                        (accepted.start < first.start && accepted.end > first.start) ||
                        (accepted.start < second.end && accepted.end > second.end)
                      )
                    )
                      break;
                    const candidates = original.filter(
                      (cue) =>
                        cue.start >= first.start &&
                        cue.end <= second.end &&
                        cue.text === accepted.text &&
                        Math.abs(cue.start - Math.max(first.start, accepted.start)) <= 0.35 &&
                        Math.abs(cue.end - Math.min(second.end, accepted.end)) <= 0.35
                    );
                    if (
                      candidates.length !== 1 ||
                      repair.some(
                        (cue) => cue.start < candidates[0].end && cue.end > candidates[0].start
                      )
                    )
                      break;
                    repair.push(candidates[0]);
                    repair.sort((a, b) => a.start - b.start || a.end - b.end);
                    safe = acceptedSparseCues(next, job.duration);
                  }
                  preserveAccepted(job.cues, safe);
                  job = {
                    ...job,
                    sparse: next,
                    cues: safe,
                    ...(proof ? { audioProofs: [...job.audioProofs!, proof] } : {})
                  };
                  await checkpoint();
                };
                const settleSparseSeams = async () => {
                  const pending = () =>
                    pendingSparseSeam(
                      job.sparse!,
                      this.targets.get(job.id) ?? job.sparse!.targetSeconds
                    );
                  let seam = pending();
                  while (seam !== undefined) {
                    await repairSparseSeam(seam);
                    seam = pending();
                  }
                };
                await settleSparseSeams();
                while (job.nextWindow < job.sparse!.windows.length) {
                  signal.throwIfAborted();
                  const target = this.targets.get(job.id) ?? job.sparse!.targetSeconds;
                  const state = { ...job.sparse!, targetSeconds: Math.min(job.duration, target) };
                  const index = nextSparseWindow(state);
                  if (index < 0) break;
                  const bounds = sparseBounds(index, job.duration);
                  this.notify({
                    job,
                    stage: 'decoding',
                    loaded: sparseCoverage(state, job.duration),
                    total: job.duration
                  });
                  const decodeStarted = performance.now();
                  const decoded = await this.decode(job, bounds.start, bounds.end, signal);
                  signal.throwIfAborted();
                  const pcm = sparseModelPcm(decoded, bounds.start, bounds.end, 30);
                  const proof = job.audioProofs
                    ? await audioProofAsync(bounds.start, bounds.end, pcm, signal)
                    : undefined;
                  const inputDuration = pcm.length / 16000;
                  let raw = '';
                  let inferenceMs = performance.now() - decodeStarted;
                  if (!pcm.every((sample) => sample === 0)) {
                    await this.engine.prepare(signal, (p) => this.notify({ job, ...p }));
                    const inferenceStarted = performance.now();
                    raw = await transcribeWithPreview(this.engine, pcm, signal, (text) => {
                      const provisional = ownedCues(parseMossPreview(text, inputDuration), {
                        index,
                        ...bounds
                      });
                      this.notify({
                        job,
                        stage: 'transcribing',
                        loaded: sparseCoverage(state, job.duration),
                        total: job.duration,
                        provisional
                      });
                    });
                    inferenceMs += performance.now() - inferenceStarted;
                  }
                  signal.throwIfAborted();
                  const cues = parseMoss(raw, inputDuration).map((cue, n) => ({
                    ...cue,
                    id: `w${index}/cue-${n}`,
                    start: cue.start + bounds.start,
                    end: cue.end + bounds.start,
                    ...(cue.speaker ? { speaker: `w${index}/${cue.speaker}` } : {})
                  }));
                  const next = { ...state, windows: [...state.windows] };
                  next.windows[index] = { cues, inferenceMs };
                  const safe = acceptedSparseCues(next, job.duration);
                  preserveAccepted(job.cues, safe);
                  job = {
                    ...job,
                    sparse: next,
                    nextWindow: job.nextWindow + 1,
                    cues: safe,
                    ...(proof ? { audioProofs: [...job.audioProofs!, proof] } : {})
                  };
                  await checkpoint();
                  this.notify({
                    job,
                    stage: 'transcribing',
                    loaded: sparseCoverage(next, job.duration),
                    total: job.duration
                  });
                  await settleSparseSeams();
                }
                let assembled = assembleSparse(job.sparse!);
                while (assembled.repair !== undefined) {
                  await repairSparseSeam(assembled.repair);
                  assembled = assembleSparse(job.sparse!);
                }
                if (!assembled.cues)
                  throw new Error('Sparse transcription did not cover the complete video');
                preserveAccepted(job.cues, assembled.cues);
                job = { ...job, cues: assembled.cues };
              }
              for (let i = job.nextWindow; i < windows.length; i++) {
                signal.throwIfAborted();
                const w = windows[i];
                this.notify({ job, stage: 'decoding', loaded: i, total: windows.length });
                const pcm = await this.decode(job, w.start, w.end, signal);
                signal.throwIfAborted();
                if (
                  !(pcm instanceof Float32Array) ||
                  !pcm.length ||
                  pcm.length > 16000 * 64 ||
                  !pcm.every(Number.isFinite)
                )
                  throw new Error('Invalid decoded audio window');
                this.notify({ job, stage: 'transcribing', loaded: i, total: windows.length });
                // Resolve/validate audio BEFORE downloading hundreds of MB of
                // weights. Exact silence needs no recognizer, not even preparation.
                // prepare() reuses the same live instance for the current batch.
                let raw = '';
                if (!pcm.every((x) => x === 0)) {
                  await this.engine.prepare(signal, (p) => this.notify({ job, ...p }));
                  signal.throwIfAborted();
                  raw = await transcribeWithPreview(this.engine, pcm, signal, (text) => {
                    this.notify({
                      job,
                      stage: 'transcribing',
                      loaded: i,
                      total: windows.length,
                      provisional: ownedCues(parseMossPreview(text, w.end - w.start), w)
                    });
                  });
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
              if (job.provisional && !job.verifiedMediaKey) throw new AwaitVerifiedIdentity();
              const track: Track = {
                version: 1,
                id: job.id,
                mediaKey: jobContentKey(job),
                language: job.language,
                kind: 'transcription',
                origin: 'generated',
                label: `${job.language} · MOSS 0.9B`,
                cues: job.cues,
                complete: true,
                forced: false,
                createdAt: job.createdAt,
                provenance: {
                  engine:
                    job.version === 3
                      ? `moss-transcribe.cpp/${job.sparse!.policy}`
                      : job.version === 2
                        ? `moss-transcribe.cpp/${job.progressive!.policy}`
                        : 'moss-transcribe.cpp',
                  engineRevision: job.engineRevision,
                  model: MOSS.model,
                  modelRevision: MOSS.revision,
                  modelSha256: job.modelSha256,
                  quantization: MOSS.quantization,
                  audioTrack: job.audioTrack,
                  windowSeconds: job.sparse ? 30 : (job.progressive?.inputSeconds ?? 60),
                  overlapSeconds: 2,
                  generatedAt: job.completedAt!
                }
              };
              const completed = releasedJob(job, 'complete');
              delete completed.error;
              signal.throwIfAborted();
              await this.store.saveTrack(this.scope, track, { ownerId, job: completed, signal });
              job = completed;
              this.notify({
                job,
                stage: 'complete',
                loaded: job.duration,
                total: job.duration
              });
            } catch (e) {
              const awaitingIdentity = e instanceof AwaitVerifiedIdentity;
              const paused = signal.aborted || e instanceof JobOwnershipLost || awaitingIdentity;
              const latest = await this.store.updateLocal<Job>(
                this.scope,
                'jobs',
                job.id,
                (old) => {
                  // Never replace a successor owner or its completed result with a stale error.
                  if (!old || old.ownerId !== ownerId || old.status !== 'running') return old;
                  const next = releasedJob(validateJob(old), paused ? 'paused' : 'failed');
                  if (awaitingIdentity) {
                    // Verification is not a newer playback intent. A Cancel or
                    // video switch committed while this catch was pending wins.
                    next.pauseReason ??= 'identity';
                    delete next.error;
                  } else
                    next.error =
                      (e instanceof Error ? e.message : String(e)).slice(0, 2048) ||
                      'Transcription failed';
                  return next;
                }
              );
              if (latest && latest.status !== 'complete')
                this.notify({
                  job: latest,
                  stage: latest.status,
                  loaded: latest.sparse
                    ? sparseCoverage(latest.sparse, latest.duration)
                    : latest.progressive
                      ? (latest.progressive.windows.at(-1)?.coreEndSample ?? 0) / 16000
                      : latest.nextWindow,
                  total:
                    latest.sparse || latest.progressive
                      ? latest.duration
                      : planWindows(latest.duration).length
                });
            } finally {
              clearInterval(heartbeat);
              // Clearing the timer does not settle a transaction already admitted
              // by its callback. Keep it inside this job and the origin lock.
              await renewal;
            }
          };
          try {
            await work();
          } catch (e) {
            if (!signal.aborted || e !== signal.reason) throw e;
          } finally {
            this.targets.delete(candidate.id);
            this.active = undefined;
          }
        }
      } finally {
        // Keep the lease through shutdown of weights AND the pthread workers.
        // Successive queued files share a warm model; idle tabs do not retain it.
        await this.engine.dispose();
      }
    };
    try {
      if (typeof navigator.locks?.request === 'function') {
        let acquired = false;
        const waiting = setTimeout(() => {
          void this.jobs()
            .then((jobs) => {
              if (acquired || this.closed || batch.signal.aborted) return;
              const pending = jobs.find(
                (job) => job.status === 'queued' && this.admitted.has(job.id)
              );
              if (pending)
                this.notify({
                  job: pending,
                  stage: 'waiting-for-tab',
                  loaded: pending.sparse
                    ? sparseCoverage(pending.sparse, pending.duration)
                    : pending.nextWindow,
                  total: pending.sparse ? pending.duration : planWindows(pending.duration).length
                });
            })
            .catch((error) => this.report(error));
        }, 10_000);
        try {
          this.lockWait = batch;
          await navigator.locks.request(
            'manabi-moss-inference',
            { signal: batch.signal },
            async () => {
              if (this.lockWait === batch) this.lockWait = undefined;
              acquired = true;
              clearTimeout(waiting);
              await drain();
            }
          );
        } finally {
          if (this.lockWait === batch) this.lockWait = undefined;
          clearTimeout(waiting);
        }
      } else {
        this.requireOriginLock();
        await drain(); // Node-only test harnesses inject no browser Window.
      }
    } catch (error) {
      // Only the actual cancellation reason is expected. An aborted signal
      // does not turn a failed checkpoint or runtime retirement into success.
      if (!batch.signal.aborted || error !== batch.signal.reason) throw error;
    } finally {
      if (this.batch === batch) this.batch = undefined;
      this.running = false;
      if (this.rerun && !this.closed) this.kick();
    }
  }
  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.stopStore?.();
    this.admitted.clear();
    const reason = new DOMException('Video workspace closed', 'AbortError');
    this.batch?.abort(reason); // Also cancels a lock request before any job is claimed.
    this.active?.controller.abort(reason);
    // The draining batch is the sole runtime-retirement owner. It awaits
    // engine.dispose() before releasing the origin Web Lock. Calling dispose
    // again here would impose an undocumented idempotency requirement on Engine.
    this.closing = Promise.allSettled([this.task, this.checking, this.recovering]).then(
      (results) => {
        // A teardown error must not let the owner close storage while the
        // active job is still publishing its pause/checkpoint transaction.
        const failures = results
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map((r) => r.reason);
        if (failures.length)
          throw new AggregateError(failures, 'Transcription queue shutdown failed');
      }
    );
    return this.closing;
  }
}
