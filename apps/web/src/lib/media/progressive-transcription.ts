/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Cue } from './contracts.js';
import type { Job } from './jobs.js';
import type { Engine, QueueProgress } from './queue.js';
import { parseMoss, parseMossPreview } from './moss-output.js';
import { transcribeWithPreview } from './moss-preview.js';
import {
  SAMPLE_RATE,
  absoluteCues,
  chooseWindow,
  coreEnd,
  durationSamples,
  inputStart,
  inputEnd,
  joinBoundary,
  pendingSeamRepair,
  repairedSuffix,
  splitSettled,
  type ProgressiveWindow
} from './moss-progressive.js';

type Decode = (job: Job, start: number, end: number, signal: AbortSignal) => Promise<Float32Array>;

/** A small rolling lookahead cache; no whole-file decode, concatenation of VAD regions, or
 * retained model input buffers. The recognizer may transfer/detach every returned buffer.
 */
class RollingAudio {
  private cached?: { start: number; end: number; pcm: Float32Array };
  constructor(
    private decode: Decode,
    private signal: AbortSignal
  ) {}
  async read(job: Job, start: number, end: number): Promise<Float32Array> {
    this.signal.throwIfAborted();
    const out = new Float32Array(end - start);
    const cached = this.cached;
    let copied = 0;
    if (cached && start >= cached.start && start < cached.end) {
      copied = Math.min(end, cached.end) - start;
      out.set(cached.pcm.subarray(start - cached.start, start - cached.start + copied));
    }
    if (start + copied < end) {
      const pcm = await this.decode(
        job,
        (start + copied) / SAMPLE_RATE,
        end / SAMPLE_RATE,
        this.signal
      );
      this.signal.throwIfAborted();
      const expected = end - start - copied;
      // Web Audio's ceil(seconds * rate) can add one sample through binary rounding.
      if (
        !(pcm instanceof Float32Array) ||
        pcm.length < expected ||
        pcm.length > expected + 1 ||
        !pcm.every(Number.isFinite)
      )
        throw new Error('Decoded audio does not match its requested interval');
      out.set(pcm.subarray(0, expected), copied);
    }
    const keep = Math.min(8 * SAMPLE_RATE, out.length);
    this.cached = { start: end - keep, end, pcm: out.slice(-keep) };
    return out;
  }
}

export async function transcribeProgressively(
  initial: Job,
  options: {
    engine: Engine;
    decode: Decode;
    signal: AbortSignal;
    checkpoint(job: Job): Promise<Job>;
    notify(progress: QueueProgress): void;
  }
): Promise<Job> {
  let job = initial;
  if (job.version !== 2 || !job.progressive) throw new Error('A progressive job is required');
  const { engine, signal, notify, checkpoint } = options;
  const audio = new RollingAudio(options.decode, signal);
  const progress = (stage: string, provisional?: Cue[]) =>
    notify({
      job,
      stage,
      loaded: coreEnd(job.progressive!) / SAMPLE_RATE,
      total: job.duration,
      ...(provisional ? { provisional } : {})
    });
  const recognize = async (
    pcm: Float32Array,
    w: ProgressiveWindow,
    start = w.startSample,
    preview = true
  ) => {
    signal.throwIfAborted();
    // Only exact digital silence bypasses inference. Quiet audio is never discarded.
    if (pcm.every((x) => x === 0)) return [];
    await engine.prepare(signal, (p) => notify({ job, ...p }));
    signal.throwIfAborted();
    const duration = pcm.length / SAMPLE_RATE;
    const raw = await transcribeWithPreview(
      engine,
      pcm,
      signal,
      preview
        ? (text) => {
            const cues = absoluteCues(
              parseMossPreview(text, duration),
              w,
              start === w.startSample ? undefined : start
            );
            progress('transcribing', cues);
          }
        : undefined
    );
    signal.throwIfAborted();
    return absoluteCues(parseMoss(raw, duration), w, start === w.startSample ? undefined : start);
  };

  while (coreEnd(job.progressive!) < durationSamples(job.duration)) {
    signal.throwIfAborted();
    const state = job.progressive!;
    let boundaryTail = state.tail;
    let hypothesis = state.failedSeam;
    if (!hypothesis) {
      progress('decoding');
      const pcm = await audio.read(job, inputStart(state), inputEnd(state, job.duration));
      const window = chooseWindow(state, job.duration, pcm);
      const modelPcm = pcm.slice(0, window.endSample - window.startSample);
      // Capture silence evidence before the engine may transfer/detach modelPcm.
      const exactSilence = modelPcm.every((sample) => sample === 0);
      progress('transcribing');
      hypothesis = {
        window,
        cues: await recognize(modelPcm, window)
      };
      // A wholly covered cue over verified digital-zero PCM is stronger evidence
      // than an earlier model tail hallucination. Keep a cue that began before
      // this input, because only its suffix is covered by the silent evidence.
      if (exactSilence && boundaryTail.length) {
        const coveredFrom = window.startSample / SAMPLE_RATE;
        boundaryTail = boundaryTail.filter((cue) => cue.start < coveredFrom);
      }
    }
    let window = hypothesis.window;
    let combined = state.windows.length
      ? joinBoundary(boundaryTail, hypothesis.cues, window.coreStartSample / SAMPLE_RATE)
      : hypothesis.cues;
    if (!combined) {
      // Persist both interpretations BEFORE the optional repair. A crash/cancel resumes here.
      job = await checkpoint({ ...job, progressive: { ...state, failedSeam: hypothesis } });
      progress('repairing');
      const repairRange = pendingSeamRepair(job.progressive!);
      if (!repairRange) throw new Error('Saved transcript seam is missing its repair evidence');
      const { startSample: start, endSample: end } = repairRange;
      if (!repairRange.retryable) {
        throw new Error(
          'This boundary needs a different window policy. Accepted captions and both interpretations were kept; repeating Resume would reproduce the same oversized repair.'
        );
      }
      const repairCues = await recognize(await audio.read(job, start, end), window, start, false);
      combined = repairedSuffix(job.cues, repairCues, start / SAMPLE_RATE);
      if (!combined || (!combined.length && (state.tail.length || hypothesis.cues.length))) {
        throw new Error(
          'An ambiguous transcript boundary could not be joined safely. Accepted captions and both interpretations were kept; resume to retry.'
        );
      }
      window = { ...window, repairStartSample: start, repairEndSample: end };
    }
    const { settled, tail } = splitSettled(combined, window, job.duration);
    job = await checkpoint({
      ...job,
      nextWindow: window.index + 1,
      cues: [...job.cues, ...settled],
      progressive: {
        policy: state.policy,
        inputSeconds: state.inputSeconds,
        windows: [...state.windows, window],
        tail
      }
    });
    // An empty/silent completed interval advances coverage independently of the last cue.
    progress('transcribing');
  }
  return job;
}
