import { PitchController } from './controller';
import type { PitchState } from './model';

export function createPitchController(changed: (state: PitchState) => void) {
  return new PitchController({
    createContext: () => new AudioContext(),
    // The estimator is a separate same-origin chunk fetched ONLY on enable.
    createWorker: () => new Worker(new URL('./voice-pitch.worker.ts', import.meta.url), { type: 'module' }),
    requestFrame: callback => requestAnimationFrame(callback),
    cancelFrame: id => cancelAnimationFrame(id),
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: id => window.clearTimeout(id)
  }, changed);
}
