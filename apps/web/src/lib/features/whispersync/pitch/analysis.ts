/** Acoustic estimator adapted from Japanese Vids' Black Belt pitch analysis.
 * See docs/audio-pitch.md for provenance, differences and accuracy limits. */
export interface Measurement {
  hz: number | null;
  confidence: number;
  rms: number;
  amplitude: number;
}
export const MIN_HZ = 85;
export const MAX_HZ = 520;

/** Same mean-centred Hann / normalized-correlation estimator as the template.
 * Input is one bounded 40 ms frame, not a decoded audiobook. Runs in a worker. */
export function analyseFrame(input: Float32Array, rate: number): Measurement {
  const empty: Measurement = { hz: null, confidence: 0, rms: 0, amplitude: 0 };
  if (
    !Number.isFinite(rate) ||
    rate < 8000 ||
    rate > 192000 ||
    input.length < (rate * 3) / MIN_HZ ||
    input.length > 16384
  )
    return empty;
  const factor = Math.max(1, Math.ceil(rate / 12000));
  const samples = new Float32Array(Math.ceil(input.length / factor));
  for (let i = 0; i < samples.length; i++) {
    const end = Math.min(input.length, (i + 1) * factor);
    let sum = 0;
    for (let j = i * factor; j < end; j++) sum += Number.isFinite(input[j]) ? input[j] : 0;
    samples[i] = sum / (end - i * factor);
  }
  rate /= factor;
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  let energy = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i] - mean;
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
    samples[i] = value * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (samples.length - 1)));
  }
  const rms = Math.sqrt(energy / samples.length);
  const result = { ...empty, rms, amplitude: peak * 0.68 + rms * 0.32 };
  if (rms < 0.00001) return result;
  const minLag = Math.max(2, Math.floor(rate / MAX_HZ));
  const maxLag = Math.min(samples.length - 2, Math.ceil(rate / MIN_HZ));
  const scores = new Float32Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let correlation = 0;
    let pairedEnergy = 0;
    for (let i = 0; i < samples.length - lag; i++) {
      correlation += samples[i] * samples[i + lag];
      pairedEnergy += samples[i] ** 2 + samples[i + lag] ** 2;
    }
    scores[lag] = pairedEnergy > 0 ? (2 * correlation) / pairedEnergy : 0;
  }
  const isPeak = (lag: number) => scores[lag] >= scores[lag - 1] && scores[lag] >= scores[lag + 1];
  let best = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (isPeak(lag) && (best < 0 || scores[lag] > scores[best])) best = lag;
  }
  if (best < 0 || scores[best] < 0.52) return result;
  const threshold = Math.max(0.52, scores[best] * 0.88);
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (isPeak(lag) && scores[lag] >= threshold) {
      best = lag;
      break;
    }
  }
  const denominator = scores[best - 1] - 2 * scores[best] + scores[best + 1];
  const offset =
    Math.abs(denominator) > 0.000001
      ? Math.max(-0.45, Math.min(0.45, (0.5 * (scores[best - 1] - scores[best + 1])) / denominator))
      : 0;
  const hz = rate / (best + offset);
  return { ...result, hz: hz >= MIN_HZ && hz <= MAX_HZ ? hz : null, confidence: scores[best] };
}
