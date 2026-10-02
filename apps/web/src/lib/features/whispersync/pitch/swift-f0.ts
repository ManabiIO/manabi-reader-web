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
import { runSwiftF0Inference, type SwiftF0TensorLike } from './swift-f0-runtime';

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
  const modelOutput = (value: unknown): SwiftF0TensorLike | undefined => {
    if (!(value instanceof ort.Tensor) || value.type !== 'float32') return undefined;
    return {
      data: value.data as ArrayLike<number>,
      dispose: () => value.dispose()
    };
  };
  const { pitch, confidence } = await runSwiftF0Inference(samples, MIN_HZ, MAX_HZ, {
    createTensor: (type, data, dims) => new ort.Tensor(type, data, dims),
    run: async (feeds) => {
      const result = await session.run(feeds);
      return {
        pitch: modelOutput(result.pitch),
        confidence: modelOutput(result.confidence)
      };
    }
  });
  return measurementFromSwiftF0(samples, pitch, confidence, {
    windowSeconds: input.length / rate
  });
}
