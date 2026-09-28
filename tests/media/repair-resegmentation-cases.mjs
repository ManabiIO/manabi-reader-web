/** Shared real queue/store scenarios; only decoding and inference are scripted. */
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { MOSS } from '../../.cache/media-test-build/model-cache.js';
import { validateJob } from '../../.cache/media-test-build/jobs.js';
import {
  newSparseState,
  acceptedSparseCues
} from '../../.cache/media-test-build/sparse-transcription.js';
import { audioProof } from '../../.cache/media-test-build/audio-proof.js';

const key = 'content:' + 'd'.repeat(64);
const cue = (id, text, start, end, speaker = 'w0/S01') => ({ id, text, start, end, speaker });
const same = (a, b, label) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(label);
};
const tick = () => new Promise((r) => setTimeout(r, 1));
async function settled(store, id) {
  for (let n = 0; n < 1500; n++) {
    const job = await store.local('guest', 'jobs', id);
    if (['complete', 'failed', 'paused'].includes(job?.status)) return job;
    await tick();
  }
  throw Error('Repair did not reach a durable outcome');
}
function initial(policy, accepted, proofs = false, adjacent = false) {
  const duration = adjacent ? 78 : 52;
  const sparse = newSparseState(duration);
  sparse.policy = policy;
  sparse.windows[0] = {
    cues: [...accepted, cue('w0/cue-9', '元の左候補', 24, 27)],
    inferenceMs: 1
  };
  sparse.windows[1] = { cues: [cue('w1/cue-0', '元の右候補', 24, 27, 'w1/S01')], inferenceMs: 1 };
  if (adjacent) {
    sparse.repairs[0] = [
      cue('w0/repair-0', '前の文章', 24, 27),
      cue('w0/repair-1', '日本語の文章です。', 30, 34),
      cue('w0/repair-2', '次の境界候補', 50, 53)
    ];
    sparse.windows[2] = {
      cues: [cue('w2/cue-0', '別の境界候補', 50, 53, 'w2/S01')],
      inferenceMs: 1
    };
  }
  const job = {
    version: 3,
    id: crypto.randomUUID(),
    mediaKey: key,
    language: 'ja',
    audioTrack: '1',
    duration,
    status: 'paused',
    nextWindow: sparse.windows.filter(Boolean).length,
    cues: acceptedSparseCues(sparse, duration),
    sparse,
    modelSha256: MOSS.sha256,
    engineRevision: MOSS.engineRevision,
    createdAt: 1
  };
  if (proofs) {
    const pcm = (a, b) => new Float32Array((b - a) * 16000).fill(0.1);
    Object.assign(job, {
      provisional: true,
      verifiedMediaKey: key,
      audioProofs: [audioProof(0, 28, pcm(0, 28)), audioProof(24, 52, pcm(24, 52))]
    });
  }
  return validateJob(job);
}
async function run(
  factory,
  {
    policy = 'overlap-sparse-v2',
    accepted,
    raw,
    fail = false,
    proofs = false,
    adjacent = false,
    retry = false
  }
) {
  const db = 'repair-alignment-' + crypto.randomUUID();
  let store = new MediaStore(factory, db),
    queue;
  const job = initial(policy, accepted, proofs, adjacent);
  let calls = 0,
    block = retry;
  const makeQueue = () =>
    new TranscriptionQueue(
      store,
      'guest',
      {
        async prepare() {},
        async transcribe() {
          calls++;
          return raw;
        },
        dispose() {}
      },
      async (_job, start, end) => new Float32Array((end - start) * 16000).fill(0.1)
    );
  try {
    await store.putLocal('guest', 'jobs', job.id, job);
    const originalSave = store.saveTrack.bind(store);
    if (retry)
      store.saveTrack = (...args) => {
        if (block) {
          block = false;
          throw Error('scripted publication failure');
        }
        return originalSave(...args);
      };
    queue = makeQueue();
    await queue.resume(job.id);
    let outcome = await settled(store, job.id);
    await queue.dispose();
    const saved = structuredClone(outcome);
    if (fail) {
      same(outcome.status, 'failed', 'a contradictory repair must fail');
      same(outcome.cues, job.cues, 'accepted captions must survive failure');
      same(outcome.sparse, job.sparse, 'original hypotheses must survive failure');
      same(await store.tracks('guest', key), [], 'no partial publication');
    } else {
      if (retry) {
        same(outcome.status, 'failed', 'publication failure was not observed');
        await store.close();
        store = new MediaStore(factory, db);
        queue = makeQueue();
        await queue.resume(job.id);
        outcome = await settled(store, job.id);
        await queue.dispose();
      }
      same(outcome.status, 'complete', 'equivalent resegmentation must finish: ' + outcome.error);
      const [track] = await store.tracks('guest', key);
      same(track.id, job.id, 'track identity');
      same(
        track.cues.slice(0, job.cues.length),
        job.cues,
        'accepted IDs/text/timing/speakers changed'
      );
      same(new Set(track.cues.map((c) => c.id)).size, track.cues.length, 'duplicate captions');
      same(calls, 1, 'saved ordinary windows or repaired output were recognized again');
      await store.close();
      store = new MediaStore(factory, db);
      same((await store.tracks('guest', key))[0], track, 'published track did not survive reopen');
    }
    return { status: outcome.status, calls, accepted: job.cues, checkpointStatus: saved.status };
  } finally {
    await queue?.dispose();
    await store.close();
  }
}
const merged = [cue('w0/cue-0', '今日は良い天気ですね。', 2, 6)];
const split = [cue('w0/cue-0', '今日は', 2, 4), cue('w0/cue-1', '良い天気ですね。', 4, 6)];
const seam = '[24][S01]修復された境界です。[27]';
export const cases = [];
for (const policy of ['overlap-sparse-v1', 'overlap-sparse-v2']) {
  for (const [name, accepted, raw] of [
    ['split repair', merged, '[2][S01]今日は[4][4][S01]良い天気ですね。[6]'],
    ['merged repair', split, '[2][S01]今日は良い天気ですね。[6]']
  ])
    cases.push({
      name: `${policy}: ${name} retains accepted IDs and publishes`,
      run: (factory) => run(factory, { policy, accepted, raw: raw + seam })
    });
}
cases.push({
  name: 'publication-only retry reuses the canonical repair after database reopen',
  run: (factory) =>
    run(factory, {
      accepted: merged,
      raw: '[2][S01]今日は[4][4][S01]良い天気ですね。[6]' + seam,
      retry: true
    })
});
cases.push({
  name: 'provisional audio proofs remain complete after repair resegmentation',
  run: (factory) =>
    run(factory, {
      accepted: merged,
      raw: '[2][S01]今日は[4][4][S01]良い天気ですね。[6]' + seam,
      proofs: true
    })
});
cases.push({
  name: 'a neighboring repair may resegment earlier accepted repair speech',
  run: (factory) =>
    run(factory, {
      accepted: [],
      adjacent: true,
      raw: '[0][S01]前の文章[3][6][S01]日本語の[8][8][S01]文章です。[10][26][S01]次の境界候補[29][38][S01]後半です。[39]'
    })
});
for (const [name, accepted, raw] of [
  ['different speech', merged, '[2][S01]今日は違う天気です。[6]'],
  [
    'speaker collapse',
    [cue('w0/cue-0', '今日は', 2, 4), cue('w0/cue-1', '良い天気ですね。', 4, 6, 'w0/S02')],
    '[2][S01]今日は良い天気ですね。[6]'
  ],
  ['numeric punctuation change', [cue('w0/cue-0', '1.5人です。', 2, 6)], '[2][S01]15人です。[6]'],
  ['retiming', merged, '[2.5][S01]今日は良い天気ですね[6.5]']
])
  cases.push({
    name: `${name} still fails without losing accepted captions`,
    run: (factory) => run(factory, { accepted, raw: raw + seam, fail: true })
  });
