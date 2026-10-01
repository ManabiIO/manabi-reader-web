import { PitchController } from './controller';
import type { PitchState } from './model';

function createAudioContext() {
  // AnalyserNode is capped at 32,768 samples. Keep the analysis context at a
  // normal speech/audio rate so the full 640 ms SwiftF0 context fits even when
  // the physical output device itself runs at 96/192 kHz.
  for (const sampleRate of [48000, 44100]) {
    try {
      return new AudioContext({ sampleRate });
    } catch {
      // Try the other common rate before accepting the device-native context.
    }
  }
  return new AudioContext();
}

export function createPitchController(changed: (state: PitchState) => void) {
  return new PitchController(
    {
      createContext: createAudioContext,
      // The estimator is a separate same-origin chunk fetched ONLY on enable.
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
