import process from 'node:process';
import test from 'node:test';
import assert from 'node:assert/strict';
const {
  ANALYSIS_WINDOW_SECONDS,
  SWIFT_F0_FRAME_SECONDS,
  SAMPLE_INTERVAL_MS,
  measurementFromSwiftF0,
  measurementsFromSwiftF0,
  resampleForSwiftF0
} = await import(new URL('analysis.mjs', process.env.PITCH_COMPILED));
const { appendPoint, pitchPaths, initialPitchState } = await import(
  new URL('model.mjs', process.env.PITCH_COMPILED)
);
const { PitchController } = await import(new URL('controller.mjs', process.env.PITCH_COMPILED));
const { createPitchController } = await import(new URL('browser.mjs', process.env.PITCH_COMPILED));
const { runSwiftF0Inference, swiftF0ModelGain } = await import(
  new URL('swift-f0-runtime.mjs', process.env.PITCH_COMPILED)
);

test('pitch accepts an 88.2 kHz native fallback with enough SwiftF0 context', () => {
  const original = globalThis.AudioContext;
  const requested = [];
  globalThis.AudioContext = class {
    constructor(options) {
      requested.push(options?.sampleRate ?? null);
      if (options) throw new DOMException('Unsupported output rate', 'NotSupportedError');
      this.sampleRate = 88200;
    }
    close() {
      throw new Error('accepted context must not be closed');
    }
  };
  try {
    const context = createPitchController(() => {}).environment.createContext();
    assert.equal(context.sampleRate, 88200);
    assert.deepEqual(requested, [48000, 44100, null]);
  } finally {
    globalThis.AudioContext = original;
  }
});

test('pitch rejects a native context too fast for the analyser window', () => {
  const original = globalThis.AudioContext;
  const requested = [];
  let closed = 0;
  globalThis.AudioContext = class {
    constructor(options) {
      requested.push(options?.sampleRate ?? null);
      if (options) throw new DOMException('Unsupported output rate', 'NotSupportedError');
      this.sampleRate = 96000;
    }
    close() {
      closed++;
      return Promise.resolve();
    }
  };
  try {
    assert.throws(
      () => createPitchController(() => {}).environment.createContext(),
      /audio context at or below/
    );
    assert.deepEqual(requested, [48000, 44100, null]);
    assert.equal(closed, 1);
  } finally {
    globalThis.AudioContext = original;
  }
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const tone = (hz, rate = 48000, seconds = ANALYSIS_WINDOW_SECONDS, amplitude = 0.7) =>
  Float32Array.from(
    { length: Math.ceil(rate * seconds) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate)
  );

for (const rate of [8000, 16000, 44100, 48000, 96000, 192000]) {
  test(`SwiftF0 resampling keeps a finite 16 kHz window from ${rate} Hz`, () => {
    const result = resampleForSwiftF0(tone(220, rate), rate);
    assert.ok(result.length > 1000);
    assert.ok([...result].every(Number.isFinite));
    assert.ok(Math.abs(result.length / 16000 - ANALYSIS_WINDOW_SECONDS) < 0.002);
  });
}
test('SwiftF0 batches stable frames at 32 ms spacing while retaining future context', () => {
  const samples = tone(220, 16000);
  const frameCount = Math.floor(samples.length / 256);
  const pitch = new Float64Array(frameCount).fill(220);
  const confidence = new Float32Array(frameCount).fill(0.9);
  const results = measurementsFromSwiftF0(samples, pitch, confidence);
  assert.ok(results.length >= 10);
  assert.ok(results[0].offsetSeconds >= 11 * SWIFT_F0_FRAME_SECONDS);
  assert.ok(results.at(-1).offsetSeconds <= ANALYSIS_WINDOW_SECONDS - 0.15);
  for (let index = 1; index < results.length; index++) {
    assert.ok(Math.abs(results[index].offsetSeconds - results[index - 1].offsetSeconds - 0.032) < 1e-9);
  }
});
test('live inference cadence is aligned to multiple emitted pitch frames', () => {
  assert.equal(SAMPLE_INTERVAL_MS, 256);
  assert.equal(SAMPLE_INTERVAL_MS % 32, 0);
});

test('SwiftF0 frame selection retains its future-context margin and speech bounds', () => {
  const samples = tone(220, 16000);
  const frameCount = Math.floor(samples.length / 256);
  const pitch = new Float64Array(frameCount).fill(220);
  const confidence = new Float32Array(frameCount).fill(0.9);
  const result = measurementFromSwiftF0(samples, pitch, confidence);
  assert.equal(result.hz, 220);
  assert.ok(result.confidence > 0.5 && result.amplitude > 0);
  assert.ok(result.offsetSeconds <= result.windowSeconds - 0.15);
  assert.ok(Math.abs((result.offsetSeconds / SWIFT_F0_FRAME_SECONDS) % 1) < 1e-8);
});
test('SwiftF0 runtime copies results and disposes every native tensor', async () => {
  let live = 0;
  class Tensor {
    constructor(type, data, dims) {
      Object.assign(this, { type, data, dims, disposed: false });
      live++;
    }
    dispose() {
      assert.equal(this.disposed, false);
      this.disposed = true;
      live--;
    }
  }
  const samples = tone(220, 16000);
  const expected = Math.floor(samples.length / 256);
  const session = {
    async run() {
      return {
        pitch: new Tensor('float32', new Float32Array(expected).fill(220), [1, expected]),
        confidence: new Tensor('float32', new Float32Array(expected).fill(0.9), [1, expected])
      };
    }
  };
  const result = await runSwiftF0Inference(
    session,
    (type, data, dims) => new Tensor(type, data, dims),
    samples,
    85,
    520
  );
  assert.equal(result.pitch.length, expected);
  assert.equal(result.pitch[0], 220);
  assert.ok(Math.abs(result.confidence[0] - 0.9) < 1e-6);
  assert.equal(live, 0, 'all input and output tensors must be disposed after each inference');
});

test('SwiftF0 runtime releases feeds after failure and rejects malformed model output', async () => {
  let live = 0;
  class Tensor {
    constructor(type, data, dims) {
      Object.assign(this, { type, data, dims });
      live++;
    }
    dispose() {
      live--;
    }
  }
  const samples = tone(220, 16000);
  await assert.rejects(
    runSwiftF0Inference(
      { run: async () => { throw new Error('inference failed'); } },
      (type, data, dims) => new Tensor(type, data, dims),
      samples,
      85,
      520
    ),
    /inference failed/
  );
  assert.equal(live, 0);

  const expected = Math.floor(samples.length / 256);
  await assert.rejects(
    runSwiftF0Inference(
      {
        run: async () => ({
          pitch: new Tensor('float32', new Float32Array(expected - 1).fill(220), [1, expected - 1]),
          confidence: new Tensor('float32', new Float32Array(expected).fill(0.9), [1, expected])
        })
      },
      (type, data, dims) => new Tensor(type, data, dims),
      samples,
      85,
      520
    ),
    /malformed frame counts/
  );
  assert.equal(live, 0);
});

test('partial tensor-construction failure releases tensors already created', async () => {
  let live = 0;
  let created = 0;
  class Tensor {
    constructor(type, data, dims) {
      Object.assign(this, { type, data, dims });
      live++;
    }
    dispose() {
      live--;
    }
  }
  await assert.rejects(
    runSwiftF0Inference(
      { run: async () => ({}) },
      (type, data, dims) => {
        created++;
        if (created === 2) throw new Error('tensor allocation failed');
        return new Tensor(type, data, dims);
      },
      tone(220, 16000),
      85,
      520
    ),
    /tensor allocation failed/
  );
  assert.equal(live, 0);
});

test('very quiet non-silent windows are lifted only for model inference', () => {
  assert.equal(swiftF0ModelGain(new Float32Array(100).fill(0)), 1);
  assert.equal(swiftF0ModelGain(new Float32Array(100).fill(0.1)), 1);
  const gain = swiftF0ModelGain(new Float32Array(100).fill(0.005));
  assert.ok(gain > 1);
  assert.ok(Math.abs(0.005 * gain - 0.5) < 1e-6);
});

test('low confidence, silence and out-of-band SwiftF0 frames are unvoiced', () => {
  const samples = tone(220, 16000);
  const pitch = new Float64Array(24).fill(220);
  const confidence = new Float32Array(24).fill(0.9);
  confidence[13] = 0.1;
  assert.equal(measurementFromSwiftF0(samples, pitch, confidence).hz, null);
  assert.equal(
    measurementFromSwiftF0(
      new Float32Array(samples.length),
      new Float64Array(24).fill(220),
      new Float32Array(24).fill(1)
    ).hz,
    null
  );
  pitch[13] = 700;
  confidence[13] = 1;
  assert.equal(measurementFromSwiftF0(samples, pitch, confidence).hz, null);
});
test('a preceding voiced hop cannot authorize pitch in a silent current hop', () => {
  const frameCount = 24;
  const selected = frameCount - 1 - 10;
  const samples = new Float32Array(frameCount * 256);
  samples.fill(0.5, (selected - 1) * 256, selected * 256);
  const pitch = new Float64Array(frameCount).fill(220);
  const confidence = new Float32Array(frameCount).fill(1);
  const result = measurementFromSwiftF0(samples, pitch, confidence);
  assert.equal(result.hz, null);
  assert.ok(result.rms > 0, 'the centered level window still sees the preceding hop');
  assert.equal(result.amplitude > 0, true);
});

test('empty model output and malformed source rates fail closed', () => {
  assert.equal(measurementFromSwiftF0(new Float32Array(32), [], []).hz, null);
  for (const rate of [NaN, Infinity, 0, 7999, 192001])
    assert.equal(resampleForSwiftF0(tone(220), rate).length, 0);
});
test('history is bounded in time and points, and seeks start a new contour', () => {
  let points = [];
  for (let i = 0; i < 10000; i++)
    points = appendPoint(points, { time: i * 0.001, hz: 220, amplitude: 0.5 });
  assert.equal(points.length, 400);
  assert.deepEqual(appendPoint(points, { time: 1, hz: null, amplitude: 0 }), [
    { time: 1, hz: null, amplitude: 0 }
  ]);
  assert.equal(appendPoint(points, { time: 30, hz: 220, amplitude: 1 }).length, 1);
});
test('pitch rendering breaks at unvoiced frames and long gaps, keeps amplitudes finite', () => {
  const points = [
    { time: 1, hz: 220, amplitude: 0.3 },
    { time: 1.04, hz: 240, amplitude: 1 },
    { time: 1.08, hz: null, amplitude: 0 },
    { time: 1.12, hz: 220, amplitude: 0.7 },
    { time: 4, hz: 330, amplitude: 1 }
  ];
  const paths = pitchPaths(points, 4);
  assert.equal((paths.pitch.match(/M/g) || []).length, 3);
  assert.equal((paths.pitch.match(/L/g) || []).length, 1);
  assert.ok(!/NaN|Infinity/.test(paths.waveform + paths.pitch));
  assert.deepEqual(pitchPaths([], 0), { waveform: '', pitch: '' });
});

function fixture(options = {}) {
  let state = initialPitchState(),
    id = 0;
  const workers = [],
    frames = new Map(),
    timers = new Map(),
    sources = [];
  const context = {
    state: 'running',
    sampleRate: 48000,
    currentTime: 0,
    destination: {},
    closes: 0,
    resumes: 0,
    resume() {
      this.resumes++;
      return options.resume?.() ?? Promise.resolve();
    },
    close() {
      this.closes++;
      this.state = 'closed';
      return Promise.resolve();
    },
    createMediaElementSource(audio) {
      assert.ok(
        !sources.some((source) => source.audio === audio),
        'capture the same element only once'
      );
      const source = {
        audio,
        connections: new Set(),
        connect(target) {
          this.connections.add(target);
        },
        disconnect(target) {
          if (target) assert.ok(this.connections.delete(target));
          else this.connections.clear();
        }
      };
      sources.push(source);
      return source;
    },
    createAnalyser() {
      return {
        fftSize: 0,
        getFloatTimeDomainData(samples) {
          samples.set(tone(220, 48000, samples.length / 48000));
        }
      };
    }
  };
  let contexts = 0;
  const controller = new PitchController(
    {
      createContext() {
        contexts++;
        return context;
      },
      createWorker() {
        if (options.workerThrows) throw Error('blocked');
        const worker = {
          sent: [],
          terminated: false,
          postMessage(message) {
            this.sent.push(message);
          },
          terminate() {
            this.terminated = true;
          }
        };
        workers.push(worker);
        return worker;
      },
      requestFrame(callback) {
        frames.set(++id, callback);
        return id;
      },
      cancelFrame(id) {
        frames.delete(id);
      },
      setTimer(callback, delay) {
        timers.set(++id, { callback, delay });
        return id;
      },
      clearTimer(id) {
        timers.delete(id);
      }
    },
    (value) => {
      state = value;
    }
  );
  function audio() {
    const a = new EventTarget();
    return Object.assign(a, {
      paused: true,
      ended: false,
      seeking: false,
      currentTime: 1,
      readyState: 4,
      playbackRate: 1
    });
  }
  const a = audio();
  controller.setAudio(a);
  controller.setVisible(true);
  return {
    controller,
    a,
    audio,
    context,
    workers,
    frames,
    timers,
    sources,
    get state() {
      return state;
    },
    get contexts() {
      return contexts;
    },
    ready() {
      workers.at(-1).onmessage({ data: { type: 'ready' } });
    },
    result(
      worker = workers.at(-1),
      result = {
        hz: 220,
        amplitude: 0.5,
        confidence: 1,
        rms: 0.5,
        offsetSeconds: 0.32,
        windowSeconds: ANALYSIS_WINDOW_SECONDS
      }
    ) {
      worker.onmessage({ data: { type: 'result', id: worker.sent.at(-1).id, result } });
    },
    play() {
      a.paused = false;
      a.dispatchEvent(new Event('play'));
    },
    frame(now = 700) {
      context.currentTime = now / 1000;
      const queued = [...frames.values()];
      frames.clear();
      queued.forEach((callback) => callback(now));
    },
    timer(delay) {
      const found = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(found, `timer ${delay}`);
      timers.delete(found[0]);
      found[1].callback();
    }
  };
}
async function running(f = fixture()) {
  f.controller.setEnabled(true);
  f.ready();
  await flush();
  f.play();
  await flush();
  return f;
}
test('disabled by default: no context, worker or audio capture', () => {
  const f = fixture();
  f.play();
  f.frame();
  assert.equal(f.state.enabled, false);
  assert.equal(f.contexts, 0);
  assert.equal(f.workers.length, 0);
  f.controller.dispose();
});
test('loading waits for the actual worker handshake and audio resume', async () => {
  const f = fixture();
  f.controller.setEnabled(true);
  await flush();
  assert.equal(f.state.status, 'loading');
  assert.equal(f.sources.length, 0);
  f.ready();
  assert.equal(f.state.status, 'ready');
  assert.equal(f.sources.length, 1);
  f.controller.dispose();
});
test('stale worker readiness after turning off cannot capture audio', async () => {
  const f = fixture();
  f.controller.setEnabled(true);
  f.controller.setEnabled(false);
  f.ready();
  await flush();
  assert.equal(f.state.status, 'off');
  assert.equal(f.sources.length, 0);
  assert.ok(f.workers[0].terminated);
  f.controller.dispose();
});
test('show/hide and off/on stop analysis but retain the playback destination', async () => {
  const f = await running();
  const source = f.sources[0];
  f.controller.setVisible(false);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  assert.ok(f.workers[0].terminated);
  assert.deepEqual([...source.connections], [f.context.destination]);
  assert.equal(f.context.closes, 0);
  f.controller.setVisible(true);
  f.ready();
  await flush();
  f.controller.setEnabled(false);
  assert.deepEqual([...source.connections], [f.context.destination]);
  f.controller.setEnabled(true);
  f.ready();
  await flush();
  assert.equal(f.sources.length, 1);
  assert.equal(f.contexts, 1);
  f.controller.dispose();
  assert.equal(f.context.closes, 1);
  assert.equal(source.connections.size, 0);
});
test('overlapping result batches append only newly stable timestamps', async () => {
  const f = await running();
  f.frame(700);
  const worker = f.workers[0];
  const id1 = worker.sent.at(-1).id;
  worker.onmessage({
    data: {
      type: 'result',
      id: id1,
      results: [
        { hz: 220, amplitude: 0.4, confidence: 1, rms: 0.3, offsetSeconds: 0.256, windowSeconds: ANALYSIS_WINDOW_SECONDS },
        { hz: 221, amplitude: 0.4, confidence: 1, rms: 0.3, offsetSeconds: 0.288, windowSeconds: ANALYSIS_WINDOW_SECONDS }
      ]
    }
  });
  assert.equal(f.state.points.length, 2);
  const previousLast = f.state.points.at(-1).time;

  f.a.currentTime += 0.256;
  f.frame(1000);
  const id2 = worker.sent.at(-1).id;
  worker.onmessage({
    data: {
      type: 'result',
      id: id2,
      results: [
        // This maps to the previous window's last absolute timestamp.
        { hz: 221, amplitude: 0.4, confidence: 1, rms: 0.3, offsetSeconds: 0.032, windowSeconds: ANALYSIS_WINDOW_SECONDS },
        { hz: 222, amplitude: 0.4, confidence: 1, rms: 0.3, offsetSeconds: 0.064, windowSeconds: ANALYSIS_WINDOW_SECONDS }
      ]
    }
  });
  assert.ok(f.state.points.length >= 3);
  assert.ok(f.state.points.at(-1).time > previousLast);
  f.controller.dispose();
});

test('bounded work: one in-flight request, timestamp at selected frame, no duplicate stalled samples', async () => {
  const f = await running();
  f.frame(700);
  const worker = f.workers[0];
  assert.equal(worker.sent.length, 1);
  assert.equal(worker.sent[0].samples.length, Math.ceil(48000 * ANALYSIS_WINDOW_SECONDS));
  f.a.currentTime += 0.1;
  f.frame(800);
  assert.equal(worker.sent.length, 1);
  f.result();
  assert.ok(
    Math.abs(f.state.points[0].time - (1 - worker.sent[0].samples.length / 48000 + 0.32)) < 1e-9
  );
  f.frame(1100);
  assert.equal(worker.sent.length, 2);
  f.result();
  f.frame(1000);
  assert.equal(worker.sent.length, 2);
  f.controller.dispose();
});
test('seeking discards old results and even a delivered cancelled animation callback', async () => {
  const f = await running();
  f.frame();
  const staleFrame = [...f.frames.values()][0];
  f.a.currentTime = 20;
  f.a.seeking = true;
  f.a.dispatchEvent(new Event('seeking'));
  f.result();
  assert.equal(f.state.points.length, 0);
  f.a.seeking = false;
  f.a.dispatchEvent(new Event('seeked'));
  staleFrame(700);
  assert.equal(f.frames.size, 1);
  f.frame(1400);
  f.result();
  assert.equal(f.state.points.length, 1);
  assert.ok(f.state.points[0].time > 19);
  f.controller.dispose();
});
test('replacement audio retires only the old route and rejects late callbacks', async () => {
  const f = await running();
  f.frame();
  const oldWorker = f.workers[0];
  const newer = f.audio();
  f.controller.setAudio(newer);
  f.result(oldWorker);
  assert.equal(f.state.points.length, 0);
  assert.equal(f.sources[0].connections.size, 0);
  f.ready();
  await flush();
  assert.equal(f.sources.length, 2);
  f.controller.dispose();
  newer.dispatchEvent(new Event('play'));
  assert.equal(f.frames.size, 0);
});
test('load and result timeouts expose retry without closing the output route', async () => {
  const f = fixture();
  f.controller.setEnabled(true);
  f.timer(15000);
  assert.equal(f.state.status, 'error');
  f.controller.retry();
  f.ready();
  await flush();
  f.play();
  await flush();
  f.frame();
  f.timer(5000);
  assert.equal(f.state.status, 'error');
  assert.equal(f.context.closes, 0);
  assert.deepEqual([...f.sources[0].connections], [f.context.destination]);
  f.controller.dispose();
});
test('bad worker measurements fail safely, and a retry can recover', async () => {
  const f = await running();
  f.frame();
  f.result(undefined, { hz: NaN, amplitude: 1 });
  assert.equal(f.state.status, 'error');
  assert.equal(f.state.points.length, 0);
  f.controller.retry();
  f.ready();
  await flush();
  assert.equal(f.state.status, 'ready');
  f.controller.dispose();
});
test('worker construction failure also handles a rejected resume promise', async () => {
  const f = fixture({ workerThrows: true, resume: () => Promise.reject(Error('not allowed')) });
  f.controller.setEnabled(true);
  await flush();
  assert.equal(f.state.status, 'error');
  assert.equal(f.sources.length, 0);
  f.controller.dispose();
});
test('paused playback stops sampling; native Play still resumes retained routing while pitch is off', async () => {
  const f = await running();
  f.a.paused = true;
  f.a.dispatchEvent(new Event('pause'));
  assert.equal(f.frames.size, 0);
  f.controller.setEnabled(false);
  const count = f.context.resumes;
  f.play();
  await flush();
  assert.equal(f.context.resumes, count + 1);
  assert.equal(f.frames.size, 0);
  f.controller.dispose();
  f.controller.dispose();
  assert.equal(f.context.closes, 1);
});

test('pause drops a pending result and watchdog while retaining the completed trace', async () => {
  const f = await running();
  f.frame(700);
  f.result();
  const completed = f.state.points;
  f.a.currentTime += 0.1;
  f.frame(1000);
  assert.equal(f.workers[0].sent.length, 2, 'pause test must retire an active inference');
  f.a.paused = true;
  f.a.dispatchEvent(new Event('pause'));
  assert.equal(f.state.activity, 'paused');
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  f.result();
  assert.deepEqual(f.state.points, completed);
  f.play();
  await flush();
  f.a.currentTime += 0.1;
  f.frame(1700);
  f.result();
  assert.equal(f.state.points.length, 2);
  assert.equal(f.state.points[1].breakBefore, true);
  assert.equal((pitchPaths(f.state.points, f.state.time).pitch.match(/M/g) || []).length, 2);
  f.controller.dispose();
});
test('first subtitle synchronization establishes a cue boundary even when speech is active', async () => {
  const f = await running();
  f.a.currentTime = 3;
  f.controller.setSpeechActive(true, 3);
  f.frame(100);
  const worker = f.workers[0];
  assert.equal(worker.sent.length, 0, 'first active sync must wait for fresh future context');
  f.a.currentTime = 3.2;
  f.frame(200);
  assert.equal(worker.sent.length, 1);
  const id = worker.sent[0].id;
  worker.onmessage({
    data: {
      type: 'result',
      id,
      results: [
        { hz: 110, amplitude: 0.3, confidence: 1, rms: 0.2, offsetSeconds: 0.1, windowSeconds: ANALYSIS_WINDOW_SECONDS },
        { hz: 220, amplitude: 0.3, confidence: 1, rms: 0.2, offsetSeconds: 0.6, windowSeconds: ANALYSIS_WINDOW_SECONDS }
      ]
    }
  });
  assert.equal(f.state.points.length, 1);
  assert.ok(f.state.points.every((point) => point.time >= 2.996));
  f.controller.dispose();
});

test('active cue boundary can advance without requiring a subtitle gap', async () => {
  const f = await running();
  f.a.currentTime = 4;
  f.controller.setSpeechActive(true, 4, 3.5);
  f.controller.setSpeechActive(true, 4.2, 4.15);
  f.a.currentTime = 4.2;
  f.frame(200);
  const worker = f.workers[0];
  const id = worker.sent.at(-1).id;
  worker.onmessage({
    data: {
      type: 'result',
      id,
      results: [
        { hz: 180, amplitude: 0.4, confidence: 1, rms: 0.3, offsetSeconds: 0.2, windowSeconds: ANALYSIS_WINDOW_SECONDS },
        { hz: 220, amplitude: 0.4, confidence: 1, rms: 0.3, offsetSeconds: 0.6, windowSeconds: ANALYSIS_WINDOW_SECONDS }
      ]
    }
  });
  assert.equal(f.state.points.length, 1);
  assert.ok(f.state.points.every((point) => point.time >= 4.146));
  f.controller.dispose();
});

test('subtitle gaps stop inference and cue restart discards pre-cue batch frames', async () => {
  const f = await running();
  f.frame(700);
  const beforeGap = f.workers[0].sent.length;
  f.controller.setSpeechActive(false, 1.05);
  assert.equal(f.frames.size, 0);
  f.a.currentTime = 1.25;
  f.frame(1000);
  assert.equal(f.workers[0].sent.length, beforeGap, 'known transcript gaps must not run SwiftF0');

  f.controller.setSpeechActive(true, 1.25);
  const worker = f.workers[0];
  f.a.currentTime = 1.35;
  f.frame(1100);
  assert.equal(worker.sent.length, beforeGap, 'cue restart must wait for future context');
  f.a.currentTime = 1.45;
  f.frame(1200);
  assert.equal(worker.sent.length, beforeGap + 1);
  const id = worker.sent.at(-1).id;
  const windowSeconds = ANALYSIS_WINDOW_SECONDS;
  worker.onmessage({
    data: {
      type: 'result',
      id,
      results: [
        { hz: 180, amplitude: 0.4, confidence: 1, rms: 0.3, offsetSeconds: 0.1, windowSeconds },
        { hz: 220, amplitude: 0.4, confidence: 1, rms: 0.3, offsetSeconds: 0.5, windowSeconds }
      ]
    }
  });
  assert.ok(f.state.points.length >= 1);
  assert.ok(f.state.points.every((point) => point.time >= 1.246));
  f.controller.dispose();
});

test('ended retires in-flight work rather than firing a false error after five seconds', async () => {
  const f = await running();
  f.frame();
  f.a.ended = true;
  f.a.dispatchEvent(new Event('ended'));
  f.result();
  assert.equal(f.state.activity, 'ended');
  assert.equal(f.state.points.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.frames.size, 0);
  f.controller.dispose();
});
test('buffering stops work and resumption starts a new smoothing epoch', async () => {
  const f = await running();
  f.frame();
  const epoch = f.workers[0].sent[0].epoch;
  f.a.dispatchEvent(new Event('waiting'));
  f.result();
  assert.equal(f.state.activity, 'buffering');
  assert.equal(f.timers.size, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.state.points.length, 0);
  f.a.currentTime += 0.1;
  f.a.dispatchEvent(new Event('playing'));
  f.frame(1400);
  assert.ok(f.workers[0].sent[1].epoch > epoch);
  f.result();
  assert.equal(f.state.activity, 'playing');
  f.controller.dispose();
});
test('wait for a fresh audio window and media data before sampling', async () => {
  const f = await running();
  f.frame(10);
  assert.equal(f.workers[0].sent.length, 0);
  f.a.readyState = 1;
  f.frame(600);
  assert.equal(f.workers[0].sent.length, 0);
  f.a.readyState = 4;
  f.frame(700);
  assert.equal(f.workers[0].sent.length, 1);
  f.controller.dispose();
});
test('an unsolicited result without an id is ignored, not dereferenced as pending work', async () => {
  const f = await running();
  f.workers[0].onmessage({ data: { type: 'result' } });
  assert.equal(f.state.status, 'ready');
  assert.equal(f.state.points.length, 0);
  f.controller.dispose();
});
test('native Play waits for suspended output to resume before scheduling analysis', async () => {
  const f = await running();
  f.a.paused = true;
  f.a.dispatchEvent(new Event('pause'));
  f.context.state = 'suspended';
  let resume;
  f.context.resume = () =>
    new Promise((resolve) => {
      resume = resolve;
    });
  f.play();
  f.frame(200);
  assert.equal(f.state.status, 'ready');
  assert.equal(f.frames.size, 0);
  f.context.state = 'running';
  resume();
  await flush();
  assert.equal(f.frames.size, 1);
  f.controller.dispose();
});
test('startup timeout distinguishes ready worker from unavailable audio output', async () => {
  const f = fixture({ resume: () => new Promise(() => {}) });
  f.controller.setEnabled(true);
  f.ready();
  f.timer(15000);
  assert.equal(f.state.status, 'error');
  assert.match(f.state.message, /audio output/);
  assert.equal(f.sources.length, 0);
  f.controller.dispose();
});
test('rolling graph puts current audio on the right and separates octave jumps and gaps', () => {
  const point = { time: 2, hz: 100, amplitude: 0.5 };
  const current = pitchPaths([point], 2);
  assert.equal(current.marker.x, 624);
  assert.ok(current.waveform.endsWith('Z'));
  const plot = pitchPaths([point, { ...point, time: 2.04, hz: 400 }], 2.04);
  assert.equal((plot.pitch.match(/M/g) || []).length, 2);
  assert.deepEqual(pitchPaths([point], 11), { waveform: '', pitch: '' });
});
