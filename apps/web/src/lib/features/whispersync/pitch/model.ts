export interface PitchPoint {
  time: number;
  hz: number | null;
  amplitude: number;
  breakBefore?: boolean;
}
export interface PitchState {
  enabled: boolean;
  status: 'off' | 'loading' | 'ready' | 'error';
  activity: 'idle' | 'playing' | 'paused' | 'buffering' | 'ended';
  message: string;
  points: readonly PitchPoint[];
  time: number;
}
export const initialPitchState = (): PitchState => ({
  enabled: false,
  status: 'off',
  activity: 'idle',
  message: '',
  points: [],
  time: 0
});
export const WINDOW_SECONDS = 8;
export const MAX_POINTS = 400;
const MAX_GAP = 0.18;
const pitchY = (hz: number) => 90 - (Math.log2(hz / 85) / Math.log2(520 / 85)) * 76;
export const PITCH_GUIDES = [400, 200, 100].map((hz) => ({ hz, y: pitchY(hz) }));

/** Bounded history; reset on seeks, loops and backwards timestamps. */
export function appendPoint(points: readonly PitchPoint[], point: PitchPoint): PitchPoint[] {
  if (!Number.isFinite(point.time) || point.time < 0 || !Number.isFinite(point.amplitude))
    return [...points];
  const previous = points.at(-1);
  const kept = previous && point.time <= previous.time ? [] : points;
  return [...kept.filter((p) => p.time >= point.time - WINDOW_SECONDS), point].slice(-MAX_POINTS);
}

/** Fixed log-frequency scale and a rolling media-time window, not a grading target. */
export function pitchPaths(points: readonly PitchPoint[], time: number) {
  const end = Math.max(0, Number.isFinite(time) ? time : 0);
  const start = end - WINDOW_SECONDS;
  const visible = points
    .filter((p) => p.time >= Math.max(0, start) && p.time <= end && Number.isFinite(p.amplitude))
    .slice(-MAX_POINTS);
  const max = Math.max(0.01, ...visible.map((p) => p.amplitude));
  const x = (point: PitchPoint) => 8 + ((point.time - start) / WINDOW_SECONDS) * 616;
  const height = (point: PitchPoint) => Math.min(30, Math.max(0, (point.amplitude / max) * 30));
  const adjacent = (a: PitchPoint, b: PitchPoint) =>
    !b.breakBefore && b.time > a.time && b.time - a.time <= MAX_GAP;
  let waveform = '';
  let pitch = '';
  let previous: PitchPoint | undefined;
  let segment: PitchPoint[] = [];
  let marker: { x: number; y: number } | undefined;
  const closeEnvelope = () => {
    if (!segment.length) return;
    const first = segment[0];
    const last = segment[segment.length - 1];
    waveform += `M${(x(first) - 0.8).toFixed(2)},52`;
    for (const p of segment) waveform += `L${x(p).toFixed(2)},${(52 - height(p)).toFixed(2)}`;
    waveform += `L${(x(last) + 0.8).toFixed(2)},52`;
    for (let i = segment.length - 1; i >= 0; i--) {
      const p = segment[i];
      waveform += `L${x(p).toFixed(2)},${(52 + height(p)).toFixed(2)}`;
    }
    waveform += 'Z';
    segment = [];
  };
  for (const point of visible) {
    if (segment.length && !adjacent(segment[segment.length - 1], point)) closeEnvelope();
    segment.push(point);
    if (point.hz !== null && Number.isFinite(point.hz) && point.hz >= 85 && point.hz <= 520) {
      const y = pitchY(point.hz);
      const join =
        previous?.hz != null &&
        adjacent(previous, point) &&
        Math.abs(Math.log2(point.hz / previous.hz)) <= 0.75;
      // A tiny round-capped segment also makes an isolated voiced frame visible.
      pitch += `${join ? 'L' : 'M'}${x(point).toFixed(2)},${y.toFixed(2)}${join ? '' : 'l0.01,0'}`;
      previous = point;
      marker = end - point.time <= MAX_GAP ? { x: x(point), y } : undefined;
    } else {
      previous = undefined;
      marker = undefined;
    }
  }
  closeEnvelope();
  return { waveform, pitch, ...(marker ? { marker } : {}) };
}
