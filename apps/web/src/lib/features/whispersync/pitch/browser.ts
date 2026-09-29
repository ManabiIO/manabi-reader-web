import { PitchController } from './controller';
import type { PitchState } from './model';

export function createPitchController(changed: (state: PitchState) => void) {
  return new PitchController(
    {
      createContext: () => {
        try {
          return new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
        } catch {
          return new AudioContext();
        }
      },
      // SwiftF0, its model and ONNX/WASM runtime are a separate same-origin
      // worker graph fetched ONLY after the user enables Voice pitch.
      createWorker: () =>
        new Worker(new URL('./voice-pitch.worker.ts', import.meta.url), { type: 'module' }),
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id),
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      clearTimer: (id) => window.clearTimeout(id)
    },
    changed
  );
}
