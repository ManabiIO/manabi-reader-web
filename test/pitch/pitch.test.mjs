import process from 'node:process';
import test from 'node:test';
import assert from 'node:assert/strict';
const {
  ANALYSIS_WINDOW_SECONDS,
  SWIFT_F0_FRAME_SECONDS,
  measurementFromSwiftF0,
  resampleForSwiftF0
} = await import(new URL('analysis.mjs', process.env.PITCH_COMPILED));
const { appendPoint, pitchPaths, initialPitchState } = await import(
  new URL('model.mjs', process.env.PITCH_COMPILED)
);
const { PitchController } = await import(new URL('controller.mjs', process.env.PITCH_COMPILED));
const { createPitchController } = await import(new URL('browser.mjs', process.env.PITCH_COMPILED));

test('pitch requests a 48 kHz context and falls back when the device rejects it', () => {
  const original = globalThis.AudioContext;
  const requested = [];
  globalThis.AudioContext = class {
    constructor(options) {
      requested.push(options?.sampleRate ?? null);
      if (options) throw new DOMException('Unsupported output rate', 'NotSupportedError');
      this.sampleRate = 96000;
    }
  };
  try {
    const context = createPitchController(() => {}).environment.createContext();
    assert.equal(context.sampleRate, 96000);
    assert.deepEqual(requested, [48000, null]);
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

test('a voiced previous hop cannot authorize pitch inside the current silent hop', () => {
  const frames = 24;
  const selected = frames - 1 - 10;
  const samples = new Float32Array(frames * 256);
  for (let index = (selected - 1) * 256; index < selected * 256; index++) {
    samples[index] = 0.8 * Math.sin((2 * Math.PI * 220 * index) / 16000);
  }
  const pitch = new Float64Array(frames).fill(220);
  const confidence = new Float32Array(frames).fill(1);
  const silent = measurementFromSwiftF0(samples, pitch, confidence);
  assert.equal(silent.hz, null);
  assert.equal(silent.amplitude > 0, true, 'loudness may retain the preceding hop while voicing does not');

  for (let index = selected * 256; index < (selected + 1) * 256; index++) {
    samples[index] = 0.8 * Math.sin((2 * Math.PI * 220 * index) / 16000);
  }
  assert.equal(measurementFromSwiftF0(samples, pitch, confidence).hz, 220);
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
    frame(now = 600) {
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
  f.controller.setSpeechWindow({ start: 0, end: 100 });
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
test('bounded work: one in-flight request, timestamp at selected frame, no duplicate stalled samples', async () => {
  const f = await running();
  f.frame(600);
  const worker = f.workers[0];
  assert.equal(worker.sent.length, 1);
  assert.equal(worker.sent[0].samples.length, Math.ceil(48000 * ANALYSIS_WINDOW_SECONDS));
  f.a.currentTime += 0.1;
  f.frame(700);
  assert.equal(worker.sent.length, 1);
  f.result();
  assert.ok(
    Math.abs(f.state.points[0].time - (1 - worker.sent[0].samples.length / 48000 + 0.32)) < 1e-9
  );
  f.frame(800);
  assert.equal(worker.sent.length, 2);
  f.result();
  f.frame(900);
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
  f.frame(1300);
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
  f.controller.setSpeechWindow({ start: 0, end: 100 });
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
  f.frame(600);
  f.result();
  const completed = f.state.points;
  f.a.currentTime += 0.1;
  f.frame(700);
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
  f.frame(1300);
  f.result();
  assert.equal(f.state.points.length, 2);
  assert.equal(f.state.points[1].breakBefore, true);
  assert.equal((pitchPaths(f.state.points, f.state.time).pitch.match(/M/g) || []).length, 2);
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
  f.frame(1200);
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

test('transcript cue gate suppresses background-only sampling and breaks the next contour', async () => {
  const f = await running();
  f.controller.setSpeechWindow();
  assert.equal(f.state.speechActive, false);
  assert.equal(f.frames.size, 0);
  f.frame(1000);
  assert.equal(f.workers[0].sent.length, 0);

  f.controller.setSpeechWindow({ start: 1, end: 2 });
  assert.equal(f.state.speechActive, true);
  f.frame(1100);
  assert.equal(f.workers[0].sent.length, 0, 'wait for SwiftF0 future context inside the cue');
  f.a.currentTime += 0.25;
  f.frame(1300);
  assert.equal(f.workers[0].sent.length, 1);
  assert.ok(
    f.workers[0].sent[0].samples.slice(0, 12000).every((sample) => sample === 0),
    'pre-cue samples must be zeroed before SwiftF0 inference'
  );
  assert.ok(
    f.workers[0].sent[0].samples.slice(16000).some((sample) => Math.abs(sample) > 0.01),
    'the authored cue samples must remain available to SwiftF0'
  );
  f.result();
  assert.equal(f.state.points.length, 1);
  assert.equal(f.state.points[0].breakBefore, true);

  f.controller.setSpeechWindow();
  f.a.currentTime += 0.05;
  f.frame(1400);
  assert.equal(f.workers[0].sent.length, 1, 'cue gaps must not enqueue pitch work');

  f.controller.setSpeechWindow({ start: 1.3, end: 2.3 });
  f.a.currentTime += 0.25;
  f.frame(1700);
  assert.equal(f.workers[0].sent.length, 2);
  f.result();
  assert.equal(f.state.points.length, 2);
  assert.equal(
    f.state.points[1].breakBefore,
    true,
    'new cues must not join across a background gap'
  );
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
