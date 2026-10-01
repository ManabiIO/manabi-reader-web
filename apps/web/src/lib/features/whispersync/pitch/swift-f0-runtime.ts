import { SWIFT_F0_HOP } from './analysis';

export interface SwiftF0TensorLike {
  data: ArrayLike<number>;
  dispose?: () => void;
}

export interface SwiftF0SessionLike {
  run(feeds: Record<string, SwiftF0TensorLike>): Promise<Record<string, SwiftF0TensorLike>>;
}

export type SwiftF0TensorFactory = (
  type: 'float32',
  data: Float32Array,
  dims: number[]
) => SwiftF0TensorLike;

const SILENCE_PEAK = 1e-3;
const QUIET_PEAK = 10 ** (-35 / 20);
const QUIET_TARGET_PEAK = 0.5;

export function swiftF0ModelGain(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) {
    if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
  }
  return peak >= SILENCE_PEAK && peak < QUIET_PEAK ? QUIET_TARGET_PEAK / peak : 1;
}

function disposeAll(values: Iterable<SwiftF0TensorLike | undefined>) {
  const seen = new Set<SwiftF0TensorLike>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    value.dispose?.();
  }
}

export async function runSwiftF0Inference(
  session: SwiftF0SessionLike,
  createTensor: SwiftF0TensorFactory,
  samples: Float32Array,
  minimum: number,
  maximum: number,
  gain = 1
): Promise<{ pitch: Float64Array; confidence: Float32Array }> {
  if (!(samples instanceof Float32Array) || samples.length === 0)
    throw new TypeError('SwiftF0 requires non-empty Float32 audio');
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum)
    throw new RangeError('SwiftF0 requires a finite pitch range');
  if (!Number.isFinite(gain) || gain < 1 || gain > 1000)
    throw new RangeError('SwiftF0 input gain is invalid');

  const audio = gain === 1 ? samples : Float32Array.from(samples, (value) => value * gain);
  const feeds = {
    audio: createTensor('float32', audio, [1, audio.length]),
    fmin: createTensor('float32', Float32Array.of(minimum), []),
    fmax: createTensor('float32', Float32Array.of(maximum), [])
  };
  let result: Record<string, SwiftF0TensorLike> | undefined;
  try {
    result = await session.run(feeds);
    const rawPitch = result.pitch?.data;
    const rawConfidence = result.confidence?.data;
    const expected = Math.max(1, Math.floor(audio.length / SWIFT_F0_HOP));
    if (
      !rawPitch ||
      !rawConfidence ||
      rawPitch.length !== expected ||
      rawConfidence.length !== expected
    )
      throw new Error('SwiftF0 returned malformed frame counts');

    const pitch = Float64Array.from(rawPitch, Number);
    const confidence = Float32Array.from(rawConfidence, Number);
    for (let index = 0; index < expected; index++) {
      if (
        !Number.isFinite(pitch[index]) ||
        !Number.isFinite(confidence[index]) ||
        confidence[index] < 0 ||
        confidence[index] > 1
      )
        throw new Error('SwiftF0 returned invalid measurements');
    }
    return { pitch, confidence };
  } finally {
    disposeAll([...(result ? Object.values(result) : []), ...Object.values(feeds)]);
  }
}
