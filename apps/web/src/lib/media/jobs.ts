/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  record,
  onlyKeys,
  isUUID,
  isContentKey,
  isDigest,
  finite,
  string,
  language,
  validateCue,
  type ContentKey,
  type Cue
} from './contracts.js';
import { planWindows } from './moss-output.js';
import {
  SPARSE_CORE_SECONDS,
  assembleSparse,
  acceptedSparseCues,
  sparseBounds,
  pendingSparseSeam,
  sparseCoverage,
  validateSparseState,
  type SparseState
} from './sparse-transcription.js';
import { legacySparseCues, legacyAssembleSparse } from './sparse-legacy.js';
import {
  coreEnd,
  durationSamples,
  cueBelongsToWindow,
  pendingSeamRepair,
  validateProgressiveState,
  type ProgressiveState
} from './moss-progressive.js';

/** Device-only jobs. Never included in the personal account feed. */
export interface Job {
  version: 1 | 2 | 3;
  progressive?: ProgressiveState;
  sparse?: SparseState;
  id: string;
  mediaKey: ContentKey;
  language: string;
  audioTrack: string;
  duration: number;
  status: 'queued' | 'running' | 'paused' | 'failed' | 'complete';
  nextWindow: number;
  cues: Cue[];
  modelSha256: string;
  engineRevision: string;
  createdAt: number;
  completedAt?: number;
  error?: string;
  ownerId?: string;
  leaseUntil?: number;
  cancelRequested?: boolean;
  /** Why a running job was paused; only a video switch may resume automatically. */
  pauseReason?: 'switch' | 'user';
}
export const JOB_LEASE_MS = 90_000;

/** Whether repeating Resume can make progress without changing transcription policy. */
export function jobCanResume(job: Job): boolean {
  if (job.status !== 'paused' && job.status !== 'failed') return false;
  if (job.sparse) {
    const seam = pendingSparseSeam(job.sparse);
    if (
      seam !== undefined &&
      (job.sparse.repairs[seam] ||
        sparseBounds(seam + 1, job.duration).end - sparseBounds(seam, job.duration).start > 60)
    )
      return false;
  }
  const repair = job.progressive && pendingSeamRepair(job.progressive);
  return !repair || repair.retryable;
}

export function validateJob(value: unknown): Job {
  const j = record(value);
  onlyKeys(j, [
    'version',
    'id',
    'mediaKey',
    'language',
    'audioTrack',
    'duration',
    'status',
    'nextWindow',
    'cues',
    'modelSha256',
    'engineRevision',
    'createdAt',
    'completedAt',
    'error',
    'ownerId',
    'leaseUntil',
    'cancelRequested',
    'pauseReason',
    'progressive',
    'sparse'
  ]);
  if (
    (j.version !== 1 && j.version !== 2 && j.version !== 3) ||
    !isUUID(j.id) ||
    !isContentKey(j.mediaKey) ||
    !isDigest(j.modelSha256) ||
    typeof j.status !== 'string' ||
    !['queued', 'running', 'paused', 'failed', 'complete'].includes(j.status) ||
    !Array.isArray(j.cues) ||
    j.cues.length > 50_000
  )
    throw new Error('Invalid saved transcription job');
  const duration = finite(j.duration, 0, 604800);
  if (duration <= 0) throw new Error('Invalid saved duration');
  const progressive =
    j.version === 2
      ? validateProgressiveState(j.progressive, duration, j.nextWindow as number)
      : undefined;
  const compactSparse =
    j.version === 3 &&
    j.status === 'complete' &&
    j.sparse === undefined &&
    Array.isArray(j.cues) &&
    j.cues.length === 0;
  const sparse =
    j.version === 3 && !compactSparse ? validateSparseState(j.sparse, duration) : undefined;
  if (j.version === 1 && j.progressive !== undefined)
    throw new Error('Legacy job cannot change its window policy');
  if (
    (j.version !== 3 && j.sparse !== undefined) ||
    (j.version === 3 && j.progressive !== undefined)
  )
    throw new Error('Job window policies cannot be mixed');
  const windowCount = compactSparse
    ? Math.ceil(duration / SPARSE_CORE_SECONDS)
    : sparse
      ? sparse.windows.length
      : progressive
        ? progressive.windows.length
        : planWindows(duration).length;
  const completedWindows = sparse?.windows.filter(Boolean).length;
  if (
    !Number.isSafeInteger(j.nextWindow) ||
    (j.nextWindow as number) < 0 ||
    (j.nextWindow as number) > windowCount ||
    (sparse && j.nextWindow !== completedWindows) ||
    (j.status === 'complete' &&
      (j.nextWindow !== windowCount ||
        (sparse && sparseCoverage(sparse, duration) < duration - 0.001) ||
        (progressive &&
          (coreEnd(progressive) !== durationSamples(duration) || progressive.failedSeam))))
  )
    throw new Error('Invalid saved transcription checkpoint');
  const audioTrack = string(j.audioTrack, 128);
  if (!/^\d{1,10}$/.test(audioTrack) || !Number.isSafeInteger(Number(audioTrack)))
    throw new Error('Invalid saved audio track');
  let cues = j.cues.map(validateCue);
  let completedAt =
    j.completedAt === undefined ? undefined : finite(j.completedAt, 0, Number.MAX_SAFE_INTEGER);
  const nextWindow = j.nextWindow as number;
  if (sparse) {
    const safe = acceptedSparseCues(sparse, duration);
    const matches = (expected: Cue[]) =>
      cues.length === expected.length &&
      cues.every((cue, index) => {
        const other = expected[index];
        return (
          cue.id === other.id &&
          cue.start === other.start &&
          cue.end === other.end &&
          cue.text === other.text &&
          cue.speaker === other.speaker
        );
      });
    // Final cues are checkpointed while the lease is still running, before the
    // atomic track publication changes the job status to complete.
    const finalizing = j.status === 'complete' || completedAt !== undefined;
    if (!finalizing && !matches(safe)) {
      if (
        sparse.policy !== 'overlap-sparse-v1' ||
        (!matches(legacySparseCues(sparse, duration)) &&
          !matches(legacySparseCues(sparse, duration, false)) &&
          !matches(legacySparseCues(sparse, duration, true, true)))
      )
        throw new Error('Sparse draft does not match saved coverage');
      cues = safe; // Upgrade only the verified derived cache, never the hypotheses.
    }
    // Published jobs are compacted to an empty cue summary by MediaStore.
    if (finalizing) {
      const assembled = assembleSparse(sparse).cues;
      if (!assembled || !matches(assembled)) {
        const legacy = [legacyAssembleSparse(sparse), legacyAssembleSparse(sparse, true)];
        if (j.status === 'complete' || !legacy.some((prior) => prior && matches(prior)))
          throw new Error('Completed sparse captions do not match saved hypotheses');
        // A previously unpublished cache may have admitted a one-sided seam.
        // Keep all inference inputs and return that seam to repair, not completion.
        cues = assembled ?? safe;
        if (!assembled) completedAt = undefined;
      }
    }
  }
  if (
    cues.length > 50_000 ||
    new Set(cues.map((c) => c.id)).size !== cues.length ||
    (!sparse &&
      cues.some((c) => {
        const match = /^w(\d+)\//.exec(c.id);
        return !match || Number(match[1]) >= nextWindow || c.end > duration + 0.001;
      }))
  )
    throw new Error('Caption does not belong to a completed transcription window');
  if (progressive) {
    const accepted = new Set(cues.map((cue) => cue.id));
    if (progressive.tail.some((cue) => accepted.has(cue.id)))
      throw new Error('Unsettled cues cannot also be accepted');
    const window = progressive.windows.at(-1);
    const cutoff =
      window && window.coreEndSample < durationSamples(duration)
        ? (window.coreEndSample - 32000) / 16000
        : duration + 1 / 16000;
    if (window && cues.some((cue) => cue.end > cutoff!))
      throw new Error('Accepted captions cross the unsettled boundary');
  }
  if (progressive && cues.some((cue) => !cueBelongsToWindow(cue, progressive.windows)))
    throw new Error('Caption lies outside its recorded recognition window');
  if (new TextEncoder().encode(JSON.stringify(j)).length > 16 * 1024 * 1024)
    throw new Error('Saved transcription is too large');
  if (j.ownerId !== undefined && !isUUID(j.ownerId)) throw new Error('Invalid job owner');
  if ((j.ownerId === undefined) !== (j.leaseUntil === undefined))
    throw new Error('Invalid job lease');
  if (j.cancelRequested !== undefined && typeof j.cancelRequested !== 'boolean')
    throw new Error('Invalid cancellation request');
  if (j.pauseReason !== undefined && j.pauseReason !== 'switch' && j.pauseReason !== 'user')
    throw new Error('Invalid transcription pause reason');
  if (j.pauseReason !== undefined && j.status !== 'running' && j.status !== 'paused')
    throw new Error('Pause reason requires a running or paused transcription');
  return {
    version: j.version as 1 | 2 | 3,
    ...(progressive ? { progressive } : {}),
    ...(sparse ? { sparse } : {}),
    id: j.id,
    mediaKey: j.mediaKey,
    language: language(j.language),
    audioTrack,
    duration,
    status: j.status as Job['status'],
    nextWindow,
    cues,
    modelSha256: j.modelSha256,
    engineRevision: string(j.engineRevision, 128),
    createdAt: finite(j.createdAt, 0, Number.MAX_SAFE_INTEGER),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(j.error === undefined ? {} : { error: string(j.error, 2048) }),
    ...(j.ownerId === undefined
      ? {}
      : {
          ownerId: j.ownerId as string,
          leaseUntil: finite(j.leaseUntil, 0, Number.MAX_SAFE_INTEGER)
        }),
    ...(j.cancelRequested === undefined ? {} : { cancelRequested: j.cancelRequested as boolean }),
    ...(j.pauseReason === undefined ? {} : { pauseReason: j.pauseReason as 'switch' | 'user' })
  };
}
export class JobOwnershipLost extends Error {
  constructor() {
    super('This transcription was cancelled or taken over by another tab.');
    this.name = 'JobOwnershipLost';
  }
}
export function ownsJob(job: Job | undefined, ownerId: string) {
  return !!job && job.status === 'running' && job.ownerId === ownerId && !job.cancelRequested;
}
export function releasedJob(job: Job, status: Job['status']): Job {
  const {
    ownerId: _owner,
    leaseUntil: _lease,
    cancelRequested: _cancel,
    pauseReason: _reason,
    ...rest
  } = job;
  return {
    ...rest,
    status,
    ...(status === 'paused' && job.pauseReason ? { pauseReason: job.pauseReason } : {})
  };
}
