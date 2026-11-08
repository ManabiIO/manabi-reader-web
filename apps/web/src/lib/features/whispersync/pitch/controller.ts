import { appendPoint, initialPitchState, type PitchState } from './model';
import {
  ANALYSIS_WINDOW_SECONDS,
  MAX_ANALYSER_SAMPLES,
  SAMPLE_INTERVAL_MS,
  SWIFT_F0_FUTURE_CONTEXT_SECONDS,
  hasStableSwiftF0Context,
  type Measurement
} from './analysis';

export interface PitchEnvironment {
  createContext(): AudioContext;
  createWorker(): Worker;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(id: number): void;
  setTimer(callback: () => void, delay: number): number;
  clearTimer(id: number): void;
}

/** Lives with the player, NOT the dismissible transcript sheet.
 * Once captured, a media element must keep its direct destination connection,
 * including while visualization is off. Only the analyser branch is optional. */
interface SpeechAnalysisWindow {
  phrase: number;
  start: number;
  end: number;
  observed: boolean;
  breakBefore: boolean;
  complete: boolean;
}

export class PitchController {
  private environment: PitchEnvironment;
  private changed: (state: PitchState) => void;
  private state = initialPitchState();
  private audio?: HTMLAudioElement;
  private context?: AudioContext;
  private source?: MediaElementAudioSourceNode;
  private analyser?: AnalyserNode;
  private worker?: Worker;
  private samples?: Float32Array<ArrayBuffer>;
  private listeners: (() => void)[] = [];
  private frame?: number;
  private frameGeneration = 0;
  private lastAudioTime = -Infinity;
  private analyserConnected = false;
  private loadTimer?: number;
  private replyTimer?: number;
  private pending?: {
    id: number;
    epoch: number;
    windowStart: number;
    windowSeconds: number;
    playbackRate: number;
    speechWindow: SpeechAnalysisWindow;
    finalWindow: boolean;
  };
  private generation = 0;
  private sequence = 0;
  private epoch = 0;
  private lastSample = -Infinity;
  private visible = false;
  private disposed = false;
  private workerReady = false;
  private buffering = false;
  private sampleAfter = 0;
  private freshAudioAfter = 0;
  private speechWindow?: { start: number; end: number };
  private speechOwner?: object;
  private phrase = 0;
  private analysisWindows: SpeechAnalysisWindow[] = [];

  constructor(environment: PitchEnvironment, changed: (state: PitchState) => void) {
    this.environment = environment;
    this.changed = changed;
  }
  private publish(patch: Partial<PitchState> = {}) {
    const audio = this.audio;
    const activity = !audio
      ? 'idle'
      : audio.ended
        ? 'ended'
        : audio.paused
          ? 'paused'
          : this.buffering || audio.seeking
            ? 'buffering'
            : 'playing';
    this.state = {
      ...this.state,
      ...patch,
      activity,
      speechActive: this.containsSpeechTime(audio?.currentTime ?? 0)
    };
    if (!this.disposed) this.changed(this.state);
  }
  setAudio(audio?: HTMLAudioElement) {
    if (this.disposed || audio === this.audio) return;
    this.stopWork();
    this.listeners.forEach((remove) => remove());
    this.listeners = [];
    this.source?.disconnect();
    this.source = undefined;
    this.audio = audio;
    this.buffering = false;
    this.speechWindow = undefined;
    this.speechOwner = undefined;
    this.reset();
    if (audio) {
      const listen = (event: string, callback: () => void) => {
        audio.addEventListener(event, callback);
        this.listeners.push(() => audio.removeEventListener(event, callback));
      };
      // Keep native Play working even after pitch has been switched off.
      listen('play', () => {
        this.buffering = false;
        this.invalidateSamples();
        this.publish();
        if (this.source && this.context) {
          const context = this.context;
          void context
            .resume()
            .then(() => {
              if (!this.disposed && this.audio === audio) this.schedule();
            })
            .catch(() => {
              if (!this.disposed && this.audio === audio && this.context === context)
                this.fail(
                  'Audio processing could not resume. Retry pitch or reopen the audio file.'
                );
            });
        } else this.schedule();
      });
      listen('playing', () => {
        this.buffering = false;
        this.publish();
        if (this.context?.state === 'running') this.schedule();
      });
      listen('waiting', () => {
        this.buffering = true;
        this.invalidateSamples();
        this.cancelFrame();
        this.publish();
      });
      listen('pause', () => {
        this.buffering = false;
        this.invalidateSamples();
        this.cancelFrame();
        this.publish();
      });
      listen('ended', () => {
        this.invalidateSamples();
        this.cancelFrame();
        this.publish();
      });
      listen('seeking', () => {
        this.reset();
        this.cancelFrame();
      });
      listen('seeked', () => {
        this.buffering = false;
        this.invalidateSamples();
        this.publish();
        this.schedule();
      });
      listen('ratechange', () => {
        this.reset();
        this.schedule();
      });
    }
    if (this.state.enabled && this.visible) this.start();
  }
  setEnabled(enabled: boolean) {
    if (this.disposed) return;
    this.stopWork();
    this.publish({ enabled, status: enabled ? 'ready' : 'off', message: '' });
    this.reset();
    if (enabled && this.visible) this.start();
  }
  setVisible(visible: boolean) {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    this.stopWork();
    this.reset();
    if (visible && this.state.enabled) this.start();
  }
  retry() {
    if (this.state.enabled) this.setEnabled(true);
  }
  setSpeechWindow(bounds?: { start: number; end: number } | null, owner?: object) {
    if (this.disposed) return;
    const next =
      bounds &&
      Number.isFinite(bounds.start) &&
      Number.isFinite(bounds.end) &&
      bounds.start >= 0 &&
      bounds.end > bounds.start
        ? { start: bounds.start, end: bounds.end }
        : undefined;
    const same =
      next?.start === this.speechWindow?.start &&
      next?.end === this.speechWindow?.end &&
      (!next || owner === this.speechOwner);
    const time = this.audio?.currentTime ?? this.state.time;
    if (same) {
      // The player's media clock advances through gaps without model work.
      if (
        this.state.speechActive !== this.containsSpeechTime(time) ||
        (!this.audio?.paused && Math.abs(time - this.state.time) >= 0.1)
      )
        this.publish({ time });
      this.schedule();
      return;
    }
    const outgoing = this.analysisWindows.at(-1) ?? this.pending?.speechWindow;
    const previous = this.speechWindow ?? outgoing;
    const rate = this.audio?.playbackRate ?? 1;
    const forwardBoundary =
      !!previous &&
      !!outgoing?.observed &&
      time >= previous.end &&
      time < previous.end + ANALYSIS_WINDOW_SECONDS * rate &&
      (!next || next.start >= previous.end);
    this.speechWindow = next;
    this.speechOwner = next ? owner : undefined;
    if (!forwardBoundary) this.invalidateSamples(false);
    this.cancelFrame();
    if (next && forwardBoundary)
      this.analysisWindows.push({
        ...next,
        phrase: ++this.phrase,
        observed: time >= next.start && time < next.end,
        breakBefore: true,
        complete: false
      });
    this.publish({ time });
    this.schedule();
  }
  private containsSpeechTime(time: number): boolean {
    return (
      !!this.speechWindow &&
      Number.isFinite(time) &&
      time >= this.speechWindow.start &&
      time < this.speechWindow.end
    );
  }
  private ownsPlayback(
    playbackRate: number,
    finalWindow = false,
    speechWindow = this.speechWindow
  ): boolean {
    const audio = this.audio;
    return (
      !!audio &&
      !audio.paused &&
      !audio.ended &&
      !audio.seeking &&
      !this.buffering &&
      audio.readyState >= 2 &&
      this.context?.state === 'running' &&
      Number.isFinite(playbackRate) &&
      playbackRate > 0 &&
      audio.playbackRate === playbackRate &&
      (finalWindow ||
        (!!speechWindow &&
          audio.currentTime >= speechWindow.start &&
          audio.currentTime < speechWindow.end))
    );
  }
  // Retire both the reply and its watchdog at every playback discontinuity.
  // Keep the paused trace, but never draw a line through the resume boundary.
  private invalidateSamples(waitForFreshAudio = true) {
    this.epoch++;
    this.analysisWindows = this.speechWindow
      ? [
          {
            ...this.speechWindow,
            phrase: ++this.phrase,
            observed: this.containsSpeechTime(this.audio?.currentTime ?? 0),
            breakBefore: true,
            complete: false
          }
        ]
      : [];
    this.pending = undefined;
    if (this.replyTimer !== undefined) this.environment.clearTimer(this.replyTimer);
    this.replyTimer = undefined;
    this.lastSample = -Infinity;
    const now = this.context?.currentTime ?? 0;
    if (waitForFreshAudio) this.freshAudioAfter = now + ANALYSIS_WINDOW_SECONDS;
    this.sampleAfter = Math.max(this.freshAudioAfter, now + SWIFT_F0_FUTURE_CONTEXT_SECONDS);
    try {
      this.worker?.postMessage({ type: 'retire', epoch: this.epoch });
    } catch {
      this.fail('Pitch analysis could not communicate. Retry to reload it.');
    }
  }
  private reset() {
    this.invalidateSamples();
    this.lastAudioTime = -Infinity;
    this.publish({
      points: [],
      speechActive: !!this.speechWindow,
      time: this.audio?.currentTime ?? 0
    });
  }
  private start() {
    if (this.disposed || !this.state.enabled || !this.visible || this.worker) return;
    const audio = this.audio;
    if (!audio) {
      this.publish({ status: 'ready', message: 'Choose an audio file to see pitch.' });
      return;
    }
    const generation = this.generation;
    const current = () => !this.disposed && generation === this.generation && this.audio === audio;
    this.publish({ status: 'loading', message: 'Loading pitch visualization…' });
    try {
      // resume() is invoked in the toggle's user gesture, before any download.
      const context = (this.context ??= this.environment.createContext());
      if (!hasStableSwiftF0Context(context.sampleRate, MAX_ANALYSER_SAMPLES)) {
        // No MediaElementAudioSourceNode exists yet, so this context is safe
        // to close. Retry must create a fresh context after the output device
        // changes instead of reusing the same unsupported sample rate.
        if (!this.source && this.context === context) {
          this.context = undefined;
          void context.close().catch(() => {});
        }
        this.fail(
          `Pitch needs a lower audio output rate. This device is using ${Math.round(
            context.sampleRate / 1000
          )} kHz; switch it to 48 kHz and retry.`
        );
        return;
      }
      const resumed = context.resume();
      // Observe rejection even if Worker construction throws synchronously.
      void resumed.catch(() => {});
      const worker = this.environment.createWorker();
      this.worker = worker;
      let contextReady = false;
      const begin = () => {
        if (!current() || !contextReady || !this.workerReady) return;
        try {
          if (!this.source) {
            this.source = context.createMediaElementSource(audio);
            this.source.connect(context.destination);
          }
          const analyser = context.createAnalyser();
          analyser.fftSize = Math.min(
            32768,
            2 ** Math.ceil(Math.log2(context.sampleRate * ANALYSIS_WINDOW_SECONDS))
          );
          this.samples = new Float32Array(analyser.fftSize);
          this.analyser = analyser;
          this.source.connect(analyser);
          this.analyserConnected = true;
          if (this.loadTimer !== undefined) this.environment.clearTimer(this.loadTimer);
          this.loadTimer = undefined;
          this.freshAudioAfter = context.currentTime + ANALYSIS_WINDOW_SECONDS;
          this.sampleAfter = this.freshAudioAfter;
          this.publish({ status: 'ready', message: '' });
          this.schedule();
        } catch {
          this.fail(
            'Pitch visualization is unavailable. Reopen the audio file if playback is affected.'
          );
        }
      };
      worker.onmessage = (event: MessageEvent) => {
        if (!current()) return;
        if (event.data?.type === 'ready') {
          if (!this.workerReady) {
            this.workerReady = true;
            begin();
          }
        } else if (
          event.data?.type === 'result' &&
          this.pending &&
          event.data.id === this.pending.id &&
          event.data.epoch === this.pending.epoch
        ) {
          const pending = this.pending;
          this.pending = undefined;
          if (this.replyTimer !== undefined) this.environment.clearTimer(this.replyTimer);
          this.replyTimer = undefined;
          if (!this.ownsPlayback(pending.playbackRate, pending.finalWindow, pending.speechWindow))
            return;
          const results = (
            Array.isArray(event.data.results) ? event.data.results : [event.data.result]
          ) as Measurement[];
          if (
            !results.length ||
            results.some(
              (result) =>
                !result ||
                !Number.isFinite(result.amplitude) ||
                result.amplitude < 0 ||
                !Number.isFinite(result.rms) ||
                result.rms < 0 ||
                !Number.isFinite(result.confidence) ||
                result.confidence < 0 ||
                result.confidence > 1 ||
                !Number.isFinite(result.offsetSeconds) ||
                !Number.isFinite(result.windowSeconds) ||
                result.windowSeconds <= 0 ||
                Math.abs(result.windowSeconds - pending.windowSeconds) > 1e-6 ||
                result.offsetSeconds < 0 ||
                result.offsetSeconds > result.windowSeconds ||
                (result.hz !== null &&
                  (!Number.isFinite(result.hz) || result.hz < 85 || result.hz > 520))
            )
          ) {
            this.fail('Pitch analysis returned invalid data. Retry to reload it.');
            return;
          }
          let points = this.state.points;
          let appended = false;
          for (const result of results) {
            const time = pending.windowStart + result.offsetSeconds * pending.playbackRate;
            const previousTime = points.at(-1)?.time ?? -Infinity;
            // Consecutive analysis windows overlap by design. Keep only newly
            // stable frames; never reset history because an overlap repeated
            // a timestamp already published by the previous batch.
            const speechWindow = pending.speechWindow;
            if (
              !speechWindow ||
              time < speechWindow.start ||
              time >= speechWindow.end ||
              time <= previousTime + 0.004
            )
              continue;
            points = appendPoint(points, {
              time,
              hz: result.hz,
              amplitude: result.amplitude,
              breakBefore: pending.speechWindow.breakBefore && !appended
            });
            appended = true;
          }
          this.publish({ points, time: audio.currentTime });
          if (appended) pending.speechWindow.breakBefore = false;
          this.schedule();
        } else if (event.data?.type === 'error') {
          if (event.data.phase === 'analysis') {
            if (
              !this.pending ||
              event.data.id !== this.pending.id ||
              event.data.epoch !== this.pending.epoch
            )
              return;
            const pending = this.pending;
            this.pending = undefined;
            if (this.replyTimer !== undefined) this.environment.clearTimer(this.replyTimer);
            this.replyTimer = undefined;
            // paused/seeking can become true before their DOM event callback
            // runs. A request that just lost playback authority must not turn
            // that user action into an analysis failure.
            if (!this.ownsPlayback(pending.playbackRate, pending.finalWindow, pending.speechWindow))
              return;
          }
          this.fail('Pitch analysis could not load or run. Check your connection and retry.');
        }
      };
      worker.onerror = () => {
        if (current())
          this.fail('Pitch analysis could not load or run. Check your connection and retry.');
      };
      worker.onmessageerror = () => {
        if (current()) this.fail('Pitch analysis could not communicate. Retry to reload it.');
      };
      this.loadTimer = this.environment.setTimer(() => {
        if (current())
          this.fail(
            this.workerReady
              ? 'Audio analysis could not start. Check your audio output, then retry.'
              : 'Pitch could not load. Check your connection, then retry.'
          );
      }, 15000);
      void resumed
        .then(() => {
          if (!current()) return;
          if (context.state !== 'running') {
            this.fail('Press Retry to allow audio analysis in this browser.');
            return;
          }
          contextReady = true;
          begin();
        })
        .catch(() => {
          if (current()) this.fail('Press Retry to allow audio analysis in this browser.');
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      this.fail(
        message.startsWith('Voice pitch needs an audio context')
          ? message
          : 'Voice pitch requires browser Web Audio and worker support.'
      );
    }
  }
  private schedule() {
    if (
      this.disposed ||
      this.frame !== undefined ||
      !this.visible ||
      !this.state.enabled ||
      this.state.status !== 'ready' ||
      !this.analyser ||
      !this.worker ||
      !this.audio ||
      !this.analysisWindows.some(
        (window) => !window.complete && (window.observed || this.audio!.currentTime < window.end)
      ) ||
      this.audio.paused ||
      this.audio.ended ||
      this.audio.seeking ||
      this.buffering
    )
      return;
    const generation = this.generation;
    const frameGeneration = this.frameGeneration;
    this.frame = this.environment.requestFrame((now) => {
      if (
        generation !== this.generation ||
        frameGeneration !== this.frameGeneration ||
        this.disposed
      )
        return;
      this.frame = undefined;
      const audio = this.audio!;
      const context = this.context!;
      if (audio.paused || audio.ended || audio.seeking || this.buffering) return;
      if (context.state !== 'running') {
        this.fail('Audio analysis was interrupted. Press Retry to resume it.');
        return;
      }
      if (!Number.isFinite(audio.playbackRate) || audio.playbackRate <= 0) return;
      // Once a cue has left the analyser buffer it cannot be reconstructed.
      this.analysisWindows = this.analysisWindows.filter(
        (window) =>
          !window.complete &&
          audio.currentTime < window.end + ANALYSIS_WINDOW_SECONDS * audio.playbackRate
      );
      const speechWindow = this.analysisWindows.find(
        (window) =>
          !window.complete &&
          (window.observed || (audio.currentTime >= window.start && audio.currentTime < window.end))
      );
      if (!speechWindow) {
        // An explicitly selected upcoming cue still needs a clock callback at
        // entry. Keep waiting without sending any pre-cue samples to the model.
        this.schedule();
        return;
      }
      if (audio.currentTime >= speechWindow.start && audio.currentTime < speechWindow.end)
        speechWindow.observed = true;
      const finalWindow = audio.currentTime >= speechWindow.end;
      // A cue's last frames need real future analyser context. Keep its own
      // masked final window alive through a gap or the following cue, without
      // admitting any of that later audio as dialogue from the outgoing cue.
      const finalReady =
        audio.currentTime >=
        speechWindow.end + SWIFT_F0_FUTURE_CONTEXT_SECONDS * audio.playbackRate;
      if (
        !audio.paused &&
        !audio.seeking &&
        !this.pending &&
        context.currentTime >= this.sampleAfter &&
        audio.readyState >= 2 &&
        (finalWindow ? finalReady : now - this.lastSample >= SAMPLE_INTERVAL_MS) &&
        audio.currentTime !== this.lastAudioTime
      ) {
        this.lastSample = now;
        this.lastAudioTime = audio.currentTime;
        try {
          this.analyser!.getFloatTimeDomainData(this.samples!);
          const count = Math.min(
            this.samples!.length,
            Math.ceil(context.sampleRate * ANALYSIS_WINDOW_SECONDS)
          );
          const samples = this.samples!.slice(-count);
          const windowSeconds = samples.length / context.sampleRate;
          // Preserve leading pre-zero time; clamping shifts every sample when
          // playback is less than one rolling window into the media.
          const mediaStep = audio.playbackRate / context.sampleRate;
          const windowStart = audio.currentTime - samples.length * mediaStep;
          const cueStart = Math.min(
            samples.length,
            Math.max(0, Math.ceil((speechWindow.start - windowStart) / mediaStep))
          );
          const cueEnd = Math.min(
            samples.length,
            Math.max(cueStart, Math.ceil((speechWindow.end - windowStart) / mediaStep))
          );
          samples.fill(0, 0, cueStart);
          samples.fill(0, cueEnd);
          const id = ++this.sequence;
          const playbackRate = audio.playbackRate;
          this.pending = {
            id,
            epoch: this.epoch,
            windowStart,
            windowSeconds,
            playbackRate,
            speechWindow,
            finalWindow
          };
          if (finalWindow) speechWindow.complete = true;
          this.analysisWindows = this.analysisWindows.filter((window) => !window.complete);
          this.worker!.postMessage(
            {
              type: 'analyze',
              samples,
              rate: context.sampleRate,
              id,
              epoch: this.epoch,
              phrase: speechWindow.phrase
            },
            [samples.buffer]
          );
          this.replyTimer = this.environment.setTimer(() => {
            if (this.pending?.id !== id) return;
            if (!this.ownsPlayback(playbackRate, finalWindow, speechWindow)) {
              this.pending = undefined;
              this.replyTimer = undefined;
              return;
            }
            this.fail('Pitch analysis stopped responding. Retry to restart it.');
          }, 5000);
        } catch {
          this.fail(
            'Pitch analysis could not read this audio. Playback controls remain available.'
          );
          return;
        }
      }
      this.schedule();
    });
  }
  private cancelFrame() {
    this.frameGeneration++;
    if (this.frame !== undefined) this.environment.cancelFrame(this.frame);
    this.frame = undefined;
  }
  private stopWork() {
    this.generation++;
    this.cancelFrame();
    for (const timer of [this.loadTimer, this.replyTimer]) {
      if (timer !== undefined) this.environment.clearTimer(timer);
    }
    this.loadTimer = this.replyTimer = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    this.workerReady = false;
    this.pending = undefined;
    if (this.analyserConnected && this.analyser) this.source?.disconnect(this.analyser);
    this.analyserConnected = false;
    this.analyser = undefined;
    this.samples = undefined;
    // Do NOT suspend/close the context or disconnect the destination here:
    // that would silence native playback when hiding the sheet or toggling off.
  }
  private fail(message: string) {
    if (this.disposed) return;
    this.stopWork();
    this.publish({ status: 'error', message });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopWork();
    this.listeners.forEach((remove) => remove());
    this.listeners = [];
    this.source?.disconnect();
    this.source = undefined;
    this.audio = undefined;
    if (this.context) void this.context.close().catch(() => {});
    this.context = undefined;
  }
}
