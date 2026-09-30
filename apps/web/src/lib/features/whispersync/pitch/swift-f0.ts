import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import modelUrl from './swift-f0-0.3.0.onnx?url';
import {
  MAX_HZ,
  MIN_HZ,
  measurementFromSwiftF0,
  resampleForSwiftF0,
  swiftF0ModelGain,
  type Measurement
} from './analysis';

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = { wasm: wasmUrl };

let sessionPromise: Promise<ort.InferenceSession> | undefined;

export function prepareSwiftF0(): Promise<ort.InferenceSession> {
  sessionPromise ??= ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  }).catch((error) => {
    sessionPromise = undefined;
    throw error;
  });
  return sessionPromise;
}

export async function analyseSwiftF0Window(
  input: Float32Array,
  rate: number
): Promise<Measurement> {
  const samples = resampleForSwiftF0(input, rate);
  if (!samples.length)
    return measurementFromSwiftF0(samples, [], [], {
      windowSeconds: Number.isFinite(rate) && rate > 0 ? input.length / rate : 0
    });

  const session = await prepareSwiftF0();
  const gain = swiftF0ModelGain(samples);
  const modelSamples =
    gain === 1 ? samples : Float32Array.from(samples, (sample) => sample * gain);
  const feeds = {
    // Gain only the model input. measurementFromSwiftF0 below intentionally
    // receives the original samples so waveform/level/silence semantics do not
    // change with automatic low-level compensation.
    audio: new ort.Tensor('float32', modelSamples, [1, modelSamples.length]),
    fmin: new ort.Tensor('float32', Float32Array.of(MIN_HZ), []),
    fmax: new ort.Tensor('float32', Float32Array.of(MAX_HZ), [])
  };
  let result: ort.InferenceSession.ReturnType | undefined;
  try {
    result = await session.run(feeds);
    const pitch = result.pitch?.data as ArrayLike<number> | undefined;
    const confidence = result.confidence?.data as ArrayLike<number> | undefined;
    const expectedFrames = Math.max(1, Math.floor(samples.length / 256));
    if (
      !pitch ||
      !confidence ||
      pitch.length !== expectedFrames ||
      confidence.length !== expectedFrames
    )
      throw new Error('SwiftF0 returned malformed output');
    return measurementFromSwiftF0(samples, pitch, confidence, {
      windowSeconds: input.length / rate
    });
  } finally {
    for (const tensor of Object.values(result ?? {})) tensor.dispose();
    for (const tensor of Object.values(feeds)) tensor.dispose();
  }
}
