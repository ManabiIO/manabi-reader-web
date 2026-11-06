import { SWIFT_F0_HOP } from './analysis';

const SILENCE_PEAK = 1e-3;
const QUIET_PEAK = 10 ** (-35 / 20);
const QUIET_TARGET_PEAK = 0.5;

export interface SwiftF0TensorLike {
  type: string;
  dims: readonly number[];
  data: ArrayLike<unknown>;
  dispose(): void;
}

export interface SwiftF0RuntimeLike<TFeed extends SwiftF0TensorLike> {
  createTensor(type: 'float32', data: Float32Array, dims: number[]): TFeed;
  run(feeds: Record<string, TFeed>): Promise<Record<string, SwiftF0TensorLike>>;
}

export function swiftF0ModelGain(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) {
    if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
  }
  return peak >= SILENCE_PEAK && peak < QUIET_PEAK ? QUIET_TARGET_PEAK / peak : 1;
}

/** Own every allocation, including malformed/unexpected outputs, before inspecting data. */
export async function runSwiftF0Inference<TFeed extends SwiftF0TensorLike>(
  samples: Float32Array,
  minimum: number,
  maximum: number,
  runtime: SwiftF0RuntimeLike<TFeed>
): Promise<{ pitch: Float64Array; confidence: Float32Array }> {
  if (!(samples instanceof Float32Array) || samples.length === 0)
    throw new TypeError('SwiftF0 requires non-empty Float32 audio');
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum)
    throw new RangeError('SwiftF0 requires a finite pitch range');

  const gain = swiftF0ModelGain(samples);
  const audio = gain === 1 ? samples : Float32Array.from(samples, (value) => value * gain);
  const ownedFeeds: TFeed[] = [];
  let result: Record<string, SwiftF0TensorLike> | undefined;
  const tensor = (data: Float32Array, dims: number[]) => {
    const created = runtime.createTensor('float32', data, dims);
    ownedFeeds.push(created);
    return created;
  };
  try {
    result = await runtime.run({
      audio: tensor(audio, [1, audio.length]),
      fmin: tensor(Float32Array.of(minimum), []),
      fmax: tensor(Float32Array.of(maximum), [])
    });
    const expected = Math.max(1, Math.floor(samples.length / SWIFT_F0_HOP));
    const output = (name: string, type: 'float32' | 'float64') => {
      const value = result?.[name];
      // Pinned graph: pitch DOUBLE [1, frames], confidence FLOAT [1, frames].
      if (!value || value.type !== type || value.dims.length !== 2 || value.dims[0] !== 1)
        throw new Error('SwiftF0 returned malformed output tensors');
      const data = value.data;
      if (value.dims[1] !== expected || data.length !== expected)
        throw new Error('SwiftF0 returned malformed frame counts');
      return data;
    };
    const pitchData = output('pitch', 'float64');
    const confidenceData = output('confidence', 'float32');
    const pitch = new Float64Array(expected);
    const confidence = new Float32Array(expected);
    for (let index = 0; index < expected; index++) {
      const hz = pitchData[index];
      const score = confidenceData[index];
      if (
        typeof hz !== 'number' ||
        !Number.isFinite(hz) ||
        typeof score !== 'number' ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > 1
      )
        throw new Error('SwiftF0 returned invalid measurements');
      pitch[index] = hz;
      confidence[index] = score;
    }
    return { pitch, confidence };
  } finally {
    const owned = new Set([...Object.values(result ?? {}), ...ownedFeeds]);
    for (const value of owned) {
      try {
        value.dispose();
      } catch {
        // Attempt every release without hiding the original inference error.
      }
    }
  }
}
