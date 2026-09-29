/** SwiftF0 browser-side signal preparation.
 * The neural detector itself runs in voice-pitch.worker.ts. */
export interface Measurement {
  hz: number | null;
  confidence: number;
  rms: number;
  amplitude: number;
}

export interface TimedMeasurement extends Measurement {
  time: number;
}

export const MIN_HZ = 85;
export const MAX_HZ = 520;
export const SWIFTF0_SAMPLE_RATE = 16000;
export const SWIFTF0_HOP = 256;
export const SWIFTF0_FRAME_SECONDS = SWIFTF0_HOP / SWIFTF0_SAMPLE_RATE;
export const SWIFTF0_LOOKAHEAD_FRAMES = 10;
export const SWIFTF0_LEFT_FRAMES = 11;
export const SWIFTF0_SILENCE_PEAK = 1e-3;

const sinc = (value: number) =>
  Math.abs(value) < 1e-8 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value);

/**
 * Resample a bounded analysis window to SwiftF0's native 16 kHz rate.
 * A small windowed-sinc low-pass keeps high-rate media from aliasing into the
 * speech band. This is intentionally local to the optional analysis worker;
 * playback and transcription continue to receive the original media stream.
 */
export function resampleForSwiftF0(input: Float32Array, rate: number): Float32Array {
  if (
    !Number.isFinite(rate) ||
    rate < 8000 ||
    rate > 192000 ||
    input.length === 0 ||
    input.length > 131072
  )
    return new Float32Array();

  if (rate === SWIFTF0_SAMPLE_RATE) {
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) output[i] = Number.isFinite(input[i]) ? input[i] : 0;
    return output;
  }

  const ratio = rate / SWIFTF0_SAMPLE_RATE;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  const cutoff = 0.47 * Math.min(1, SWIFTF0_SAMPLE_RATE / rate);
  const radius = rate > SWIFTF0_SAMPLE_RATE ? 16 : 8;

  for (let i = 0; i < length; i++) {
    const center = (i + 0.5) * ratio - 0.5;
    const first = Math.max(0, Math.ceil(center - radius));
    const last = Math.min(input.length - 1, Math.floor(center + radius));
    let weighted = 0;
    let weightTotal = 0;
    for (let source = first; source <= last; source++) {
      const distance = source - center;
      const window = 0.5 + 0.5 * Math.cos((Math.PI * distance) / (radius + 1));
      const weight = 2 * cutoff * sinc(2 * cutoff * distance) * window;
      weighted += (Number.isFinite(input[source]) ? input[source] : 0) * weight;
      weightTotal += weight;
    }
    output[i] = Math.abs(weightTotal) > 1e-8 ? weighted / weightTotal : 0;
  }
  return output;
}

export function frameLevel(
  samples: Float32Array,
  center: number,
  width = Math.round(SWIFTF0_SAMPLE_RATE * 0.032)
) {
  const half = Math.max(1, Math.floor(width / 2));
  const first = Math.max(0, Math.floor(center) - half);
  const last = Math.min(samples.length, Math.floor(center) + half);
  if (last <= first) return { rms: 0, peak: 0, amplitude: 0 };
  let square = 0;
  let peak = 0;
  for (let i = first; i < last; i++) {
    const value = Number.isFinite(samples[i]) ? samples[i] : 0;
    square += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const rms = Math.sqrt(square / (last - first));
  return { rms, peak, amplitude: peak * 0.68 + rms * 0.32 };
}

export function median(values: readonly number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
