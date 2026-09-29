/** Qualification-only comparison. A coarse container clock is not sample-accurate.
 * Never retime production PCM or captions: compare a single global displacement
 * within one independently measured timestamp tick, capped at one millisecond.
 */
const RATE = 16000;
export function compareEncodedWaveform(wide, narrow, offset, timeBase) {
  const { numerator, denominator } = timeBase ?? {};
  if (
    !Number.isSafeInteger(numerator) ||
    numerator <= 0 ||
    numerator > 1e9 ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0 ||
    denominator > 1e9 ||
    numerator / denominator > 0.001 ||
    !(wide instanceof Float32Array) ||
    !(narrow instanceof Float32Array) ||
    wide.length > 60 * RATE ||
    narrow.length < 3200 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset + narrow.length > wide.length ||
    !wide.every(Number.isFinite) ||
    !narrow.every(Number.isFinite)
  )
    throw Error('Invalid bounded encoded waveform or timestamp precision');
  const maximumShiftSamples = Math.floor((RATE * numerator) / denominator + 1e-9);
  const from = 800,
    to = narrow.length - 800;
  const metrics = (shift, start = from, end = to) => {
    let referenceEnergy = 0,
      actualEnergy = 0,
      dot = 0,
      squaredError = 0;
    for (let i = start; i < end; i++) {
      const a = wide[offset + i + shift],
        b = narrow[i];
      referenceEnergy += a * a;
      actualEnergy += b * b;
      dot += a * b;
      squaredError += (a - b) ** 2;
    }
    return {
      correlation:
        referenceEnergy > 0 && actualEnergy > 0
          ? dot / Math.sqrt(referenceEnergy * actualEnergy)
          : 0,
      relativeRmsError: referenceEnergy > 0 ? Math.sqrt(squaredError / referenceEnergy) : Infinity
    };
  };
  const nominal = metrics(0);
  let shiftSamples = 0,
    aligned = nominal;
  for (let shift = -maximumShiftSamples; shift <= maximumShiftSamples; shift++) {
    const next = metrics(shift);
    if (next.relativeRmsError < aligned.relativeRmsError) {
      shiftSamples = shift;
      aligned = next;
    }
  }
  // One shift must fit the entire interval. Independently realigning each region
  // could conceal packet loss, a duplicated packet, or clock drift.
  const regions = Array.from({ length: 3 }, (_, i) =>
    metrics(
      shiftSamples,
      from + Math.floor((i * (to - from)) / 3),
      from + Math.floor(((i + 1) * (to - from)) / 3)
    )
  );
  const good = ({ correlation, relativeRmsError }) => correlation >= 0.98 && relativeRmsError < 0.1;
  return {
    passed: good(aligned) && regions.every(good),
    timeBase: { numerator, denominator },
    maximumShiftSamples,
    shiftSamples,
    nominal,
    aligned,
    regions
  };
}
