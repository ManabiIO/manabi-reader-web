import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import modelUrl from './swift-f0-0.3.0.onnx?url';
import {
  MAX_HZ,
  MIN_HZ,
  measurementFromSwiftF0,
  resampleForSwiftF0,
  type Measurement
} from './analysis';
import {
  runSwiftF0Inference,
  swiftF0ModelGain,
  type SwiftF0SessionLike
} from './swift-f0-runtime';

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
  const tensorSession: SwiftF0SessionLike<ort.Tensor> = {
    async run(feeds) {
      return (await session.run(feeds)) as Record<string, ort.Tensor>;
    }
  };
  const { pitch, confidence } = await runSwiftF0Inference(
    tensorSession,
    (type, data, dims) => new ort.Tensor(type, data, dims),
    samples,
    MIN_HZ,
    MAX_HZ,
    swiftF0ModelGain(samples)
  );
  return measurementFromSwiftF0(samples, pitch, confidence, {
    windowSeconds: input.length / rate
  });
}
