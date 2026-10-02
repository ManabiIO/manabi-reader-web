import { PitchController } from './controller';
import type { PitchState } from './model';

function createAudioContext() {
  try {
    // AnalyserNode is capped at 32,768 samples. A 48 kHz context preserves
    // the full 550 ms SwiftF0 window even on devices with 96/192 kHz output.
    return new AudioContext({ sampleRate: 48000 });
  } catch {
    // Some output devices reject an explicit rate. Retain pitch at the native
    // rate rather than disabling it; the analyser still provides a shorter window.
    return new AudioContext();
  }
}

export function createPitchController(changed: (state: PitchState) => void) {
  return new PitchController(
    {
      createContext: createAudioContext,
      // The estimator is a separate same-origin chunk fetched ONLY on enable.
      createWorker: () => {
        const worker = new Worker(new URL('./voice-pitch.worker.ts', import.meta.url), { type: 'module' });
        // DOM exports use document-relative asset paths. A worker's own location
        // points at a chunk/blob, so send the trusted owning document explicitly.
        worker.postMessage({ type: 'init', assetBaseURL: document.baseURI });
        return worker;
      },
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id),
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      clearTimer: (id) => window.clearTimeout(id)
    },
    changed
  );
}
