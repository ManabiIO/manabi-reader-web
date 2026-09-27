/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Cue, Track } from './contracts.js';
import { jobCanResume, type Job } from './jobs.js';
import { MOSS } from './model-cache.js';
import { coreEnd, SAMPLE_RATE } from './moss-progressive.js';
import { planWindows } from './moss-output.js';

/** Device-only view of a durable job. Never saved as a caption manifest or synced. */
export interface TranscriptionDraft {
  track: Track;
  coverage: number;
  duration: number;
  state: Job['status'];
  restartRequired: boolean;
  pending: Cue[];
}
export function transcriptionDraft(job: Job): TranscriptionDraft | undefined {
  const coverage = job.progressive
    ? Math.min(job.duration, coreEnd(job.progressive) / SAMPLE_RATE)
    : job.nextWindow
      ? planWindows(job.duration)[job.nextWindow - 1].coreEnd
      : 0;
  return {
    track: {
      version: 1,
      id: job.id,
      mediaKey: job.mediaKey,
      language: job.language,
      kind: 'transcription',
      origin: 'generated',
      label: `${job.language} · MOSS · In progress`,
      cues: job.cues,
      complete: false,
      forced: false,
      createdAt: job.createdAt,
      provenance: {
        engine: job.progressive
          ? `moss-transcribe.cpp/${job.progressive.policy}`
          : 'moss-transcribe.cpp',
        engineRevision: job.engineRevision,
        model: MOSS.model,
        modelRevision: MOSS.revision,
        modelSha256: job.modelSha256,
        quantization: MOSS.quantization,
        audioTrack: job.audioTrack,
        windowSeconds: job.progressive?.inputSeconds ?? 60,
        overlapSeconds: 2,
        generatedAt: job.createdAt
      }
    },
    coverage,
    duration: job.duration,
    state: job.status,
    restartRequired: job.status === 'failed' && !jobCanResume(job),
    pending: job.progressive?.tail ?? []
  };
}
