import { analyseSwiftF0Window, prepareSwiftF0 } from './swift-f0';
import { LatestEpochQueue } from './worker-queue';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage(message: unknown): void;
};

interface AnalysisRequest {
  type: 'analyze';
  id: number;
  epoch: number;
  rate: number;
  samples: Float32Array;
}

let levelEpoch = -1;
let levels: number[] = [];

const queue = new LatestEpochQueue<AnalysisRequest>(async (data, current) => {
  const result = await analyseSwiftF0Window(data.samples, data.rate);
  if (!current()) return;
  levels.push(result.rms);
  if (levels.length > 24) levels.shift();
  const peak = Math.max(0, ...levels);
  if (result.rms < peak * 10 ** (-35 / 20)) result.hz = null;
  scope.postMessage({ type: 'result', id: data.id, result });
});

scope.onmessage = ({ data }) => {
  if (
    data?.type !== 'analyze' ||
    !(data.samples instanceof Float32Array) ||
    !Number.isSafeInteger(data.id) ||
    !Number.isSafeInteger(data.epoch)
  )
    return;
  const request = data as AnalysisRequest;
  if (request.epoch !== levelEpoch) {
    levelEpoch = request.epoch;
    levels = [];
  }
  void queue.submit(request).catch((error) => {
    if (request.epoch !== levelEpoch) return;
    scope.postMessage({
      type: 'error',
      id: request.id,
      phase: 'analysis',
      error: String(error?.message || error || 'SwiftF0 analysis failed')
    });
  });
};

void prepareSwiftF0()
  .then(() => scope.postMessage({ type: 'ready', detector: 'swift-f0-0.3.0' }))
  .catch((error) =>
    scope.postMessage({
      type: 'error',
      phase: 'load',
      error: String(error?.message || error || 'SwiftF0 could not load')
    })
  );
