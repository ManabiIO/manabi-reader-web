import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm';
import modelUrl from './swift-f0-0.3.0.onnx';
import {
  MAX_HZ,
  MIN_HZ,
  measurementFromSwiftF0,
  resampleForSwiftF0,
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
  const result = await session.run({
    audio: new ort.Tensor('float32', samples, [1, samples.length]),
    fmin: new ort.Tensor('float32', Float32Array.of(MIN_HZ), []),
    fmax: new ort.Tensor('float32', Float32Array.of(MAX_HZ), [])
  });
  const pitch = result.pitch?.data as ArrayLike<number> | undefined;
  const confidence = result.confidence?.data as ArrayLike<number> | undefined;
  if (!pitch || !confidence) throw new Error('SwiftF0 returned malformed output');
  return measurementFromSwiftF0(samples, pitch, confidence, {
    windowSeconds: input.length / rate
  });
}
