export interface PitchPoint {
  time: number;
  hz: number | null;
  amplitude: number;
}
export interface PitchState {
  enabled: boolean;
  status: 'off' | 'loading' | 'ready' | 'error';
  message: string;
  points: readonly PitchPoint[];
  time: number;
}
export const initialPitchState = (): PitchState => ({
  enabled: false,
  status: 'off',
  message: '',
  points: [],
  time: 0
});
export const WINDOW_SECONDS = 8;
export const MAX_POINTS = 400;

/** Bounded history; reset on seeks, loops and backwards timestamps. */
export function appendPoint(points: readonly PitchPoint[], point: PitchPoint): PitchPoint[] {
  if (!Number.isFinite(point.time) || point.time < 0 || !Number.isFinite(point.amplitude))
    return [...points];
  const previous = points.at(-1);
  const kept = previous && point.time <= previous.time ? [] : points;
  return [...kept.filter((p) => p.time >= point.time - WINDOW_SECONDS), point].slice(-MAX_POINTS);
}

/** Five horizontal guides, continuous log-frequency contour, no kana or target colours. */
export function pitchPaths(points: readonly PitchPoint[], time: number) {
  const end = Math.max(WINDOW_SECONDS, Number.isFinite(time) ? time : 0);
  const start = end - WINDOW_SECONDS;
  const visible = points.filter(
    (p) => p.time >= start && p.time <= end && Number.isFinite(p.amplitude)
  );
  const max = Math.max(0.01, ...visible.map((p) => p.amplitude));
  let waveform = '';
  let pitch = '';
  let previous: PitchPoint | undefined;
  for (const point of visible) {
    const x = (8 + ((point.time - start) / WINDOW_SECONDS) * 624).toFixed(2);
    const height = Math.min(25, Math.max(0, (point.amplitude / max) * 25));
    if (height > 0.1) waveform += `M${x},${(36 - height).toFixed(2)}V${(36 + height).toFixed(2)}`;
    if (point.hz !== null && Number.isFinite(point.hz) && point.hz >= 85 && point.hz <= 520) {
      const y = (62 - (Math.log2(point.hz / 85) / Math.log2(520 / 85)) * 52).toFixed(2);
      const join =
        previous?.hz != null && point.time > previous.time && point.time - previous.time <= 0.16;
      pitch += `${join ? 'L' : 'M'}${x},${y}`;
      previous = point;
    } else previous = undefined;
  }
  return { waveform, pitch };
}
