/** Actual player controller checks; mock media source and no inference. */
const check = (value, message) => {
  if (!value) throw Error(message);
};
export function cases({ VideoPlayer, newSparseState, transcriptionDraft }) {
  async function harness(run) {
    const key = 'content:' + 'e'.repeat(64);
    const sparse = newSparseState(52);
    sparse.windows[0] = {
      cues: [{ id: 'w0/cue-0', start: 2, end: 3, text: '日本語' }],
      inferenceMs: 1700
    };
    const job = {
      id: '12345678-1234-4234-8234-123456789abc',
      version: 3,
      sparse,
      mediaKey: key,
      language: 'ja',
      audioTrack: '1',
      duration: 52,
      status: 'running',
      nextWindow: 1,
      cues: sparse.windows[0].cues.slice(),
      modelSha256: 'a'.repeat(64),
      engineRevision: 'scripted',
      createdAt: 1
    };
    const player = new VideoPlayer({
      scope: 'guest',
      key,
      source: { name: 'test.mp4', playback: () => ({ url: '', release() {} }) },
      store: { async local() {}, async putLocal() {} },
      onError() {},
      onGenerate() {},
      onImport() {},
      onExport() {}
    });
    document.body.append(player.root);
    try {
      player.generationProgress(job);
      return await run({ player, job, draft: () => transcriptionDraft(job) });
    } finally {
      await player.dispose();
    }
  }
  return [
    {
      name: 'playback ticks never reread source hypotheses or rehash visible captions',
      run: () =>
        harness(({ player, job }) => {
          const before = player.sparsePlayback;
          Object.defineProperty(job.sparse, 'windows', {
            get() {
              throw Error('tick reread windows');
            }
          });
          Object.defineProperty(job.sparse, 'repairs', {
            get() {
              throw Error('tick reread repairs');
            }
          });
          for (let i = 0; i < 50; i++) {
            player.waitForCaptions = true;
            player.updateBuffering();
          }
          check(player.sparsePlayback === before, 'replaced notification snapshot');
          check(player.waitForCaptions, 'unloaded caption pages released wait');
          return { ticks: 50 };
        })
    },
    {
      name: 'mutated same-object progress refreshes snapshot and waits for the corresponding draft',
      run: () =>
        harness(({ player, job, draft }) => {
          const before = player.sparsePlayback.cueDigest;
          player.waitForCaptions = true;
          player.updateBuffering();
          check(player.waitForCaptions, 'missing draft released wait');
          player.setDrafts([draft()]);
          check(!player.waitForCaptions, 'matching draft did not release wait');
          job.sparse.windows[0].cues[0].text = '新しい日本語';
          job.sparse.windows[0].inferenceMs = 9200;
          player.generationProgress(job);
          check(player.sparsePlayback.cueDigest !== before, 'identity cache was stale');
          check(player.sparsePlayback.totalMs === 9200, 'stale elapsed statistics');
          player.waitForCaptions = true;
          player.updateBuffering();
          check(player.waitForCaptions, 'old draft released new checkpoint');
          player.setDrafts([draft()]);
          check(!player.waitForCaptions, 'new draft did not release wait');
          return { notifiedSameObject: true };
        })
    },
    {
      name: 'another video cannot invalidate snapshot; compact completion waits for publication',
      run: () =>
        harness(({ player, job }) => {
          const before = player.sparsePlayback;
          player.generationProgress({ ...job, mediaKey: 'content:' + 'f'.repeat(64) });
          check(player.sparsePlayback === before, 'foreign progress replaced snapshot');
          player.waitForCaptions = true;
          player.generationProgress({ ...job, status: 'complete', sparse: undefined, cues: [] });
          check(player.sparsePlayback === undefined, 'retained full sparse snapshot');
          check(player.waitForCaptions, 'compact completion released publication wait');
          check(
            player.bufferStatus.textContent.includes('Finalizing captions'),
            'missing finalizing state'
          );
          return { foreignIgnored: true, compactWait: true };
        })
    }
  ];
}

/** Current snapshot vs retained uncached reference functions on one Chromium page.
 * All results are checked before measurement; no timing threshold affects pass/fail.
 */
export async function benchmark(m) {
  const summary = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { medianMs: sorted[Math.floor(sorted.length / 2)], samplesMs: values };
  };
  const output = {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    rounds: 7,
    ticksPerNotification: 20,
    notes:
      'Synthetic controller work, not MOSS inference. Interleaved order. Includes one snapshot and draft digest per 20 ticks.',
    playback: [],
    audioProof: []
  };
  for (const duration of [1800, 7200]) {
    const state = m.newSparseState(duration);
    for (let i = 0; i < state.windows.length - 1; i++) {
      const b = m.sparseBounds(i, duration),
        cues = [];
      for (let t = Math.ceil(b.start / 3) * 3; t + 0.9 <= b.end; t += 3)
        cues.push({
          id: `w${i}/cue-${t}`,
          start: t,
          end: t + 0.9,
          text: `これは字幕${t}の文章です。`,
          speaker: `w${i}/S01`
        });
      state.windows[i] = { cues, inferenceMs: 36000 };
    }
    const draft = m.safeSparseCues(state, duration);
    const oldQuery = (p) => ({
      lead: m.sparseLead(state, duration, p),
      missing: m.sparseMissingWindowsForLead(state, duration, p, 22),
      digest: m.cueDigest(m.safeSparseCues(state, duration)),
      draft: m.cueDigest(draft)
    });
    const create = () => ({
      s: m.sparsePlaybackSnapshot(state, duration),
      draft: m.cueDigest(draft)
    });
    const newQuery = ({ s, draft }, p) => ({
      lead: s.lead(p),
      missing: s.missingWindows(p, 22),
      digest: s.cueDigest,
      draft
    });
    const prepared = create();
    for (const p of [0, 24, 28, 500, duration - 30])
      check(
        JSON.stringify(oldQuery(p)) === JSON.stringify(newQuery(prepared, p)),
        'benchmark output changed'
      );
    const tasks = {
      baseline: () => {
        for (let i = 0; i <= 20; i++) oldQuery(500 + i / 4);
      },
      current: () => {
        const s = create();
        for (let i = 0; i <= 20; i++) newQuery(s, 500 + i / 4);
      }
    };
    tasks.baseline();
    tasks.current();
    const timings = { baseline: [], current: [] };
    for (let n = 0; n < 7; n++)
      for (const name of n % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
        const start = performance.now();
        tasks[name]();
        timings[name].push(performance.now() - start);
      }
    output.playback.push({
      durationSeconds: duration,
      cues: draft.length,
      baseline: summary(timings.baseline),
      current: summary(timings.current)
    });
  }
  check(typeof crypto.subtle?.digest === 'function', 'native Web Crypto absent');
  for (const seconds of [30, 60]) {
    const pcm = Float32Array.from({ length: seconds * 16000 }, (_, i) => Math.sin(i)),
      signal = new AbortController().signal,
      expected = m.audioProof(0, seconds, pcm);
    await m.audioProofAsync(0, seconds, pcm, signal);
    const timings = { baseline: [], current: [] },
      blocking = { baseline: [], current: [] };
    for (let n = 0; n < 7; n++)
      for (const name of n % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
        const start = performance.now(),
          pending =
            name === 'baseline'
              ? m.audioProof(0, seconds, pcm)
              : m.audioProofAsync(0, seconds, pcm, signal),
          returned = performance.now(),
          result = await pending;
        timings[name].push(performance.now() - start);
        blocking[name].push(returned - start);
        check(JSON.stringify(result) === JSON.stringify(expected), 'native digest changed');
      }
    output.audioProof.push({
      seconds,
      baseline: summary(timings.baseline),
      current: summary(timings.current),
      synchronousCallTime: {
        baseline: summary(blocking.baseline),
        current: summary(blocking.current)
      }
    });
  }
  return output;
}
