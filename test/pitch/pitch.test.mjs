import test from 'node:test';
import assert from 'node:assert/strict';
const { analyseFrame } = await import(new URL('analysis.mjs', process.env.PITCH_COMPILED));
const { appendPoint, pitchPaths, initialPitchState } = await import(new URL('model.mjs', process.env.PITCH_COMPILED));
const { PitchController } = await import(new URL('controller.mjs', process.env.PITCH_COMPILED));
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const tone = (hz, rate = 48000, amplitude = 0.7) => Float32Array.from({ length: Math.ceil(rate * 0.04) }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / rate));

for (const rate of [8000, 16000, 44100, 48000, 96000, 192000]) {
  for (const hz of [100, 160, 220, 330, 440]) test(`tone ${hz} Hz at ${rate} samples/s`, () => {
    const result = analyseFrame(tone(hz, rate), rate);
    assert.ok(result.hz !== null && Math.abs(result.hz - hz) < 4, JSON.stringify(result));
    assert.ok(result.confidence >= 0.52 && result.amplitude > 0);
  });
}
test('silence, DC, nonfinite input and malformed sample rates cannot produce a contour', () => {
  for (const samples of [new Float32Array(1920), new Float32Array(1920).fill(0.5), new Float32Array(1920).fill(NaN)])
    assert.equal(analyseFrame(samples, 48000).hz, null);
  for (const rate of [NaN, Infinity, 0, 7999, 192001]) assert.equal(analyseFrame(tone(220), rate).hz, null);
  assert.equal(analyseFrame(new Float32Array(8), 48000).hz, null);
  assert.equal(analyseFrame(new Float32Array(20000), 48000).hz, null);
});
test('history is bounded in time and points, and seeks start a new contour', () => {
  let points = [];
  for (let i = 0; i < 10000; i++) points = appendPoint(points, { time: i * 0.001, hz: 220, amplitude: 0.5 });
  assert.equal(points.length, 400);
  assert.deepEqual(appendPoint(points, { time: 1, hz: null, amplitude: 0 }), [{ time: 1, hz: null, amplitude: 0 }]);
  assert.equal(appendPoint(points, { time: 30, hz: 220, amplitude: 1 }).length, 1);
});
test('pitch rendering breaks at unvoiced frames and long gaps, keeps amplitudes finite', () => {
  const points = [
    { time: 1, hz: 220, amplitude: 0.3 }, { time: 1.04, hz: 240, amplitude: 1 },
    { time: 1.08, hz: null, amplitude: 0 }, { time: 1.12, hz: 220, amplitude: 0.7 },
    { time: 4, hz: 330, amplitude: 1 }
  ];
  const paths = pitchPaths(points, 4);
  assert.equal((paths.pitch.match(/M/g) || []).length, 3);
  assert.equal((paths.pitch.match(/L/g) || []).length, 1);
  assert.ok(!/NaN|Infinity/.test(paths.waveform + paths.pitch));
  assert.deepEqual(pitchPaths([], 0), { waveform: '', pitch: '' });
});

function fixture(options = {}) {
  let state = initialPitchState(), id = 0;
  const workers = [], frames = new Map(), timers = new Map(), sources = [];
  const context = {
    state: 'running', sampleRate: 48000, destination: {}, closes: 0, resumes: 0,
    resume() { this.resumes++; return options.resume?.() ?? Promise.resolve(); },
    close() { this.closes++; this.state = 'closed'; return Promise.resolve(); },
    createMediaElementSource(audio) {
      assert.ok(!sources.some(source => source.audio === audio), 'capture the same element only once');
      const source = { audio, connections: new Set(), connect(target) { this.connections.add(target); }, disconnect(target) {
        if (target) assert.ok(this.connections.delete(target)); else this.connections.clear();
      } };
      sources.push(source); return source;
    },
    createAnalyser() { return { fftSize: 0, getFloatTimeDomainData(samples) { samples.set(tone(220), samples.length - 1920); } }; }
  };
  let contexts = 0;
  const controller = new PitchController({
    createContext() { contexts++; return context; },
    createWorker() {
      if (options.workerThrows) throw Error('blocked');
      const worker = { sent: [], terminated: false, postMessage(message) { this.sent.push(message); }, terminate() { this.terminated = true; } };
      workers.push(worker); return worker;
    },
    requestFrame(callback) { frames.set(++id, callback); return id; },
    cancelFrame(id) { frames.delete(id); },
    setTimer(callback, delay) { timers.set(++id, { callback, delay }); return id; },
    clearTimer(id) { timers.delete(id); }
  }, value => { state = value; });
  function audio() { const a = new EventTarget(); return Object.assign(a, { paused: true, ended: false, seeking: false, currentTime: 1, playbackRate: 1 }); }
  const a = audio(); controller.setAudio(a); controller.setVisible(true);
  return {
    controller, a, audio, context, workers, frames, timers, sources,
    get state() { return state; }, get contexts() { return contexts; },
    ready() { workers.at(-1).onmessage({ data: { type: 'ready' } }); },
    result(worker = workers.at(-1), result = { hz: 220, amplitude: 0.5, confidence: 1, rms: 0.5 }) {
      worker.onmessage({ data: { type: 'result', id: worker.sent.at(-1).id, result } });
    },
    play() { a.paused = false; a.dispatchEvent(new Event('play')); },
    frame(now = 100) { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(now)); },
    timer(delay) { const found = [...timers].find(([, timer]) => timer.delay === delay); assert.ok(found, `timer ${delay}`); timers.delete(found[0]); found[1].callback(); }
  };
}
async function running(f = fixture()) {
  f.controller.setEnabled(true); f.ready(); await flush(); f.play(); await flush(); return f;
}
test('disabled by default: no context, worker or audio capture', () => {
  const f = fixture(); f.play(); f.frame();
  assert.equal(f.state.enabled, false); assert.equal(f.contexts, 0); assert.equal(f.workers.length, 0);
  f.controller.dispose();
});
test('loading waits for the actual worker handshake and audio resume', async () => {
  const f = fixture(); f.controller.setEnabled(true); await flush();
  assert.equal(f.state.status, 'loading'); assert.equal(f.sources.length, 0);
  f.ready(); assert.equal(f.state.status, 'ready'); assert.equal(f.sources.length, 1);
  f.controller.dispose();
});
test('stale worker readiness after turning off cannot capture audio', async () => {
  const f = fixture(); f.controller.setEnabled(true); f.controller.setEnabled(false); f.ready(); await flush();
  assert.equal(f.state.status, 'off'); assert.equal(f.sources.length, 0); assert.ok(f.workers[0].terminated);
  f.controller.dispose();
});
test('show/hide and off/on stop analysis but retain the playback destination', async () => {
  const f = await running(); const source = f.sources[0];
  f.controller.setVisible(false);
  assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0); assert.ok(f.workers[0].terminated);
  assert.deepEqual([...source.connections], [f.context.destination]); assert.equal(f.context.closes, 0);
  f.controller.setVisible(true); f.ready(); await flush();
  f.controller.setEnabled(false);
  assert.deepEqual([...source.connections], [f.context.destination]);
  f.controller.setEnabled(true); f.ready(); await flush();
  assert.equal(f.sources.length, 1); assert.equal(f.contexts, 1);
  f.controller.dispose(); assert.equal(f.context.closes, 1); assert.equal(source.connections.size, 0);
});
test('bounded work: one in-flight request, timestamps at frame center, no duplicate stalled samples', async () => {
  const f = await running(); f.frame(100);
  const worker = f.workers[0]; assert.equal(worker.sent.length, 1);
  assert.equal(worker.sent[0].samples.length, 1920);
  f.a.currentTime += 0.1; f.frame(200); assert.equal(worker.sent.length, 1);
  f.result(); assert.ok(Math.abs(f.state.points[0].time - 0.98) < 1e-9);
  f.frame(300); assert.equal(worker.sent.length, 2); f.result();
  f.frame(400); assert.equal(worker.sent.length, 2);
  f.controller.dispose();
});
test('seeking discards old results and even a delivered cancelled animation callback', async () => {
  const f = await running(); f.frame(); const worker = f.workers[0];
  const staleFrame = [...f.frames.values()][0];
  f.a.currentTime = 20; f.a.seeking = true; f.a.dispatchEvent(new Event('seeking'));
  f.result(); assert.equal(f.state.points.length, 0);
  f.a.seeking = false; f.a.dispatchEvent(new Event('seeked')); staleFrame(200);
  assert.equal(f.frames.size, 1); f.frame(300); f.result();
  assert.equal(f.state.points.length, 1); assert.ok(f.state.points[0].time > 19);
  f.controller.dispose();
});
test('replacement audio retires only the old route and rejects late callbacks', async () => {
  const f = await running(); f.frame(); const oldWorker = f.workers[0];
  const newer = f.audio(); f.controller.setAudio(newer); f.result(oldWorker);
  assert.equal(f.state.points.length, 0); assert.equal(f.sources[0].connections.size, 0);
  f.ready(); await flush(); assert.equal(f.sources.length, 2);
  f.controller.dispose(); newer.dispatchEvent(new Event('play')); assert.equal(f.frames.size, 0);
});
test('load and result timeouts expose retry without closing the output route', async () => {
  const f = fixture(); f.controller.setEnabled(true); f.timer(15000); assert.equal(f.state.status, 'error');
  f.controller.retry(); f.ready(); await flush(); f.play(); await flush(); f.frame(); f.timer(5000);
  assert.equal(f.state.status, 'error'); assert.equal(f.context.closes, 0);
  assert.deepEqual([...f.sources[0].connections], [f.context.destination]);
  f.controller.dispose();
});
test('bad worker measurements fail safely, and a retry can recover', async () => {
  const f = await running(); f.frame(); f.result(undefined, { hz: NaN, amplitude: 1 });
  assert.equal(f.state.status, 'error'); assert.equal(f.state.points.length, 0);
  f.controller.retry(); f.ready(); await flush(); assert.equal(f.state.status, 'ready');
  f.controller.dispose();
});
test('worker construction failure also handles a rejected resume promise', async () => {
  const f = fixture({ workerThrows: true, resume: () => Promise.reject(Error('not allowed')) });
  f.controller.setEnabled(true); await flush(); assert.equal(f.state.status, 'error');
  assert.equal(f.sources.length, 0); f.controller.dispose();
});
test('paused playback stops sampling; native Play still resumes retained routing while pitch is off', async () => {
  const f = await running(); f.a.paused = true; f.a.dispatchEvent(new Event('pause'));
  assert.equal(f.frames.size, 0); f.controller.setEnabled(false);
  const count = f.context.resumes; f.play(); await flush();
  assert.equal(f.context.resumes, count + 1); assert.equal(f.frames.size, 0);
  f.controller.dispose(); f.controller.dispose(); assert.equal(f.context.closes, 1);
});
