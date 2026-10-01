/** SwiftF0 0.3.0 streaming-window helpers.
 * The neural detector itself runs in the optional worker; this module stays
 * dependency-free so lifecycle and signal contracts remain easy to test. */
export interface Measurement {
  hz: number | null;
  confidence: number;
  rms: number;
  amplitude: number;
  offsetSeconds: number;
  windowSeconds: number;
}

export const MIN_HZ = 85;
export const MAX_HZ = 520;
export const VOICING_THRESHOLD = 0.52;
export const SWIFT_F0_SAMPLE_RATE = 16000;
export const SWIFT_F0_HOP = 256;
export const SWIFT_F0_FRAME_SECONDS = SWIFT_F0_HOP / SWIFT_F0_SAMPLE_RATE;
export const SWIFT_F0_LOOKAHEAD_FRAMES = 10;
export const SWIFT_F0_LEFT_CONTEXT_FRAMES = 11;
export const SWIFT_F0_FUTURE_CONTEXT_SECONDS =
  (SWIFT_F0_LOOKAHEAD_FRAMES + 1) * SWIFT_F0_FRAME_SECONDS;
export const ANALYSIS_WINDOW_SECONDS = 0.64;
export const SAMPLE_INTERVAL_MS = 256;
export const SWIFT_F0_EMIT_STRIDE = 2;
const SILENCE_PEAK = 1e-3;

const finite = (value: number | undefined, fallback = 0) =>\n  Number.isFinite(value) ? (value as number) : fallback;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const sinc = (value: number) =>
  Math.abs(value) < 1e-8 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value);

export function resampleForSwiftF0(input: Float32Array, rate: number): Float32Array {
  if (!Number.isFinite(rate) || rate < 8000 || rate > 192000 || input.length === 0)
    return new Float32Array();

  if (rate === SWIFT_F0_SAMPLE_RATE) return Float32Array.from(input, (value) => finite(value));

  const ratio = rate / SWIFT_F0_SAMPLE_RATE;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  const cutoff = 0.47 * Math.min(1, SWIFT_F0_SAMPLE_RATE / rate);
  const radius = rate > SWIFT_F0_SAMPLE_RATE ? 16 : 8;
  for (let index = 0; index < length; index++) {
    const center = (index + 0.5) * ratio - 0.5;
    const first = Math.max(0, Math.ceil(center - radius));
    const last = Math.min(input.length - 1, Math.floor(center + radius));
    let weighted = 0;
    let weightTotal = 0;
    for (let source = first; source <= last; source++) {
      const distance = source - center;
      const window = 0.5 + 0.5 * Math.cos((Math.PI * distance) / (radius + 1));
      const weight = 2 * cutoff * sinc(2 * cutoff * distance) * window;
      weighted += finite(input[source]) * weight;
      weightTotal += weight;
    }
    output[index] = Math.abs(weightTotal) > 1e-8 ? weighted / weightTotal : 0;
  }
  return output;
}

function frameLevel(samples: Float32Array, center: number) {
  const width = Math.round(SWIFT_F0_SAMPLE_RATE * 0.032);
  const half = Math.max(1, Math.floor(width / 2));
  const first = Math.max(0, Math.floor(center) - half);
  const last = Math.min(samples.length, Math.floor(center) + half);
  if (last <= first) return { rms: 0, peak: 0 };
  let square = 0;
  let peak = 0;
  const hopEnd = Math.min(samples.length, Math.floor(center) + SWIFT_F0_HOP);
  for (let index = first; index < last; index++) {
    const value = finite(samples[index]);
    square += value * value;
    // SwiftF0's silence contract belongs to the current 256-sample hop.
    // A voiced preceding hop may contribute to the centered RMS envelope but
    // must not authorize pitch after playback enters digital silence.
    if (index >= center && index < hopEnd) peak = Math.max(peak, Math.abs(value));
  }
  return { rms: Math.sqrt(square / (last - first)), peak };
}

export function measurementsFromSwiftF0(
  samples: Float32Array,
  pitch: ArrayLike<number>,
  confidence: ArrayLike<number>,
  {
    minHz = MIN_HZ,
    maxHz = MAX_HZ,
    voicingThreshold = VOICING_THRESHOLD,
    windowSeconds = samples.length / SWIFT_F0_SAMPLE_RATE,
    stride = SWIFT_F0_EMIT_STRIDE
  }: {
    minHz?: number;
    maxHz?: number;
    voicingThreshold?: number;
    windowSeconds?: number;
    stride?: number;
  } = {}
): Measurement[] {
  const count = Math.min(pitch.length, confidence.length);
  if (!samples.length || !count) return [];
  const stableCount = Math.max(0, count - SWIFT_F0_LOOKAHEAD_FRAMES);
  const step = Math.max(1, Math.floor(finite(stride, SWIFT_F0_EMIT_STRIDE)));
  const results: Measurement[] = [];
  // A rolling window is not the beginning of the audio stream. Discard the
  // first eleven frames so every published estimate has the same left context
  // SwiftF0 uses when chunking a longer signal.
  for (let index = SWIFT_F0_LEFT_CONTEXT_FRAMES; index < stableCount; index += step) {
    const score = clamp(finite(Number(confidence[index])), 0, 1);
    const candidate = Number(pitch[index]);
    const level = frameLevel(samples, index * SWIFT_F0_HOP);
    const hz =
      score >= clamp(finite(voicingThreshold, VOICING_THRESHOLD), 0, 1) &&
      level.peak >= SILENCE_PEAK &&
      Number.isFinite(candidate) &&
      candidate >= minHz &&
      candidate <= maxHz
        ? candidate
        : null;
    results.push({
      hz,
      confidence: score,
      rms: level.rms,
      amplitude: level.peak * 0.68 + level.rms * 0.32,
      offsetSeconds: index * SWIFT_F0_FRAME_SECONDS,
      windowSeconds: Math.max(0, finite(windowSeconds))
    });
  }
  return results;
}

export function measurementFromSwiftF0(
  samples: Float32Array,
  pitch: ArrayLike<number>,
  confidence: ArrayLike<number>,
  options: {
    minHz?: number;
    maxHz?: number;
    voicingThreshold?: number;
    windowSeconds?: number;
  } = {}
): Measurement {
  const measurements = measurementsFromSwiftF0(samples, pitch, confidence, {
    ...options,
    stride: 1
  });
  return (
    measurements.at(-1) ?? {
      hz: null,
      confidence: 0,
      rms: 0,
      amplitude: 0,
      offsetSeconds: 0,
      windowSeconds: Math.max(
        0,
        finite(options.windowSeconds, samples.length / SWIFT_F0_SAMPLE_RATE)
      )
    }
  );
}
