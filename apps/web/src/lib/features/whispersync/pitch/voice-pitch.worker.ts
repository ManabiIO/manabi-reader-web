import * as ort from 'onnxruntime-web/wasm';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url&no-inline';
import {
  frameLevel,
  MAX_HZ,
  median,
  MIN_HZ,
  resampleForSwiftF0,
  SWIFTF0_FRAME_SECONDS,
  SWIFTF0_HOP,
  SWIFTF0_LEFT_FRAMES,
  SWIFTF0_LOOKAHEAD_FRAMES,
  SWIFTF0_SAMPLE_RATE,
  SWIFTF0_SILENCE_PEAK,
  type Measurement,
  type TimedMeasurement
} from './analysis';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage(message: unknown): void;
};

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = {
  'ort-wasm-simd-threaded.wasm': ortWasmUrl
};

const modelUrl = new URL('./swift-f0-0.3.0.onnx', import.meta.url).href;
const session = ort.InferenceSession.create(modelUrl, {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'all'
});

let epoch = -1;
let lastEmittedTime = -Infinity;
let voicedLevels: number[] = [];

function emptyMeasurement(): Measurement {
  return { hz: null, confidence: 0, rms: 0, amplitude: 0 };
}

async function analyse(data: {
  samples: Float32Array;
  rate: number;
  epoch: number;
  endTime: number;
  playbackRate: number;
}) {
  if (data.epoch !== epoch) {
    epoch = data.epoch;
    lastEmittedTime = -Infinity;
    voicedLevels = [];
  }

  const samples = resampleForSwiftF0(data.samples, data.rate);
  if (samples.length < SWIFTF0_HOP * (SWIFTF0_LEFT_FRAMES + SWIFTF0_LOOKAHEAD_FRAMES + 2))
    return { points: [] as TimedMeasurement[], result: emptyMeasurement() };

  const detector = await session;
  const output = await detector.run({
    audio: new ort.Tensor('float32', samples, [1, samples.length]),
    fmin: new ort.Tensor('float32', Float32Array.of(MIN_HZ), []),
    fmax: new ort.Tensor('float32', Float32Array.of(MAX_HZ), [])
  });
  const pitch = output.pitch?.data as Float32Array | undefined;
  const confidence = output.confidence?.data as Float32Array | undefined;
  if (!pitch || !confidence || pitch.length !== confidence.length)
    throw new Error('SwiftF0 returned malformed output');

  const stableEnd = Math.max(
    SWIFTF0_LEFT_FRAMES,
    pitch.length - SWIFTF0_LOOKAHEAD_FRAMES
  );
  const duration = samples.length / SWIFTF0_SAMPLE_RATE;
  const playbackRate =
    Number.isFinite(data.playbackRate) && data.playbackRate > 0 ? data.playbackRate : 1;
  const endTime = Number.isFinite(data.endTime) ? data.endTime : 0;
  const points: TimedMeasurement[] = [];

  for (let index = SWIFTF0_LEFT_FRAMES; index < stableEnd; index++) {
    const time =
      endTime + (index * SWIFTF0_FRAME_SECONDS - duration) * playbackRate;
    if (!Number.isFinite(time) || time <= lastEmittedTime + 0.004) continue;

    const level = frameLevel(samples, index * SWIFTF0_HOP);
    const score = Number(confidence[index]);
    const candidate = Number(pitch[index]);
    let hz =
      Number.isFinite(score) &&
      score >= 0.5 &&
      Number.isFinite(candidate) &&
      candidate >= MIN_HZ &&
      candidate <= MAX_HZ &&
      level.peak >= SWIFTF0_SILENCE_PEAK
        ? candidate
        : null;

    if (hz !== null) {
      const db = 20 * Math.log10(Math.max(level.rms, 1e-7));
      voicedLevels.push(db);
      if (voicedLevels.length > 96) voicedLevels.shift();
      const reference = median(voicedLevels);
      // SwiftF0 detects pitched instruments too. The speech-oriented level
      // gate recommended by its documentation suppresses quiet pitched
      // backgrounds during pauses without modifying the audible signal.
      if (Number.isFinite(reference) && db < reference - 20) hz = null;
    }

    points.push({
      time: Math.max(0, time),
      hz,
      confidence: Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0,
      rms: level.rms,
      amplitude: level.amplitude
    });
    lastEmittedTime = time;
  }

  const last = points.at(-1);
  const result: Measurement = last
    ? {
        hz: last.hz,
        confidence: last.confidence,
        rms: last.rms,
        amplitude: last.amplitude
      }
    : emptyMeasurement();
  return { points, result };
}

void session
  .then(() => scope.postMessage({ type: 'ready', detector: 'swift-f0-0.3.0' }))
  .catch((error) =>
    scope.postMessage({
      type: 'error',
      error: String(error?.message || error || 'SwiftF0 could not load')
    })
  );

scope.onmessage = ({ data }) => {
  if (!(data?.samples instanceof Float32Array)) return;
  void analyse(data)
    .then(({ points, result }) =>
      scope.postMessage({ type: 'result', id: data.id, points, result })
    )
    .catch((error) =>
      scope.postMessage({
        type: 'error',
        id: data.id,
        error: String(error?.message || error || 'SwiftF0 analysis failed')
      })
    );
};
