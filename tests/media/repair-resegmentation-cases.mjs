/** Shared real queue/store scenarios; only decoding and inference are scripted. */
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { MOSS } from '../../.cache/media-test-build/model-cache.js';
import { validateJob, jobCanResume, releasedJob } from '../../.cache/media-test-build/jobs.js';
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
    retry = false,
    expectedReplies
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
      if (expectedReplies)
        same(
          track.cues.filter((cue) => cue.text === 'はい').map((cue) => [cue.start, cue.end]),
          expectedReplies,
          'separate short replies were not preserved'
        );
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
for (const policy of ['overlap-sparse-v1', 'overlap-sparse-v2']) {
  cases.push({
    name: `${policy}: a separate identical short reply cannot impersonate an accepted anchor`,
    run: (factory) =>
      run(factory, {
        policy,
        accepted: [cue('w0/cue-0', 'はい', 2, 2.2)],
        raw: '[2.21][S01]はい[2.41]' + seam,
        fail: true
      })
  });
  cases.push({
    name: `${policy}: repair keeps the true short anchor and a separate identical reply`,
    run: (factory) =>
      run(factory, {
        policy,
        accepted: [cue('w0/cue-0', 'はい', 2, 2.2)],
        raw: '[2][S01]はい[2.2][2.21][S01]はい[2.41]' + seam,
        expectedReplies: [
          [2, 2.2],
          [2.21, 2.41]
        ]
      })
  });
}

function overlappingRepairs({
  good = false,
  fresh = false,
  transitive = false,
  status = 'queued'
} = {}) {
  const duration = transitive ? 130 : 104;
  const sparse = newSparseState(duration);
  sparse.windows = sparse.windows.map((_, index) => ({
    cues: index ? [cue(`w${index}/cue-0`, '原文', index * 26 + 2, index * 26 + 3)] : [],
    inferenceMs: 1
  }));
  sparse.repairs[1] = [
    cue('w1/repair-0', '前の文章', 30, 32),
    cue('w1/repair-1', 'はい', 54, 54.2),
    cue('w1/repair-2', '共通境界', 77, 79)
  ];
  sparse.repairs[2] = [
    cue('w2/repair-0', 'はい', good ? 54.02 : 54.21, good ? 54.22 : 54.41),
    cue('w2/repair-1', '共通境界', 77, 79),
    cue('w2/repair-2', '後ろの文章', 90, 92)
  ];
  if (transitive) {
    sparse.repairs[1] = [cue('w1/repair-0', 'はい', 77.8, 78)];
    sparse.repairs[2] = [
      cue('w2/repair-0', 'はい', 77.88, 78.08),
      cue('w2/repair-1', '共通境界', 103, 105)
    ];
    sparse.repairs[3] = [
      cue('w3/repair-0', 'はい', 77.96, 78.16),
      cue('w3/repair-1', '共通境界', 103, 105),
      cue('w3/repair-2', '後ろの文章', 117, 119)
    ];
  }
  if (fresh) {
    sparse.windows[0] = null;
    sparse.repairs[2] = null;
  }
  return validateJob({
    version: 3,
    id: crypto.randomUUID(),
    mediaKey: key,
    language: 'ja',
    audioTrack: '1',
    duration,
    status,
    nextWindow: sparse.windows.filter(Boolean).length,
    cues: acceptedSparseCues(sparse, duration),
    sparse,
    modelSha256: MOSS.sha256,
    engineRevision: MOSS.engineRevision,
    createdAt: 1
  });
}
async function overlappingRepairScenario(factory, options) {
  const db = 'overlap-timing-' + crypto.randomUUID();
  let store = new MediaStore(factory, db),
    queue;
  const job = overlappingRepairs(options);
  let calls = 0,
    decodes = 0;
  try {
    await store.putLocal('guest', 'jobs', job.id, job);
    // Existing hypotheses stay readable; rejecting publication is not a migration.
    await store.close();
    store = new MediaStore(factory, db);
    same(validateJob(await store.local('guest', 'jobs', job.id)), job, 'saved hypotheses changed');
    queue = new TranscriptionQueue(
      store,
      'guest',
      {
        async prepare() {},
        async transcribe() {
          return ++calls === 1
            ? '[4.21][S01]はい[4.41][27][S01]共通境界[29][40][S01]後ろの文章[42]'
            : '';
        },
        dispose() {}
      },
      async (_job, a, b) => {
        decodes++;
        return new Float32Array(Math.round((b - a) * 16000)).fill(0.1);
      }
    );
    if (options.status === 'paused') {
      same(
        jobCanResume(job),
        false,
        'an unchanged conflicting repaired pair must not advertise Resume'
      );
      let rejected = false;
      try {
        await queue.resume(job.id);
      } catch (error) {
        if (!/cannot be retried safely/.test(error.message)) throw error;
        rejected = true;
      }
      same(rejected, true, 'Resume accepted an unretryable saved pair');
      same(await store.local('guest', 'jobs', job.id), job, 'declined Resume mutated the job');
    } else {
      await queue.resume(job.id);
      const outcome = await settled(store, job.id);
      await queue.dispose();
      same(
        outcome.status,
        options.good ? 'complete' : 'failed',
        'incorrect overlap completion: ' + outcome.error
      );
      if (!options.good) {
        same(outcome.cues, job.cues, 'conflict changed accepted captions');
        same(outcome.sparse, job.sparse, 'conflict changed original repair hypotheses');
      }
    }
    const tracks = await store.tracks('guest', key);
    same(tracks.length, options.good ? 1 : 0, 'unsafe overlap published a complete track');
    same(calls, options.fresh ? 1 : 0, 'unnecessary inference after a saved timing conflict');
    same(decodes, options.fresh ? 1 : 0, 'unnecessary decode after a saved timing conflict');
    await store.close();
    store = new MediaStore(factory, db);
    same(await store.tracks('guest', key), tracks, 'database reopening changed the outcome');
    return { calls, decodes, published: tracks.length, savedHypothesesPreserved: !options.good };
  } finally {
    await queue?.dispose();
    await store.close();
  }
}
for (const [name, options] of [
  ['saved queued repair overlap cannot silently drop a separate reply', {}],
  [
    'saved paused repair overlap is readable but cannot repeat a futile Resume',
    { status: 'paused' }
  ],
  ['a new disconnected repair cannot checkpoint disjoint short-reply agreement', { fresh: true }],
  ['a genuinely overlapping saved repair pair still completes without inference', { good: true }]
])
  cases.push({ name, run: (factory) => overlappingRepairScenario(factory, options) });

cases.push({
  name: 'three repair windows cannot accumulate drift past the original short reply',
  run: (factory) => overlappingRepairScenario(factory, { transitive: true })
});
cases.push({
  name: 'direct completed-track publication cannot bypass saved repair timing',
  run: async (factory) => {
    const db = 'repair-publication-' + crypto.randomUUID();
    let store = new MediaStore(factory, db);
    const ownerId = crypto.randomUUID();
    const job = validateJob({
      ...overlappingRepairs({ status: 'running' }),
      ownerId,
      leaseUntil: Date.now() + 90000,
      completedAt: 2
    });
    const completed = releasedJob(job, 'complete');
    const track = {
      version: 1,
      id: job.id,
      mediaKey: key,
      language: 'ja',
      kind: 'transcription',
      origin: 'generated',
      label: 'Japanese',
      complete: true,
      forced: false,
      createdAt: 1,
      cues: job.cues,
      provenance: {
        engine: 'moss-transcribe.cpp/overlap-sparse-v2',
        engineRevision: MOSS.engineRevision,
        model: MOSS.model,
        modelRevision: MOSS.revision,
        modelSha256: MOSS.sha256,
        quantization: MOSS.quantization,
        audioTrack: '1',
        windowSeconds: 30,
        overlapSeconds: 2,
        generatedAt: 2
      }
    };
    try {
      await store.putLocal('guest', 'jobs', job.id, job);
      let rejected = false;
      try {
        await store.saveTrack('guest', track, { ownerId, job: completed });
      } catch (error) {
        if (!/Overlapping repair hypotheses/.test(error.message)) throw error;
        rejected = true;
      }
      same(rejected, true, 'publication bypassed the timing guard');
      await store.close();
      store = new MediaStore(factory, db);
      same(
        await store.local('guest', 'jobs', job.id),
        job,
        'guard rewrote the existing checkpoint'
      );
      same(await store.records('guest'), [], 'caption pages persisted for an unsafe repaired pair');
      same(await store.tracks('guest', key), [], 'unsafe complete track persisted');
      return { published: false, checkpointPreserved: true };
    } finally {
      await store.close();
    }
  }
});
