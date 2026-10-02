import { SWIFT_F0_HOP } from './analysis';

const SILENCE_PEAK = 1e-3;
const QUIET_PEAK = 10 ** (-35 / 20);
const QUIET_TARGET_PEAK = 0.5;

export interface SwiftF0TensorLike {
  data?: ArrayLike<number>;
  dispose?(): void;
}

export interface SwiftF0RuntimeLike<T extends SwiftF0TensorLike> {
  createTensor(type: 'float32', data: Float32Array, dims: number[]): T;
  run(feeds: Record<string, T>): Promise<Record<string, T>>;
}

export function swiftF0ModelGain(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) {
    if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
  }
  return peak >= SILENCE_PEAK && peak < QUIET_PEAK ? QUIET_TARGET_PEAK / peak : 1;
}

export async function runSwiftF0Inference<T extends SwiftF0TensorLike>(
  samples: Float32Array,
  minimum: number,
  maximum: number,
  runtime: SwiftF0RuntimeLike<T>
): Promise<{ pitch: Float64Array; confidence: Float32Array }> {
  if (!(samples instanceof Float32Array) || samples.length === 0)
    throw new TypeError('SwiftF0 requires non-empty Float32 audio');
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum)
    throw new RangeError('SwiftF0 requires a finite pitch range');

  const gain = swiftF0ModelGain(samples);
  const audio =
    gain === 1 ? samples : Float32Array.from(samples, (value) => (Number.isFinite(value) ? value * gain : 0));
  const ownedFeeds: T[] = [];
  let result: Record<string, T> | undefined;

  const tensor = (data: Float32Array, dims: number[]) => {
    const created = runtime.createTensor('float32', data, dims);
    ownedFeeds.push(created);
    return created;
  };

  try {
    const feeds = {
      audio: tensor(audio, [1, audio.length]),
      fmin: tensor(Float32Array.of(minimum), []),
      fmax: tensor(Float32Array.of(maximum), [])
    };
    result = await runtime.run(feeds);

    const pitchData = result.pitch?.data;
    const confidenceData = result.confidence?.data;
    const expected = Math.max(1, Math.floor(samples.length / SWIFT_F0_HOP));
    if (
      !pitchData ||
      !confidenceData ||
      pitchData.length !== expected ||
      confidenceData.length !== expected
    )
      throw new Error('SwiftF0 returned malformed frame counts');

    const pitch = new Float64Array(expected);
    const confidence = new Float32Array(expected);
    for (let index = 0; index < expected; index++) {
      const hz = Number(pitchData[index]);
      const score = Number(confidenceData[index]);
      if (!Number.isFinite(hz) || !Number.isFinite(score) || score < 0 || score > 1)
        throw new Error('SwiftF0 returned invalid measurements');
      pitch[index] = hz;
      confidence[index] = score;
    }
    return { pitch, confidence };
  } finally {
    const disposable = new Set<T>([
      ...Object.values(result ?? {}),
      ...ownedFeeds
    ]);
    for (const value of disposable) {
      try {
        value.dispose?.();
      } catch {
        // Tensor cleanup must never hide the original inference result/error.
      }
    }
  }
}
