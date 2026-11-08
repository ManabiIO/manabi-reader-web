import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm';
import modelUrl from './swift-f0-0.3.0.onnx';
import { resolveSwiftF0AssetURLs } from './asset-urls';
import {
  MAX_HZ,
  MIN_HZ,
  measurementsFromSwiftF0,
  resampleForSwiftF0,
  type Measurement
} from './analysis';
import { runSwiftF0Inference, swiftF0ModelGain, type SwiftF0SessionLike } from './swift-f0-runtime';


let sessionPromise: Promise<ort.InferenceSession> | undefined;

export function prepareSwiftF0(assetBaseURL: string): Promise<ort.InferenceSession> {
  if (sessionPromise) return sessionPromise;
  const assets = resolveSwiftF0AssetURLs(assetBaseURL, modelUrl, wasmUrl);
  // /wasm's ESM export embeds its JS factory. The wasm-only override and one
  // thread keep it embedded, including when Metro replaces import.meta.url.
  // No external .mjs factory or nested ORT worker is required.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: assets.wasm };
  sessionPromise = ort.InferenceSession.create(assets.model, {
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
): Promise<Measurement[]> {
  const samples = resampleForSwiftF0(input, rate);
  if (!samples.length) return [];

  if (!sessionPromise) throw new Error('SwiftF0 has not been initialized');
  const session = await sessionPromise;
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
  return measurementsFromSwiftF0(samples, pitch, confidence, {
    windowSeconds: input.length / rate
  });
}
