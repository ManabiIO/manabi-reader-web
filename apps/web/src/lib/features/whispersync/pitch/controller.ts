import { appendPoint, initialPitchState, type PitchState } from './model';
import type { Measurement } from './analysis';

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
  private pending?: { id: number; time: number };
  private generation = 0;
  private sequence = 0;
  private epoch = 0;
  private lastSample = -Infinity;
  private visible = false;
  private disposed = false;
  private workerReady = false;

  constructor(environment: PitchEnvironment, changed: (state: PitchState) => void) {
    this.environment = environment;
    this.changed = changed;
  }
  private publish(patch: Partial<PitchState> = {}) {
    this.state = { ...this.state, ...patch };
    if (!this.disposed) this.changed(this.state);
  }
  setAudio(audio?: HTMLAudioElement) {
    if (this.disposed || audio === this.audio) return;
    this.stopWork();
    this.listeners.forEach(remove => remove());
    this.listeners = [];
    this.source?.disconnect();
    this.source = undefined;
    this.audio = audio;
    this.reset();
    if (audio) {
      const listen = (event: string, callback: () => void) => {
        audio.addEventListener(event, callback);
        this.listeners.push(() => audio.removeEventListener(event, callback));
      };
      // Keep native Play working even after pitch has been switched off.
      listen('play', () => {
        if (this.source && this.context) {
          const context = this.context;
          void context.resume().then(() => {
            if (!this.disposed && this.audio === audio) this.schedule();
          }).catch(() => {
            if (!this.disposed && this.audio === audio && this.context === context)
              this.fail('Audio processing could not resume. Retry pitch or reopen the audio file.');
          });
        }
        this.schedule();
      });
      listen('pause', () => { this.epoch++; this.cancelFrame(); });
      listen('ended', () => this.cancelFrame());
      listen('seeking', () => { this.reset(); this.cancelFrame(); });
      listen('seeked', () => this.schedule());
      listen('ratechange', () => { this.reset(); this.schedule(); });
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
  retry() { if (this.state.enabled) this.setEnabled(true); }
  private reset() {
    this.epoch++;
    this.pending = undefined;
    if (this.replyTimer !== undefined) this.environment.clearTimer(this.replyTimer);
    this.replyTimer = undefined;
    this.lastSample = -Infinity;
    this.lastAudioTime = -Infinity;
    this.publish({ points: [], time: this.audio?.currentTime ?? 0 });
  }
  private start() {
    if (this.disposed || !this.state.enabled || !this.visible || this.worker) return;
    const audio = this.audio;
    if (!audio) { this.publish({ status: 'ready', message: 'Choose an audio file to see pitch.' }); return; }
    const generation = this.generation;
    const current = () => !this.disposed && generation === this.generation && this.audio === audio;
    this.publish({ status: 'loading', message: 'Loading pitch visualization…' });
    try {
      // resume() is invoked in the toggle's user gesture, before any download.
      const context = this.context ??= this.environment.createContext();
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
          analyser.fftSize = Math.min(16384, 2 ** Math.ceil(Math.log2(context.sampleRate * 0.04)));
          this.samples = new Float32Array(analyser.fftSize);
          this.analyser = analyser;
          this.source.connect(analyser);
          this.analyserConnected = true;
          if (this.loadTimer !== undefined) this.environment.clearTimer(this.loadTimer);
          this.loadTimer = undefined;
          this.publish({ status: 'ready', message: '' });
          this.schedule();
        } catch { this.fail('Pitch visualization is unavailable. Reopen the audio file if playback is affected.'); }
      };
      worker.onmessage = (event: MessageEvent) => {
        if (!current()) return;
        if (event.data?.type === 'ready') {
          if (!this.workerReady) { this.workerReady = true; begin(); }
        } else if (event.data?.type === 'result' && event.data.id === this.pending?.id) {
          const pending = this.pending!;
          this.pending = undefined;
          if (this.replyTimer !== undefined) this.environment.clearTimer(this.replyTimer);
          this.replyTimer = undefined;
          const result = event.data.result as Measurement;
          if (!result || !Number.isFinite(result.amplitude) || result.amplitude < 0 ||
              (result.hz !== null && (!Number.isFinite(result.hz) || result.hz < 85 || result.hz > 520))) {
            this.fail('Pitch analysis returned invalid data. Retry to reload it.'); return;
          }
          this.publish({ points: appendPoint(this.state.points, {
            time: pending.time, hz: result.hz, amplitude: result.amplitude
          }), time: audio.currentTime });
        }
      };
      worker.onerror = () => { if (current()) this.fail('Pitch analysis could not load or run. Check your connection and retry.'); };
      worker.onmessageerror = () => { if (current()) this.fail('Pitch analysis could not communicate. Retry to reload it.'); };
      this.loadTimer = this.environment.setTimer(() => {
        if (current()) this.fail('Pitch visualization took too long to load. Check your connection and retry.');
      }, 15000);
      void resumed.then(() => {
        if (!current()) return;
        if (context.state !== 'running') { this.fail('Press Retry to allow audio analysis in this browser.'); return; }
        contextReady = true;
        begin();
      }).catch(() => { if (current()) this.fail('Press Retry to allow audio analysis in this browser.'); });
    } catch { this.fail('Voice pitch requires browser Web Audio and worker support.'); }
  }
  private schedule() {
    if (this.disposed || this.frame !== undefined || !this.visible || !this.state.enabled ||
        this.state.status !== 'ready' || !this.analyser || !this.worker || !this.audio ||
        this.audio.paused || this.audio.ended || this.audio.seeking) return;
    const generation = this.generation;
    const frameGeneration = this.frameGeneration;
    this.frame = this.environment.requestFrame(now => {
      if (generation !== this.generation || frameGeneration !== this.frameGeneration || this.disposed) return;
      this.frame = undefined;
      const audio = this.audio!;
      const context = this.context!;
      if (context.state !== 'running') {
        this.fail('Audio analysis was interrupted. Press Retry to resume it.'); return;
      }
      if (!audio.paused && !audio.seeking && !this.pending && now - this.lastSample >= 40 && audio.currentTime !== this.lastAudioTime) {
        this.lastSample = now;
        this.lastAudioTime = audio.currentTime;
        try {
          this.analyser!.getFloatTimeDomainData(this.samples!);
          const count = Math.ceil(context.sampleRate * 0.04);
          const samples = this.samples!.slice(-count);
          const time = Math.max(0, audio.currentTime - samples.length / context.sampleRate * audio.playbackRate / 2);
          const id = ++this.sequence;
          this.pending = { id, time };
          this.worker!.postMessage({ samples, rate: context.sampleRate, id, epoch: this.epoch }, [samples.buffer]);
          this.replyTimer = this.environment.setTimer(() => {
            if (this.pending?.id === id) this.fail('Pitch analysis stopped responding. Retry to restart it.');
          }, 5000);
        } catch { this.fail('Pitch analysis could not read this audio. Playback controls remain available.'); return; }
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
    this.listeners.forEach(remove => remove());
    this.listeners = [];
    this.source?.disconnect();
    this.source = undefined;
    this.audio = undefined;
    if (this.context) void this.context.close().catch(() => {});
    this.context = undefined;
  }
}
