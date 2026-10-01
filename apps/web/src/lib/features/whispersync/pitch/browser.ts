import {
  SWIFT_F0_FRAME_SECONDS,
  SWIFT_F0_LEFT_CONTEXT_FRAMES,
  SWIFT_F0_LOOKAHEAD_FRAMES
} from './analysis';
import { PitchController } from './controller';
import type { PitchState } from './model';

const MIN_CONTEXT_SECONDS =
  (SWIFT_F0_LEFT_CONTEXT_FRAMES + 1 + SWIFT_F0_LOOKAHEAD_FRAMES) * SWIFT_F0_FRAME_SECONDS;
const MAX_ANALYSIS_CONTEXT_RATE = Math.floor(32768 / MIN_CONTEXT_SECONDS);

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
  const context = new AudioContext();
  if (context.sampleRate > MAX_ANALYSIS_CONTEXT_RATE) {
    void context.close().catch(() => {});
    throw new Error(
      `Voice pitch needs an audio context at or below ${MAX_ANALYSIS_CONTEXT_RATE} Hz in this browser.`
    );
  }
  return context;
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
