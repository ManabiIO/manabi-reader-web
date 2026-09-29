/** Deterministic CPU microbenchmark, not ASR inference or a device-wide speed claim.
 * node tools/media/benchmark-progressive.mjs --baseline /path/to/compiled/base [--output file.json]
 * The base directory must contain the media modules compiled at the reviewed base.
 */
import assert from 'node:assert/strict';
import { cpus, platform, arch } from 'node:os';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as current from '../../.cache/media-test-build/sparse-transcription.js';
import { cueDigest } from '../../.cache/media-test-build/captions.js';
import { audioProofAsync } from '../../.cache/media-test-build/audio-proof.js';
const args = process.argv.slice(2);
if (
  args[0] !== '--baseline' ||
  !args[1] ||
  (args.length !== 2 && (args.length !== 4 || args[2] !== '--output'))
)
  throw Error(
    'Usage: benchmark-progressive.mjs --baseline compiled-base-directory [--output file.json]'
  );
const load = (name) => import(pathToFileURL(resolve(args[1], name)).href);
const baseline = await load('sparse-transcription.js');
const { cueDigest: baseDigest } = await load('captions.js');
const { audioProof: baseProof } = await load('audio-proof.js');
const rounds = 15,
  ticks = 20;
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    samplesMs: values
  };
};
function stateFor(duration) {
  const state = current.newSparseState(duration);
  for (let i = 0; i < state.windows.length - 1; i++) {
    const { start, end } = current.sparseBounds(i, duration),
      cues = [];
    for (let t = Math.ceil(start / 3) * 3; t + 0.9 <= end; t += 3)
      cues.push({
        id: `w${i}/cue-${t}`,
        start: t,
        end: t + 0.9,
        text: `これは字幕${t}の文章です。`,
        speaker: `w${i}/S01`
      });
    state.windows[i] = { cues, inferenceMs: 36000 };
  }
  return state;
}
const result = {
  node: process.version,
  platform: platform(),
  arch: arch(),
  cpu: cpus()[0]?.model,
  rounds,
  ticksPerNotification: ticks,
  notes:
    'Synthetic caption/PCM microbenchmarks. No model inference. Interleaved order; snapshot construction and draft digest included in notification+ticks workload.',
  playback: [],
  audioProof: []
};
for (const duration of [1800, 7200]) {
  const state = stateFor(duration),
    draft = current.safeSparseCues(state, duration);
  const oldQuery = (position) => {
    const lead = baseline.sparseLead(state, duration, position);
    const samples = state.windows.flatMap((w, i) =>
      w ? [{ ms: w.inferenceMs, ...baseline.sparseBounds(i, duration) }] : []
    );
    return {
      lead,
      count: samples.length,
      totalMs: samples.reduce((s, w) => s + w.ms, 0),
      inputSeconds: samples.reduce((s, w) => s + (w.end - w.start), 0),
      coreSeconds: samples.reduce((s, w) => s + (w.coreEnd - w.coreStart), 0),
      missing: baseline.sparseMissingWindowsForLead(state, duration, position, 22),
      waiting: baseDigest(draft) !== baseDigest(baseline.safeSparseCues(state, duration))
    };
  };
  const prepare = () => ({
    snapshot: current.sparsePlaybackSnapshot(state, duration),
    digest: cueDigest(draft)
  });
  const newQuery = ({ snapshot: s, digest }, position) => ({
    lead: s.lead(position),
    count: s.count,
    totalMs: s.totalMs,
    inputSeconds: s.inputSeconds,
    coreSeconds: s.coreSeconds,
    missing: s.missingWindows(position, 22),
    waiting: digest !== s.cueDigest
  });
  const prepared = prepare();
  for (const pos of [0, 24, 28, 500, duration - 30])
    assert.deepEqual(newQuery(prepared, pos), oldQuery(pos));
  // Compare a progress/draft notification followed by 20 playback updates. Both
  // versions return equivalent observable readiness/ETA inputs at every step.
  const jobs = {
    baseline: () => {
      for (let i = 0; i <= ticks; i++) oldQuery(500 + i / 4);
    },
    current: () => {
      const ready = prepare();
      for (let i = 0; i <= ticks; i++) newQuery(ready, 500 + i / 4);
    }
  };
  jobs.baseline();
  jobs.current();
  const timing = { baseline: [], current: [] };
  for (let n = 0; n < rounds; n++)
    for (const name of n % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
      const t = performance.now();
      jobs[name]();
      timing[name].push(performance.now() - t);
    }
  result.playback.push({
    durationSeconds: duration,
    cues: draft.length,
    baseline: stats(timing.baseline),
    current: stats(timing.current)
  });
}
for (const seconds of [30, 60]) {
  const pcm = Float32Array.from({ length: seconds * 16000 }, (_, i) => Math.sin(i)),
    signal = new AbortController().signal;
  const expected = baseProof(0, seconds, pcm);
  assert.deepEqual(await audioProofAsync(0, seconds, pcm, signal), expected);
  const timing = { baseline: [], current: [] },
    blocking = { baseline: [], current: [] };
  for (let n = 0; n < rounds; n++)
    for (const name of n % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
      const t = performance.now();
      const pending =
        name === 'current' ? audioProofAsync(0, seconds, pcm, signal) : baseProof(0, seconds, pcm);
      const returned = performance.now();
      const proof = await pending;
      timing[name].push(performance.now() - t);
      blocking[name].push(returned - t);
      assert.deepEqual(proof, expected);
    }
  result.audioProof.push({
    seconds,
    bytes: pcm.byteLength,
    baseline: stats(timing.baseline),
    current: stats(timing.current),
    synchronousCallTime: { baseline: stats(blocking.baseline), current: stats(blocking.current) }
  });
}
const json = JSON.stringify(result, null, 2) + '\n';
if (args[2]) writeFileSync(args[3], json);
console.log(json);
