/** Real encoded-video -> production decoder -> real MOSS -> durable sparse queue.
 * Only the fixture HTTP endpoint is a test server; no decoder/ASR/storage doubles.
 */
import { compareEncodedWaveform } from './encoded-waveform.mjs';
import { mediaRuntime } from '../../.cache/media-test-build/encoded-media-adapter.js';
import { MediaPipeline } from '../../.cache/media-test-build/pipeline.js';
import { DecodeSessionCache } from '../../.cache/media-test-build/decode-session.js';
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
let queue, store, engine, source, jobId, duration, audioTrack, config, decodeCache;
let cancelPromise;
let phase = 'unstarted';
let pausedPrefix, decoderCheck;
let completedWindows = [];
let storeName;
let currentSourceAllowed = true;
let previousLifetime;
const pageLifetime = crypto.randomUUID();
const sourceReads = [];
const nativeChecks = [];
const decoderSessionOpens = [];
async function connectSource(input) {
  config = input;
  currentSourceAllowed = true;
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
    const remote = cloudSource(
      {
        name: 'video.webm',
        size: config.videoBytes,
        version: config.videoSha256,
        url: '/api/reader-web/connections/11111111-1111-4111-8111-111111111111/media/?' + query
      },
      'fixture-user',
      () => currentSourceAllowed
    );
    source = {
      ...remote,
      async read(start, end, signal) {
        const read = { start, end, phase, pageLifetime };
        sourceReads.push(read);
        const bytes = await remote.read(start, end, signal);
        read.bytes = bytes.length;
        return bytes;
      }
    };
  }
}
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
  decodeCache = new DecodeSessionCache(async (job, ownerSignal) => {
    decoderSessionOpens.push({ job: job.id, phase, pageLifetime });
    return new MediaPipeline(mediaRuntime, source, ownerSignal);
  });
  return new TranscriptionQueue(
    store,
    'guest',
    measured,
    async (job, start, end, signal) => {
      const pcm = await decodeCache.decode(job, Number(job.audioTrack), start, end, signal);
      check(pcm.length > 0 && pcm.every(Number.isFinite), 'Decoder returned invalid PCM');
      decodeCalls.push({ start, end, samples: pcm.length, phase });
      return pcm;
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
  sourceReads,
  pageLifetime,
  previousLifetime,
  nativeChecks,
  decoderSessionOpens,
  crossOriginIsolated: globalThis.crossOriginIsolated,
  userAgent: globalThis.navigator.userAgent
});

export async function start(input) {
  config = input;
  storeName = 'encoded-asr-' + crypto.randomUUID();
  await connectSource(input);
  phase = 'identity';
  check(
    (await identify(source, signal)) === 'content:' + config.videoSha256,
    'Full encoded-file identity mismatch'
  );
  const pipeline = new MediaPipeline(mediaRuntime, source, signal);
  try {
    const metadata = await pipeline.metadata();
    duration = metadata.duration;
    check(Math.abs(duration - config.duration) < 0.15, 'Encoded duration/timestamp mismatch');
    check(
      metadata.width === config.videoWidth && metadata.height === config.videoHeight,
      'Missing real video track'
    );
    const tracks = await pipeline.describeAudioTracks();
    check(
      tracks.length === 1 && tracks[0].decodable,
      'Actual encoded audio track cannot be decoded'
    );
    audioTrack = String(tracks[0].id);
    // Check an independent nonzero seek against the same decoded audio interval.
    // This catches omitted pre-roll/shifted packets before involving the model.
    const base = config.large ? 30 : 0;
    phase = config.large ? 'decoder-late-seek' : 'decoder-probe';
    const wide = await pipeline.decode(Number(audioTrack), base, base + 7.003, signal);
    const narrow = await pipeline.decode(Number(audioTrack), base + 1.003, base + 6.003, signal);
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
      widePackets: await packets(base, base + 7.003),
      narrowPackets: await packets(base + 1.003, base + 6.003)
    };

    // Exercise the production owner-scoped decoder cache over the actual
    // adapter/encoded source, independently from the queue's recognition calls.
    let cacheCreates = 0;
    const cache = new DecodeSessionCache(async (_job, ownerSignal) => {
      cacheCreates++;
      return new MediaPipeline(mediaRuntime, source, ownerSignal);
    });
    const firstOwner = new AbortController();
    const cacheJob = { id: 'encoded-cache-probe' };
    try {
      const one = await cache.decode(
        cacheJob,
        Number(audioTrack),
        base,
        base + 1.25,
        firstOwner.signal
      );
      const two = await cache.decode(
        cacheJob,
        Number(audioTrack),
        base + 1.25,
        base + 2.5,
        firstOwner.signal
      );
      check(one.length > 0 && two.length > 0, 'Cached decoder returned empty PCM');
      check(cacheCreates === 1, 'One owner rebuilt the encoded decoder between windows');
      firstOwner.abort(new DOMException('probe owner retired', 'AbortError'));
      const successor = new AbortController();
      const three = await cache.decode(
        cacheJob,
        Number(audioTrack),
        base + 2.5,
        base + 3.5,
        successor.signal
      );
      check(three.length > 0, 'Successor decoder returned empty PCM');
      check(cacheCreates === 2, 'Successor owner inherited the previous decoder session');
      nativeChecks.push(
        'real encoded decoder session reused within one owner and fenced at successor'
      );
    } finally {
      cache.dispose();
    }
    check(
      comparison.passed,
      'Independent encoded-audio seek exceeded container precision or changed the waveform: ' +
        JSON.stringify(decoderCheck)
    );
    if (config.large && config.source === 'range') {
      check(
        sourceReads.some(
          (read) =>
            read.phase === 'decoder-late-seek' && read.start >= 4 * 1024 * 1024 && read.bytes > 0
        ),
        'Late decoding never read a remote offset beyond the production cache'
      );
      check(
        sourceReads.every((read) => read.end - read.start <= 4 * 1024 * 1024),
        'A remote request exceeded the transport budget'
      );
      nativeChecks.push('nonzero late remote decode beyond cache');
      const [cachedTrack] = await pipeline.audioTracks();
      await cachedTrack.getName(); // Warm the retained adapter method before revocation.
      const before = sourceReads.length;
      currentSourceAllowed = false;
      let rejected = false;
      try {
        // Test the adapter directly before the pipeline's abort/dispose can
        // accidentally make a missing adapter lifetime check appear correct.
        await cachedTrack.getName();
      } catch (error) {
        rejected = /source.*current/i.test(String(error));
      }
      check(rejected, 'Retained track metadata bypassed source revocation');
      rejected = false;
      try {
        await pipeline.metadata();
      } catch (error) {
        rejected = /source.*current/i.test(String(error));
      }
      check(rejected, 'Cached metadata bypassed source revocation');
      check(sourceReads.length === before, 'Revoked cache checks issued a new source read');
      currentSourceAllowed = true;
      rejected = false;
      try {
        await pipeline.metadata();
      } catch {
        rejected = true;
      }
      check(rejected, 'Restored predicate revived a revoked pipeline');
      nativeChecks.push('cached source revocation retires metadata and retained tracks');
    }
  } finally {
    pipeline.dispose();
  }
  if (config.large && config.source === 'range') await connectSource(input);
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

async function pauseCheckpoint() {
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
  return job;
}

export async function beforeReload() {
  const job = await pauseCheckpoint();
  return {
    config,
    storeName,
    jobId,
    job,
    pausedPrefix,
    completedWindows,
    duration,
    audioTrack,
    diagnostics: diagnostics()
  };
}

export async function restore(snapshot) {
  check(snapshot.diagnostics.pageLifetime !== pageLifetime, 'No real page reload occurred');
  check(snapshot.config.source === 'range', 'Reload qualification requires a reconnectable source');
  ({ storeName, jobId, pausedPrefix, completedWindows, duration, audioTrack } = snapshot);
  previousLifetime = snapshot.diagnostics;
  phase = 'reload-identity';
  await connectSource(snapshot.config);
  store = new MediaStore(globalThis.indexedDB, storeName);
  const recovered = await store.local('guest', 'jobs', jobId);
  check(same(recovered, snapshot.job), 'Full-page reload changed the durable checkpoint');
  check(
    (await identify(source, signal)) === 'content:' + config.videoSha256,
    'Reloaded remote source changed content identity'
  );
  queue = makeQueue(false);
  await queue.recover();
  check(
    same(await store.local('guest', 'jobs', jobId), recovered),
    'Recovery changed a user pause'
  );
  check(
    counts.prepare === 0 && counts.inference === 0,
    'Page reload started recognition automatically'
  );
  check(
    (await store.tracks('guest', recovered.mediaKey)).length === 0,
    'Reload published an incomplete track'
  );
  nativeChecks.push('full-page reload retains paused checkpoint without inference');
}

export async function resumeReloaded() {
  check(previousLifetime && queue, 'Restore the reloaded checkpoint before Resume');
  phase = 'resume';
  await queue.resume(jobId);
}

export async function reopen() {
  const job = await pauseCheckpoint();
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
  const ordinary = [...(previousLifetime?.decodeCalls ?? []), ...decodeCalls].filter(
    ({ end, start }) => end - start <= 30
  );
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

globalThis.encodedASR = {
  start,
  state,
  reopen,
  beforeReload,
  restore,
  resumeReloaded,
  finish,
  diagnostics
};
globalThis.encodedReady = true;
