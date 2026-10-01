import { analyseSwiftF0Window, prepareSwiftF0 } from './swift-f0';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage(message: unknown): void;
};

let epoch = -1;
let levels: number[] = [];

scope.onmessage = ({ data }) => {
  if (data?.type !== 'analyze' || !(data.samples instanceof Float32Array)) return;
  if (data.epoch !== epoch) {
    epoch = data.epoch;
    levels = [];
  }
  void analyseSwiftF0Window(data.samples, data.rate)
    .then((results) => {
      if (data.epoch !== epoch) return;
      const gated = results.map((result) => {
        levels.push(result.rms);
        if (levels.length > 64) levels.shift();
        const peak = Math.max(0, ...levels);
        return result.rms < peak * 10 ** (-35 / 20) ? { ...result, hz: null } : result;
      });
      scope.postMessage({
        type: 'result',
        id: data.id,
        results: gated,
        // Retain one value for older test/protocol consumers while the
        // controller consumes the complete batch.
        result: gated.at(-1) ?? null
      });
    })
    .catch((error) => {
      if (data.epoch !== epoch) return;
      scope.postMessage({
        type: 'error',
        id: data.id,
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
