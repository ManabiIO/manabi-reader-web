import { analyseFrame } from './analysis';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage(message: unknown): void;
};
let epoch = -1;
let recent: number[] = [];
let levels: number[] = [];
scope.onmessage = ({ data }) => {
  if (!(data.samples instanceof Float32Array)) return;
  if (data.epoch !== epoch) {
    epoch = data.epoch;
    recent = [];
    levels = [];
  }
  const result = analyseFrame(data.samples, data.rate);
  levels.push(result.rms);
  if (levels.length > 50) levels.shift();
  const peak = Math.max(...levels);
  if (result.rms < peak * 10 ** (-35 / 20)) result.hz = null;
  if (result.hz === null) recent = [];
  else {
    recent.push(Math.log2(result.hz));
    if (recent.length > 3) recent.shift();
    const sorted = [...recent].sort((a, b) => a - b);
    result.hz = 2 ** sorted[Math.floor(sorted.length / 2)];
  }
  scope.postMessage({ type: 'result', id: data.id, result });
};
scope.postMessage({ type: 'ready' });
