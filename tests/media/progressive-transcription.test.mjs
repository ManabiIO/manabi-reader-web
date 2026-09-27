/** Production planning, stitching and durable orchestration; scripted recognizer/decoder only.
 * These tests reproduce seam policy defects, not measured recognition quality or speed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_RATE as SR,
  FIRST_INPUT_SECONDS,
  LEGACY_PROGRESSIVE_POLICY,
  newProgressiveState,
  chooseWindow,
  inputStart,
  inputEnd,
  coreEnd,
  durationSamples,
  joinBoundary,
  pendingSeamRepair,
  repairedSuffix,
  splitSettled,
  validateProgressiveState
} from '../../.cache/media-test-build/moss-progressive.js';
import {
  parseMoss,
  parseMossPreview,
  outputPreview,
  ownedCues,
  planWindows
} from '../../.cache/media-test-build/moss-output.js';
import { transcribeProgressively } from '../../.cache/media-test-build/progressive-transcription.js';
import { jobCanResume, validateJob } from '../../.cache/media-test-build/jobs.js';
import { MOSS } from '../../.cache/media-test-build/model-cache.js';
import { transcriptionDraft } from '../../.cache/media-test-build/transcription-draft.js';
import { MediaStore } from '../../.cache/media-test-build/store.js';
import { TranscriptionQueue } from '../../.cache/media-test-build/queue.js';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';

const id = '77777777-7777-4777-8777-777777777777',
  key = 'content:' + 'a'.repeat(64);
const cue = (text, start, end, id = 'w0/cue-0') => ({ id, text, start, end, speaker: 'w0/S01' });
const fresh = (duration = 70) =>
  validateJob({
    version: 2,
    progressive: newProgressiveState(),
    id,
    mediaKey: key,
    language: 'ja',
    audioTrack: '1',
    duration,
    status: 'running',
    nextWindow: 0,
    cues: [],
    modelSha256: MOSS.sha256,
    engineRevision: MOSS.engineRevision,
    createdAt: 1,
    ownerId: '88888888-8888-4888-8888-888888888888',
    leaseUntil: Date.now() + 90000
  });
const legacyProgressive = (duration = 70) => {
  const job = fresh(duration);
  job.progressive.policy = LEGACY_PROGRESSIVE_POLICY;
  return validateJob(job);
};
const pcm = (seconds, level = 0.1) => new Float32Array(Math.round(seconds * SR)).fill(level);
const decode = async (_job, start, end) => pcm(end - start);

for (const seconds of [0.0001, 1, 29.9999, 30, 30.0001, 60, 600, 3600]) {
  test(`progressive plan covers ${seconds}s exactly without exceeding an encoder block`, () => {
    const state = newProgressiveState();
    let until = 0;
    while (until < durationSamples(seconds)) {
      const window = chooseWindow(
        state,
        seconds,
        pcm((inputEnd(state, seconds) - inputStart(state)) / SR)
      );
      assert.equal(window.coreStartSample, until);
      assert.ok(window.endSample - window.startSample <= 480000);
      assert.ok(window.coreEndSample > until);
      assert.ok(Number.isSafeInteger(window.endSample));
      state.windows.push(window);
      until = window.coreEndSample;
    }
    assert.equal(until, durationSamples(seconds));
    assert.deepEqual(validateProgressiveState(state, seconds, state.windows.length), state);
  });
}
test('current policy emits a short settled first region before normal 30-second inputs', () => {
  const state = newProgressiveState();
  assert.equal(FIRST_INPUT_SECONDS, 12);
  assert.equal(inputEnd(state, 80), 12 * SR);
  const first = chooseWindow(state, 80, pcm(12));
  assert.equal(first.startSample, 0);
  assert.equal(first.endSample, 12 * SR);
  assert.equal(first.coreEndSample, 10 * SR);
  state.windows.push(first);
  assert.equal(inputStart(state), 8 * SR);
  assert.equal(inputEnd(state, 80), 38 * SR);
  const second = chooseWindow(state, 80, pcm(30));
  assert.equal(second.endSample - second.startSample, 30 * SR);
  assert.equal(second.coreEndSample, 36 * SR);
  assert.deepEqual(
    validateProgressiveState({ ...state, windows: [first, second] }, 80, 2).windows,
    [first, second]
  );
});
test('saved pause-overlap-v1 jobs retain the original 30-second first input', () => {
  const state = legacyProgressive(80).progressive;
  assert.equal(inputEnd(state, 80), 30 * SR);
  assert.equal(chooseWindow(state, 80, pcm(30)).coreEndSample, 28 * SR);
});
test('a sustained quiet valley chooses a seam but does not delete or compress its audio', () => {
  const state = newProgressiveState();
  state.windows.push(chooseWindow(state, 80, pcm(12)));
  const samples = pcm(30);
  // Second input is [8, 38]; local 25–26 s is absolute 33–34 s near its nominal seam.
  samples.fill(0, 25 * SR, 26 * SR);
  const window = chooseWindow(state, 80, samples);
  assert.ok(window.coreEndSample >= 33 * SR && window.coreEndSample <= 34 * SR);
  assert.equal(window.startSample, 8 * SR);
  assert.equal(window.endSample, window.coreEndSample + 2 * SR);
  state.windows.push(window);
  assert.equal(inputStart(state), window.coreEndSample - 2 * SR);
});
test('a waveform zero is not a pause boundary', () => {
  const samples = pcm(12);
  samples[8 * SR] = 0;
  assert.equal(chooseWindow(newProgressiveState(), 80, samples).coreEndSample, 10 * SR);
});
test('final short clips and leading silence never require whole-file analysis', () => {
  const window = chooseWindow(newProgressiveState(), 7, pcm(7, 0));
  assert.equal(window.coreEndSample, 7 * SR);
  assert.equal(window.endSample, 7 * SR);
});
test('digital-zero seam region advances to the nominal maximum boundary', () => {
  const state = newProgressiveState(),
    first = chooseWindow(state, 80, pcm(12));
  state.windows.push(first);
  const next = chooseWindow(state, 80, pcm(30, 0));
  assert.equal(next.coreEndSample, 36 * SR);
  assert.equal(next.endSample, 38 * SR);
});
for (const [a, b, expectedOld] of [
  [[58, 61], [59, 62], 2],
  [[59, 62], [58, 61], 0]
])
  test(`timestamp jitter reproduces ${expectedOld ? 'duplicate' : 'omission'} with midpoint ownership, joint seam retains one`, () => {
    const words = 'この文章は境界をまたぎます。';
    const left = cue(words, ...a),
      right = cue(words, ...b, 'w1/cue-0');
    const old = [
      ...ownedCues([left], { index: 0, start: 0, end: 64, coreStart: 0, coreEnd: 60 }),
      ...ownedCues([right], { index: 1, start: 0, end: 120, coreStart: 60, coreEnd: 120 })
    ];
    assert.equal(old.length, expectedOld);
    assert.deepEqual(joinBoundary([left], [right], 60), [left]);
  });
test('one Japanese sentence aligns with two whole cues without invented word timestamps', () => {
  const left = cue('今日は本を読みます。', 24, 29);
  const right = [
    cue('今日は', 24.2, 26, 'w1/cue-0'),
    cue('本を読みます。', 26, 29.2, 'w1/cue-1'),
    cue('次の文です。', 31, 34, 'w1/cue-2')
  ];
  assert.deepEqual(joinBoundary([left], right, 28), [left, right[2]]);
});
test('two Japanese cues align to one without changing retained cue IDs', () => {
  const left = [cue('今日は', 24, 26), cue('本を読みます。', 26, 29, 'w0/cue-1')];
  assert.deepEqual(
    joinBoundary(left, [cue('今日は本を読みます。', 24.1, 29.1, 'w1/cue-0')], 28),
    left
  );
});
test('separate repeated replies survive rather than globally deduplicating text', () => {
  const left = cue('はい。', 26, 27),
    right = cue('はい。', 29, 30, 'w1/cue-0');
  assert.deepEqual(joinBoundary([left], [right], 28), [left, right]);
});
for (const [a, b] of [
  ['行きます。', '行きません。'],
  ['15人です。', '50人です。'],
  ['食べた。', '食べる。']
])
  test(`disagreement ${a}/${b} cannot be normalized into deletion`, () =>
    assert.equal(joinBoundary([cue(a, 25, 29)], [cue(b, 25, 29, 'w1/cue-0')], 28), undefined));
test('punctuation matching never modifies the verbatim display text', () => {
  const a = cue('ええ、そうですね。', 25, 29),
    b = cue('ええそうですね', 25, 29, 'w1/cue-0');
  assert.deepEqual(joinBoundary([a], [b], 28), [a]);
});
test('unstable crossing cues are held whole and settled content is a prefix', () => {
  const window = chooseWindow(legacyProgressive(70).progressive, 70, pcm(30));
  const cues = [
    cue('先頭です。', 1, 2),
    cue('長い台詞です。', 23, 29, 'w0/cue-1'),
    cue('相づち', 24, 25, 'w0/cue-2')
  ];
  assert.deepEqual(splitSettled(cues, window, 70), { settled: [cues[0]], tail: cues.slice(1) });
});
test('bounded repair needs an anchor into accepted text, not a timestamp watermark', () => {
  const accepted = [cue('すでに確定した文です。', 20, 23)];
  const repaired = [
    cue('すでに確定した文です。', 20.1, 23.1, 'w1/repair-0'),
    cue('境界の文です。', 24, 29, 'w1/repair-1')
  ];
  assert.deepEqual(repairedSuffix(accepted, repaired, 0), repaired.slice(1));
  assert.equal(repairedSuffix(accepted, [cue('違う認識です。', 20, 23)], 0), undefined);
});
for (const mutation of [
  (j) => (j.progressive.policy = 'future-policy'),
  (j) => (j.progressive.inputSeconds = 60),
  (j) => (j.progressive.windows[0].startSample = 1),
  (j) => (j.progressive.windows[0].endSample = 480001),
  (j) => (j.progressive.windows[0].coreEndSample = 447999.5),
  (j) => (j.progressive.windows[0].coreStartSample = 1),
  (j) => (j.nextWindow = 2),
  (j) => (j.progressive.tail = [j.cues[0]]),
  (j) => (j.progressive.tail = [cue('bad', 26, 29, 'w9/cue-0')]),
  (j) => (j.cues[0].end = 29),
  (j) => (j.status = 'complete')
])
  test(
    'saved progressive checkpoint rejects inconsistent boundaries: ' + mutation.toString(),
    () => {
      const job = legacyProgressive();
      job.progressive.windows.push(chooseWindow(job.progressive, job.duration, pcm(30)));
      job.nextWindow = 1;
      job.cues = [cue('accepted', 1, 2)];
      assert.doesNotThrow(() => validateJob(job));
      mutation(job);
      assert.throws(() => validateJob(job));
    }
  );
test('version-one jobs retain exactly the original 60-second/two-second windows', () => {
  const old = fresh(120);
  delete old.progressive;
  const saved = validateJob({ ...old, version: 1, nextWindow: 1, cues: [cue('legacy', 1, 2)] });
  assert.equal(saved.version, 1);
  assert.equal(saved.progressive, undefined);
  assert.deepEqual(planWindows(saved.duration)[saved.nextWindow], {
    index: 1,
    start: 58,
    end: 120,
    coreStart: 60,
    coreEnd: 120
  });
  assert.throws(() => validateJob({ ...saved, progressive: newProgressiveState() }));
});
const raw = '[0][S01]番号は[123]です。[2][2.5][S02]いいえ、違います。[4]';
test('every output prefix withholds ambiguous/incomplete brackets until structurally closed', () => {
  const full = parseMoss(raw, 5);
  for (let n = 0; n < raw.length; n++) {
    const preview = parseMossPreview(raw.slice(0, n), 5);
    assert.deepEqual(preview, full.slice(0, preview.length));
    assert.ok(preview.length < full.length);
  }
  assert.equal(parseMossPreview(raw, 5).length, 1);
  assert.equal(full[0].text, '番号は[123]です。');
  assert.throws(() => parseMoss(raw.slice(0, -1), 5));
});
test('UTF-8 snapshots split across Japanese bytes never introduce replacement characters', () => {
  const text = '[0][S01]東京、読みます。😀',
    bytes = new TextEncoder().encode(text);
  for (let n = 0; n <= bytes.length; n++) {
    const result = outputPreview(bytes.slice(0, n));
    assert.ok(text.startsWith(result));
    assert.equal(result.includes('\ufffd'), false);
  }
  assert.throws(() => outputPreview(new Uint8Array([0xff])));
  assert.throws(() => outputPreview(new Uint8Array(1024 * 1024 + 1)));
});

function runner(
  initial = legacyProgressive(50),
  responses = ['[1][S01]先頭です。[2]', '[3][S01]次の文です。[4]']
) {
  const state = {
    job: structuredClone(initial),
    writes: [],
    events: [],
    reads: [],
    inferences: [],
    prepares: 0
  };
  const controller = new AbortController();
  const options = {
    signal: controller.signal,
    decode: async (...args) => {
      state.reads.push([args[1], args[2]]);
      return decode(...args);
    },
    engine: {
      prepare: async () => {
        state.prepares++;
      },
      transcribe: async (samples, _signal, preview) => {
        state.inferences.push(samples.length);
        const response = responses.shift();
        if (response instanceof Error) throw response;
        if (response === undefined) throw Error('Unexpected inference');
        preview?.(response);
        return response;
      }
    },
    checkpoint: async (job) => {
      state.job = validateJob(structuredClone(job));
      state.writes.push(structuredClone(state.job));
      return state.job;
    },
    notify: (event) => state.events.push(structuredClone(event))
  };
  return { state, controller, options, run: () => transcribeProgressively(state.job, options) };
}
test('accepted captions checkpoint before the rest of the file and rolling lookahead is reused', async () => {
  const h = runner();
  await h.run();
  assert.equal(h.state.writes[0].nextWindow, 1);
  assert.equal(h.state.writes[0].cues.length, 1);
  assert.equal(coreEnd(h.state.writes[0].progressive), 28 * SR);
  assert.deepEqual(
    h.state.reads,
    [
      [0, 30],
      [30, 50]
    ],
    'next input reuses the retained 26–30s overlap'
  );
  assert.ok(h.state.inferences.every((n) => n <= 480000));
  assert.equal(h.state.job.cues.length, 2);
  assert.equal(coreEnd(h.state.job.progressive), 50 * SR);
});
test('exact silence advances coverage with no model preparation; quiet speech still runs', async () => {
  const h = runner(fresh(50), []);
  h.options.decode = async (_job, start, end) => pcm(end - start, 0);
  await h.run();
  assert.equal(h.state.prepares, 0);
  assert.equal(coreEnd(h.state.job.progressive), 50 * SR);
  assert.deepEqual(h.state.job.cues, []);
  const quiet = runner(fresh(2), ['[0][S01]静かな声。[1]']);
  quiet.options.decode = async (_job, start, end) => pcm(end - start, 1e-9);
  await quiet.run();
  assert.equal(quiet.state.inferences.length, 1);
});
test('verified-zero next input drops only fully covered unsettled hallucinations', async () => {
  const job = legacyProgressive(50),
    first = chooseWindow(job.progressive, 50, pcm(30));
  job.progressive.windows = [first];
  job.nextWindow = 1;
  job.cues = [cue('確定した発言です。', 1, 2)];
  job.progressive.tail = [cue('無音上の幻覚です。', 26.5, 27.5, 'w0/cue-1')];
  const h = runner(validateJob(job), []);
  h.options.decode = async (_job, start, end) => pcm(end - start, 0);
  await h.run();
  assert.equal(h.state.prepares, 0);
  assert.deepEqual(
    h.state.job.cues.map((c) => c.text),
    ['確定した発言です。']
  );
  assert.deepEqual(h.state.job.progressive.tail, []);
});
test('verified-zero overlap preserves a held cue that began before the covered input', async () => {
  const job = legacyProgressive(50),
    first = chooseWindow(job.progressive, 50, pcm(30));
  job.progressive.windows = [first];
  job.nextWindow = 1;
  job.cues = [cue('確定した発言です。', 1, 2)];
  job.progressive.tail = [cue('境界をまたぐ発言です。', 25, 27.5, 'w0/cue-1')];
  const h = runner(validateJob(job), []);
  h.options.decode = async (_job, start, end) => pcm(end - start, 0);
  await h.run();
  assert.deepEqual(
    h.state.job.cues.map((c) => c.text),
    ['確定した発言です。', '境界をまたぐ発言です。']
  );
});
test('silent-tail correction is not durable until its checkpoint succeeds', async () => {
  const job = legacyProgressive(50),
    first = chooseWindow(job.progressive, 50, pcm(30));
  job.progressive.windows = [first];
  job.nextWindow = 1;
  job.cues = [cue('確定した発言です。', 1, 2)];
  job.progressive.tail = [cue('まだ保存済みの候補です。', 26.5, 27.5, 'w0/cue-1')];
  const h = runner(validateJob(job), []);
  h.options.decode = async (_job, start, end) => pcm(end - start, 0);
  h.options.checkpoint = async () => {
    throw Error('quota');
  };
  await assert.rejects(h.run(), /quota/);
  assert.equal(h.state.job.progressive.tail[0].text, 'まだ保存済みの候補です。');
  assert.equal(h.state.job.nextWindow, 1);
});
test('a token preview followed by inference failure never becomes an accepted checkpoint', async () => {
  const h = runner(fresh(2), []);
  h.options.engine.transcribe = async (_pcm, _signal, preview) => {
    preview('[0][S01]一時的です。[1][1][S01]続き');
    throw Error('MOSS token budget exhausted');
  };
  await assert.rejects(h.run(), /token budget/);
  assert.ok(h.state.events.some((e) => e.provisional?.length));
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.state.job.cues.length, 0);
});
test('a failed checkpoint does not advance the durable cursor or accepted captions', async () => {
  const h = runner();
  h.options.checkpoint = async () => {
    throw Error('quota');
  };
  await assert.rejects(h.run(), /quota/);
  assert.equal(h.state.job.nextWindow, 0);
  assert.equal(h.state.job.cues.length, 0);
});
test('cancellation retains the last checkpoint and resume does not recognize it again', async () => {
  const h = runner();
  const save = h.options.checkpoint;
  h.options.checkpoint = async (j) => {
    const saved = await save(j);
    h.controller.abort();
    return saved;
  };
  await assert.rejects(h.run(), { name: 'AbortError' });
  assert.equal(h.state.job.nextWindow, 1);
  const resume = runner(h.state.job, ['[3][S01]次の文です。[4]']);
  await resume.run();
  assert.deepEqual(resume.state.reads, [[26, 50]]);
  assert.equal(resume.state.job.cues.length, 2);
});
test('a transferred/detached model input does not destroy the rolling overlap cache', async () => {
  const h = runner();
  const recognize = h.options.engine.transcribe;
  h.options.engine.transcribe = async (samples, ...args) => {
    const length = samples.length;
    structuredClone(samples, { transfer: [samples.buffer] });
    return recognize(new Float32Array(length), ...args);
  };
  await h.run();
  assert.deepEqual(h.state.reads, [
    [0, 30],
    [30, 50]
  ]);
});
test('an ambiguous seam persists both hypotheses, repairs the union, and anchors to accepted IDs', async () => {
  const first = '[1][S01]確定した文章です。[2][25][S01]境界の発言です。[29]';
  const second = '[0][S01]違う認識です。[3][4][S01]次の文です。[5]';
  const repair =
    '[1][S01]確定した文章です。[2][25][S01]境界の発言です。[29][30][S01]次の文です。[31]';
  const h = runner(legacyProgressive(50), [first, second, repair]);
  await h.run();
  const boundary = h.state.writes.find((j) => j.progressive.failedSeam);
  assert.equal(boundary.nextWindow, 1);
  assert.equal(boundary.cues.length, 1);
  assert.equal(boundary.progressive.tail[0].text, '境界の発言です。');
  assert.equal(boundary.progressive.failedSeam.cues[0].text, '違う認識です。');
  assert.deepEqual(h.state.inferences, [30 * SR, 24 * SR, 50 * SR]);
  assert.deepEqual(
    h.state.job.cues.map((c) => c.text),
    ['確定した文章です。', '境界の発言です。', '次の文です。']
  );
  assert.equal(h.state.job.cues[0].id, 'w0/cue-0');
  assert.equal(h.state.job.progressive.windows[1].repairStartSample, 0);
});
test('unanchored repair fails without silent deletion and resume retries only the saved seam', async () => {
  const first = '[1][S01]確定した文章です。[2][25][S01]境界の発言です。[29]';
  const second = '[0][S01]違う認識です。[3]';
  const h = runner(legacyProgressive(50), [first, second, '[1][S01]アンカーが違います。[2]']);
  await assert.rejects(h.run(), /ambiguous transcript boundary/);
  assert.equal(h.state.job.nextWindow, 1);
  assert.ok(h.state.job.progressive.failedSeam);
  const resume = runner(h.state.job, [
    '[1][S01]確定した文章です。[2][25][S01]境界の発言です。[29]'
  ]);
  await resume.run();
  assert.deepEqual(resume.state.reads, [[0, 50]]);
  assert.equal(resume.state.job.cues.length, 2);
});
test('a local draft is incomplete, retains accepted content, and reports coverage independently of silence', () => {
  const j = legacyProgressive(50);
  const w = chooseWindow(j.progressive, 50, pcm(30));
  j.progressive.windows = [w];
  j.nextWindow = 1;
  j.cues = [cue('accepted', 1, 2)];
  const draft = transcriptionDraft(validateJob(j));
  assert.equal(draft.track.complete, false);
  assert.equal(draft.coverage, 28);
  assert.equal(draft.track.cues[0].text, 'accepted');
  assert.equal(draft.track.id, j.id);
});
for (const extra of [2, -1])
  test(`decoder extent mismatch (${extra} samples) cannot advance coverage`, async () => {
    const h = runner(fresh(2));
    h.options.decode = async () => new Float32Array(2 * SR + extra).fill(0.1);
    await assert.rejects(h.run(), /requested interval/);
    assert.equal(h.state.prepares, 0);
  });
test('one rounding sample is trimmed before recognition, never buying another encoder pass', async () => {
  const h = runner(legacyProgressive(30), ['[1][S01]hello[2]']);
  h.options.decode = async () => new Float32Array(30 * SR + 1).fill(0.1);
  await h.run();
  assert.deepEqual(h.state.inferences, [480000]);
});

test('real queue resumes legacy runtime/windows and records mixed callback-port provenance', async () => {
  const range = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'progressive-legacy');
  const reads = [];
  const q = new TranscriptionQueue(
    store,
    'guest',
    {
      async prepare() {},
      async transcribe() {
        return '[3][S01]続きです。[4]';
      },
      dispose() {}
    },
    async (_job, a, b) => {
      reads.push([a, b]);
      return pcm(b - a);
    }
  );
  try {
    const old = fresh(120);
    delete old.progressive;
    await store.putLocal('guest', 'jobs', id, {
      ...old,
      version: 1,
      status: 'paused',
      nextWindow: 1,
      cues: [cue('以前の文章です。', 1, 2)],
      engineRevision: MOSS.engineRevision.replace('manabi-web-v7', 'manabi-web-v3')
    });
    await q.resume(id);
    for (let i = 0; i < 500; i++) {
      if ((await store.local('guest', 'jobs', id)).status === 'complete') break;
      await new Promise((r) => setTimeout(r, 1));
    }
    const [track] = await store.tracks('guest', key);
    assert.ok(track);
    assert.deepEqual(reads, [[58, 120]]);
    assert.equal(track.cues[0].text, '以前の文章です。');
    assert.match(track.provenance.engineRevision, /manabi-web-v3,manabi-web-v7$/);
    assert.equal(track.provenance.windowSeconds, 60);
  } finally {
    await q.dispose();
    await store.close();
    if (range === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = range;
  }
});

test('real queue resumes base-v4 windows and records v4/v5 mixed provenance', async () => {
  const range = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'progressive-base-v4');
  const reads = [];
  const q = new TranscriptionQueue(
    store,
    'guest',
    {
      async prepare() {},
      async transcribe() {
        return '[3][S01]続きです。[4]';
      },
      dispose() {}
    },
    async (_job, a, b) => {
      reads.push([a, b]);
      return pcm(b - a);
    }
  );
  try {
    const old = fresh(120);
    delete old.progressive;
    await store.putLocal('guest', 'jobs', id, {
      ...old,
      version: 1,
      status: 'paused',
      nextWindow: 1,
      cues: [cue('v4までの文章です。', 1, 2)],
      engineRevision: MOSS.engineRevision.replace('manabi-web-v7', 'manabi-web-v4')
    });
    await q.resume(id);
    for (let i = 0; i < 500; i++) {
      if ((await store.local('guest', 'jobs', id)).status === 'complete') break;
      await new Promise((r) => setTimeout(r, 1));
    }
    const [track] = await store.tracks('guest', key);
    assert.ok(track);
    assert.deepEqual(reads, [[58, 120]]);
    assert.match(track.provenance.engineRevision, /manabi-web-v4,manabi-web-v7$/);
  } finally {
    await q.dispose();
    await store.close();
    if (range === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = range;
  }
});

test('resumed progressive-v1 job publishes its durable policy rather than the current default', async () => {
  const range = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'progressive-policy-provenance');
  const q = new TranscriptionQueue(
    store,
    'guest',
    {
      async prepare() {},
      async transcribe() {
        return '[0][S01]以前の方針です。[4]';
      },
      dispose() {}
    },
    async (_job, a, b) => pcm(b - a)
  );
  try {
    const saved = legacyProgressive(10);
    delete saved.ownerId;
    delete saved.leaseUntil;
    await store.putLocal('guest', 'jobs', id, { ...saved, status: 'paused' });
    await q.resume(id);
    for (let i = 0; i < 500; i++) {
      if ((await store.local('guest', 'jobs', id)).status === 'complete') break;
      await new Promise((r) => setTimeout(r, 1));
    }
    const [track] = await store.tracks('guest', key);
    assert.ok(track);
    assert.equal(track.provenance.engine, 'moss-transcribe.cpp/pause-overlap-v1');
  } finally {
    await q.dispose();
    await store.close();
    if (range === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = range;
  }
});

test('saved v2 cues must fall within the window that actually recognized them', () => {
  const job = legacyProgressive(70),
    w = chooseWindow(job.progressive, 70, pcm(30));
  job.nextWindow = 1;
  job.progressive.windows = [w];
  for (const bad of [
    cue('invalid source', 31, 32),
    { ...cue('unrecorded repair', 1, 2), id: 'w0/repair-0' },
    { ...cue('invalid identity', 1, 2), id: 'w0/arbitrary' }
  ]) {
    assert.throws(() => validateJob({ ...job, cues: [bad] }));
  }
  const later = chooseWindow(job.progressive, 70, pcm(30));
  job.nextWindow = 2;
  job.progressive.windows.push(later);
  assert.throws(
    () => validateJob({ ...job, cues: [{ ...cue('too early', 1, 2), id: 'w1/cue-0' }] }),
    /recognition window/
  );
  assert.throws(
    () =>
      validateJob({
        ...job,
        cues: [],
        progressive: { ...job.progressive, tail: [{ ...cue('too early', 1, 2), id: 'w1/cue-0' }] }
      }),
    /tail/
  );
});

test('a pending first-pass hypothesis cannot claim successful repair provenance', () => {
  const job = legacyProgressive(70),
    w = chooseWindow(job.progressive, 70, pcm(30));
  job.nextWindow = 1;
  job.progressive.windows = [w];
  const next = chooseWindow(job.progressive, 70, pcm(30));
  job.progressive.failedSeam = {
    window: { ...next, repairStartSample: 0, repairEndSample: next.endSample },
    cues: []
  };
  assert.throws(() => validateJob(job), /repair provenance/);
});

test('a long held utterance is not dropped when it starts before the next repair window', async () => {
  const h = runner(legacyProgressive(90), [
    '[0][S01]長い発言です。[30]',
    '[0][S01]別の認識です。[30]',
    '[0][S01]全体の長い発言です。[55]',
    '[0][S01]さらに続く発言です。[30]'
  ]);
  await assert.rejects(h.run(), /different window policy/);
  assert.equal(h.state.job.nextWindow, 2);
  assert.equal(h.state.job.progressive.tail[0].start, 0);
  assert.equal(h.state.job.progressive.tail[0].text, '全体の長い発言です。');
  assert.ok(h.state.job.progressive.failedSeam);
  const repair = pendingSeamRepair(h.state.job.progressive);
  assert.equal(repair?.retryable, false);
  const released = structuredClone(h.state.job);
  delete released.ownerId;
  delete released.leaseUntil;
  const failed = validateJob({ ...released, status: 'failed' });
  assert.equal(jobCanResume(failed), false);
  assert.equal(transcriptionDraft(failed).restartRequired, true);
  assert.equal(h.state.inferences.length, 4, 'no repair may silently omit the older held speech');

  const range = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'oversized-seam-resume');
  const queue = new TranscriptionQueue(
    store,
    'guest',
    {
      async prepare() {
        throw Error('must not prepare');
      },
      async transcribe() {
        throw Error('must not infer');
      },
      dispose() {}
    },
    async () => {
      throw Error('must not decode');
    }
  );
  try {
    await store.putLocal('guest', 'jobs', id, failed);
    await assert.rejects(queue.resume(id), /cannot be retried safely/);
    assert.equal((await store.local('guest', 'jobs', id)).status, 'failed');
  } finally {
    await queue.dispose();
    await store.close();
    if (range === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = range;
  }
});

test('ordinary saved seam failures remain retryable', () => {
  const job = legacyProgressive(50),
    first = chooseWindow(job.progressive, 50, pcm(30));
  job.progressive.windows = [first];
  job.nextWindow = 1;
  job.progressive.tail = [cue('境界です。', 25, 29)];
  const next = chooseWindow(job.progressive, 50, pcm(24));
  job.progressive.failedSeam = {
    window: next,
    cues: [cue('別の認識です。', 26, 30, 'w1/cue-0')]
  };
  const released = validateJob(job);
  delete released.ownerId;
  delete released.leaseUntil;
  const failed = validateJob({ ...released, status: 'failed' });
  assert.equal(pendingSeamRepair(failed.progressive).retryable, true);
  assert.equal(jobCanResume(failed), true);
  assert.equal(transcriptionDraft(failed).restartRequired, false);
});

test('legacy publication retry without new inference keeps its original runtime provenance', async () => {
  const range = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'legacy-publication-only');
  const legacy = MOSS.engineRevision.replace('manabi-web-v7', 'manabi-web-v3');
  const q = new TranscriptionQueue(
    store,
    'guest',
    {
      async prepare() {
        throw Error('must not prepare');
      },
      async transcribe() {
        throw Error('must not infer');
      },
      dispose() {}
    },
    async () => {
      throw Error('must not decode');
    }
  );
  try {
    const old = fresh(20);
    delete old.progressive;
    await store.putLocal('guest', 'jobs', id, {
      ...old,
      version: 1,
      status: 'paused',
      nextWindow: 1,
      cues: [cue('以前の文章です。', 1, 2)],
      engineRevision: legacy
    });
    await q.resume(id);
    for (let i = 0; i < 500; i++) {
      if ((await store.local('guest', 'jobs', id)).status === 'complete') break;
      await new Promise((r) => setTimeout(r, 1));
    }
    const [track] = await store.tracks('guest', key);
    assert.equal(track?.provenance.engineRevision, legacy);
  } finally {
    await q.dispose();
    await store.close();
    if (range === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = range;
  }
});

test('atomic publication rejects a different valid v2 cut plan with the same cue text', async () => {
  const range = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = RangeDouble;
  const store = new MediaStore(new TransactionFactory(), 'progressive-publication-cas');
  try {
    const a = legacyProgressive(50);
    a.nextWindow = 2;
    a.progressive.windows = [
      { index: 0, startSample: 0, endSample: 28 * SR, coreStartSample: 0, coreEndSample: 26 * SR },
      {
        index: 1,
        startSample: 24 * SR,
        endSample: 50 * SR,
        coreStartSample: 26 * SR,
        coreEndSample: 50 * SR
      }
    ];
    const b = structuredClone(a);
    b.progressive.windows = [
      { index: 0, startSample: 0, endSample: 30 * SR, coreStartSample: 0, coreEndSample: 28 * SR },
      {
        index: 1,
        startSample: 26 * SR,
        endSample: 50 * SR,
        coreStartSample: 28 * SR,
        coreEndSample: 50 * SR
      }
    ];
    await store.putLocal('guest', 'jobs', id, validateJob(a));
    const track = { ...transcriptionDraft(b).track, complete: true };
    const completed = validateJob({ ...b, status: 'complete', completedAt: 1 });
    await assert.rejects(
      store.saveTrack('guest', track, { ownerId: a.ownerId, job: completed }),
      /durable checkpoint/
    );
    assert.equal((await store.local('guest', 'jobs', id)).status, 'running');
    assert.equal((await store.tracks('guest', key)).length, 0);
  } finally {
    await store.close();
    if (range === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = range;
  }
});
