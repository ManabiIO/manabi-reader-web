/** Real encoded-video -> production decoder -> real MOSS -> durable sparse queue.
 * Only the fixture HTTP endpoint is a test server; no decoder/ASR/storage doubles.
 */
import { compareEncodedWaveform } from './encoded-waveform.mjs';
import { mediaRuntime } from '../../.cache/media-test-build/encoded-media-adapter.js';
import { MediaPipeline } from '../../.cache/media-test-build/pipeline.js';
import { MossClient } from '../../.cache/media-test-build/moss-client.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { localSource, cloudSource, identify } from '../../.cache/media-test-build/sources.js';
import { serializeSubtitles } from '../../.cache/media-test-build/captions.js';
import { downloadSubtitles } from '../../.cache/media-test-build/subtitle-download.js';

const check = (condition, message) => {
  if (!condition) throw Error(message);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const logs = [];
let queue, store, engine, source, jobId, duration, audioTrack, config;
let cancelPromise;
let phase = 'unstarted';
let pausedPrefix, decoderCheck;
let completedWindows = [];
let storeName;
const decodeCalls = [],
  inferenceCalls = [],
  updates = [];
const counts = { prepare: 0, inference: 0, dispose: 0 };
const signal = new AbortController().signal;
const makeQueue = (pauseAfterFirst) => {
  engine = new MossClient(
    '/apps/web/static/moss',
    new URL('../../.cache/media-test-build/moss-worker.js', import.meta.url)
  );
  const measured = {
    async prepare(signal, progress) {
      counts.prepare++;
      return engine.prepare(signal, progress);
    },
    async transcribe(pcm, signal, preview) {
      counts.inference++;
      const start = performance.now();
      const samples = pcm.length;
      let callbacks = 0;
      const raw = await engine.transcribe(pcm, signal, (text) => {
        callbacks++;
        preview?.(text);
      });
      inferenceCalls.push({ samples, seconds: (performance.now() - start) / 1000, callbacks });
      return raw;
    },
    async dispose() {
      counts.dispose++;
      await engine.dispose();
    }
  };
  return new TranscriptionQueue(
    store,
    'guest',
    measured,
    async (job, start, end, signal) => {
      const pipeline = new MediaPipeline(mediaRuntime, source, signal);
      try {
        const pcm = await pipeline.decode(Number(job.audioTrack), start, end, signal);
        check(pcm.length > 0 && pcm.every(Number.isFinite), 'Decoder returned invalid PCM');
        decodeCalls.push({ start, end, samples: pcm.length, phase });
        return pcm;
      } finally {
        pipeline.dispose();
      }
    },
    (progress) => {
      updates.push({ stage: progress.stage, nextWindow: progress.job.nextWindow });
      if (
        pauseAfterFirst &&
        !cancelPromise &&
        progress.job.nextWindow === 1 &&
        progress.stage === 'transcribing'
      )
        cancelPromise = queue.cancel(progress.job.id);
    },
    (error) => logs.push(String(error))
  );
};
export const diagnostics = () => ({
  phase,
  decoderCheck,
  jobId,
  counts,
  decodeCalls,
  inferenceCalls,
  updates,
  logs,
  crossOriginIsolated: globalThis.crossOriginIsolated,
  userAgent: globalThis.navigator.userAgent
});

export async function start(input) {
  config = input;
  storeName = 'encoded-asr-' + crypto.randomUUID();
  if (config.source === 'file') {
    const response = await fetch('/__encoded__/video.webm');
    check(response.ok, 'Encoded fixture unavailable');
    source = localSource(
      new globalThis.File([await response.blob()], 'video.webm', { lastModified: 1 })
    );
  } else {
    const query = new URLSearchParams({
      id: 'fixture',
      root: 'fixture-root',
      user: 'fixture-user',
      version: config.videoSha256
    });
    source = cloudSource(
      {
        name: 'video.webm',
        size: config.videoBytes,
        version: config.videoSha256,
        url: '/api/reader-web/connections/11111111-1111-4111-8111-111111111111/media/?' + query
      },
      'fixture-user',
      () => true
    );
  }
  check(
    (await identify(source, signal)) === 'content:' + config.videoSha256,
    'Full encoded-file identity mismatch'
  );
  const pipeline = new MediaPipeline(mediaRuntime, source, signal);
  try {
    const metadata = await pipeline.metadata();
    duration = metadata.duration;
    check(Math.abs(duration - config.duration) < 0.15, 'Encoded duration/timestamp mismatch');
    check(metadata.width === 160 && metadata.height === 90, 'Missing real video track');
    const tracks = await pipeline.describeAudioTracks();
    check(
      tracks.length === 1 && tracks[0].decodable,
      'Actual encoded audio track cannot be decoded'
    );
    audioTrack = String(tracks[0].id);
    // Check an independent nonzero seek against the same decoded audio interval.
    // This catches omitted pre-roll/shifted packets before involving the model.
    const wide = await pipeline.decode(Number(audioTrack), 0, 7.003, signal);
    const narrow = await pipeline.decode(Number(audioTrack), 1.003, 6.003, signal);
    const offset = Math.round(1.003 * 16000);
    // This WebM fixture has a measured coarse timestamp clock. A single global
    // comparison offset within one tick is allowed, never a change to model PCM.
    const comparison = compareEncodedWaveform(wide, narrow, offset, config.audioTimeBase);
    const packets = async (start, end) => {
      const out = [];
      const track = (await pipeline.audioTracks()).find((item) => item.id === Number(audioTrack));
      for await (const { buffer, timestamp, duration } of track.buffers(start, end)) {
        out.push({
          timestamp,
          duration,
          frames: buffer.length,
          rate: buffer.sampleRate,
          channels: buffer.numberOfChannels
        });
        if (out.length === 12) break;
      }
      return out;
    };
    decoderCheck = {
      ...comparison,
      sampleOffset: offset,
      samples: narrow.length,
      widePackets: await packets(0, 7.003),
      narrowPackets: await packets(1.003, 6.003)
    };
    check(
      comparison.passed,
      'Independent encoded-audio seek exceeded container precision or changed the waveform: ' +
        JSON.stringify(decoderCheck)
    );
  } finally {
    pipeline.dispose();
  }
  store = new MediaStore(globalThis.indexedDB, storeName);
  queue = makeQueue(true);
  check(counts.prepare === 0 && counts.inference === 0, 'Browsing prepared the model');
  phase = 'first-window';
  const job = await queue.enqueue(
    'content:' + config.videoSha256,
    config.language,
    audioTrack,
    duration,
    0
  );
  jobId = job.id;
  return jobId;
}

export async function state() {
  const job = jobId && (await store.local('guest', 'jobs', jobId));
  return { job, errors: [...logs], diagnostics: diagnostics() };
}

export async function reopen() {
  await cancelPromise;
  await queue.dispose();
  const job = await store.local('guest', 'jobs', jobId);
  check(
    job.status === 'paused' && job.nextWindow === 1,
    'Pause did not preserve the first durable window'
  );
  check(job.cues.length > 0, 'No accepted captions before the pause');
  pausedPrefix = structuredClone(job.cues);
  completedWindows = job.sparse.windows
    .map((window, index) => (window ? index : -1))
    .filter((index) => index >= 0);
  check((await store.tracks('guest', job.mediaKey)).length === 0, 'Incomplete track published');
  let rejected = false;
  try {
    downloadSubtitles('fixture.webm', { complete: false, cues: job.cues });
  } catch {
    rejected = true;
  }
  check(rejected, 'Incomplete subtitle export was permitted');
  await store.close();
  store = new MediaStore(globalThis.indexedDB, storeName);
  const recovered = await store.local('guest', 'jobs', jobId);
  check(same(recovered, job), 'Database reopen changed the checkpoint');
  phase = 'resume';
  cancelPromise = undefined;
  queue = makeQueue(false);
  await queue.resume(jobId);
}

export async function finish() {
  await queue.dispose();
  const job = await store.local('guest', 'jobs', jobId);
  check(job.status === 'complete', 'Queue did not complete');
  const [track, ...extra] = await store.tracks('guest', 'content:' + config.videoSha256);
  check(
    !!track && !extra.length && track.id === jobId && track.complete,
    'Missing/duplicate completed track'
  );
  check(
    same(track.cues.slice(0, pausedPrefix.length), pausedPrefix),
    'Accepted prefix changed during resume'
  );
  check(
    new Set(track.cues.map((cue) => cue.id)).size === track.cues.length,
    'Duplicate cue identity'
  );
  check(
    track.cues.every((cue, i) => !i || cue.start >= track.cues[i - 1].start),
    'Unordered captions'
  );
  check(
    track.cues.some((cue) => cue.start >= 30),
    'Later encoded speech is missing'
  );
  const ordinary = decodeCalls.filter(({ end, start }) => end - start <= 30);
  for (const index of completedWindows)
    check(
      ordinary.filter(({ start }) => start === Math.max(0, index * 26 - 2)).length === 1,
      'An accepted ordinary window was decoded again after reopen'
    );
  const srt = serializeSubtitles(track);
  check(
    srt.includes('-->') && track.cues.every((cue) => srt.includes(cue.text)),
    'Final SRT is incomplete'
  );
  check(logs.length === 0, 'Queue reported a background error');
  const beforeReopen = structuredClone(track);
  await store.close();
  store = new MediaStore(globalThis.indexedDB, storeName);
  check(
    same((await store.tracks('guest', track.mediaKey))[0], beforeReopen),
    'Published subtitle failed to survive reopen'
  );
  await store.close();
  phase = 'complete';
  return { ...diagnostics(), track, srt, pausedPrefix, duration, source: config.source };
}

globalThis.encodedASR = { start, state, reopen, finish, diagnostics };
globalThis.encodedReady = true;
