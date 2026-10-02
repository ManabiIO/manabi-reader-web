import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm';
import modelUrl from './swift-f0-0.3.0.onnx';
import { resolveSwiftF0AssetURLs } from './asset-urls';
import {
  MAX_HZ,
  MIN_HZ,
  measurementFromSwiftF0,
  resampleForSwiftF0,
  type Measurement
} from './analysis';

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
): Promise<Measurement> {
  const samples = resampleForSwiftF0(input, rate);
  if (!samples.length)
    return measurementFromSwiftF0(samples, [], [], {
      windowSeconds: Number.isFinite(rate) && rate > 0 ? input.length / rate : 0
    });

  if (!sessionPromise) throw new Error('SwiftF0 has not been initialized');
  const session = await sessionPromise;
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
