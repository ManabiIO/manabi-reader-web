/** @license MIT — Manabi Reader adaptations; see docs/whispersync.md. */
export interface AudioIdentity {
  name: string;
  size: number;
  lastModified: number;
}
export interface PlaybackState {
  file?: AudioIdentity;
  time: number;
  duration: number;
  ready: boolean;
  paused: boolean;
  rate: number;
  loop?: { start: number; end: number };
  error?: string;
}
export interface PlayerEnvironment {
  createAudio: () => HTMLAudioElement;
  createURL: (file: File) => string;
  revokeURL: (url: string) => void;
  attach: (audio?: HTMLAudioElement) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
}
export function audioIdentity(file: AudioIdentity): string {
  // Metadata identity, not a content hash: no multi-gigabyte audio read/copy.
  return JSON.stringify([file.name, file.size, file.lastModified]);
}
const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clampRate = (rate: number) => Math.min(3, Math.max(0.5, finite(rate, 1)));

/** Owns the media element, its listeners, frame callback and one local blob URL. */
export class LocalAudioPlayer {
  private audio?: HTMLAudioElement;
  private url?: string;
  private removeListeners: (() => void)[] = [];
  private frame?: number;
  private disposed = false;
  private pendingSeek?: number;
  private metadataLoaded = false;
  private playbackRequested = false;
  private playGeneration = 0;
  private frameGeneration = 0;
  private state: PlaybackState = { time: 0, duration: 0, ready: false, paused: true, rate: 1 };

  constructor(
    private readonly environment: PlayerEnvironment,
    private readonly changed: (state: PlaybackState) => void
  ) {}

  get snapshot(): PlaybackState {
    return {
      ...this.state,
      file: this.state.file && { ...this.state.file },
      loop: this.state.loop && { ...this.state.loop }
    };
  }

  private publish(): void {
    if (!this.disposed) this.changed(this.snapshot);
  }

  load(file: File, resume?: { identity: string; position: number }): void {
    if (this.disposed) return;
    this.release();
    const rate = this.state.rate;
    this.state = {
      file: { name: file.name, size: file.size, lastModified: file.lastModified },
      time: 0,
      duration: 0,
      ready: false,
      paused: true,
      rate
    };
    this.pendingSeek =
      resume?.identity === audioIdentity(file) ? Math.max(0, finite(resume.position)) : 0;
    this.state.time = this.pendingSeek;
    try {
      const audio = this.environment.createAudio();
      this.audio = audio;
      audio.controls = true;
      audio.preload = 'metadata';
      audio.setAttribute('aria-label', 'Audiobook playback');
      audio.style.width = '100%';
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
      const listen = (type: string, callback: () => void) => {
        const guarded = () => {
          if (!this.disposed && this.audio === audio) callback();
        };
        audio.addEventListener(type, guarded);
        this.removeListeners.push(() => audio.removeEventListener(type, guarded));
      };
      listen('loadedmetadata', () => {
        this.metadataLoaded = true;
        this.updateDuration();
      });
      listen('durationchange', () => this.updateDuration());
      listen('canplay', () => this.updateDuration());
      listen('timeupdate', () => this.update());
      listen('seeked', () => this.update());
      listen('seeking', () => {
        const loop = this.state.loop;
        if (loop && (audio.currentTime < loop.start || audio.currentTime >= loop.end))
          this.clearLoop();
        this.update();
      });
      listen('play', () => {
        if (!audio.paused) {
          this.playbackRequested = true;
          this.state.error = undefined;
          this.update();
          this.scheduleLoopFrame();
        }
      });
      listen('pause', () => {
        if (audio.paused) {
          if (!audio.ended) this.playbackRequested = false;
          this.playGeneration += 1;
          this.cancelLoopFrame();
        }
        this.update();
      });
      listen('ratechange', () => {
        this.state.rate = clampRate(audio.playbackRate);
        if (audio.playbackRate !== this.state.rate) audio.playbackRate = this.state.rate;
        this.publish();
      });
      listen('ended', () => {
        if (this.state.loop && this.playbackRequested) {
          this.seek(this.state.loop.start);
          void this.play();
        } else this.update();
      });
      listen('error', () => {
        this.state.error =
          'This audio file could not be played. Try a browser-supported codec or another local file.';
        this.state.ready = false;
        this.state.paused = true;
        this.state.loop = undefined;
        // Retire this media lifetime. Late metadata/play completion cannot revive it.
        this.release();
        this.publish();
      });
      this.url = this.environment.createURL(file);
      audio.src = this.url;
      this.environment.attach(audio);
      audio.load();
    } catch {
      this.release();
      this.state.ready = false;
      this.state.paused = true;
      this.state.loop = undefined;
      this.state.error = 'The local audio file could not be opened.';
    }
    this.publish();
  }

  private clearLoop(): void {
    this.state.loop = undefined;
    this.cancelLoopFrame();
  }

  private updateDuration(): void {
    const audio = this.audio;
    if (!audio) return;
    const duration = audio.duration;
    if (!this.metadataLoaded || !Number.isFinite(duration) || duration <= 0) {
      if (this.state.ready) this.pendingSeek = this.state.time;
      this.state.ready = false;
      this.state.duration = Math.max(0, finite(duration));
      this.clearLoop();
      this.publish();
      return;
    }
    this.state.duration = duration;
    this.state.ready = true;
    if (this.state.loop && this.state.loop.end > duration) this.clearLoop();
    if (this.pendingSeek !== undefined) {
      try {
        audio.currentTime = Math.min(duration, this.pendingSeek);
        this.pendingSeek = undefined;
        this.state.error = undefined;
      } catch {
        // Some engines cannot seek until canplay. Keep the checkpoint rather
        // than publishing ready-at-zero and overwriting saved progress.
        this.state.ready = false;
        this.state.error = 'Waiting for the audio file to become seekable.';
      }
    }
    this.update();
  }

  private update(): void {
    const audio = this.audio;
    if (!audio) return;
    const loop = this.state.loop;
    if (loop && !audio.paused && !audio.seeking && audio.currentTime >= loop.end) {
      try {
        audio.currentTime = loop.start;
      } catch {
        this.clearLoop();
      }
    }
    this.state.time = this.pendingSeek ?? Math.max(0, finite(audio.currentTime));
    this.state.paused = audio.paused;
    this.publish();
  }

  async play(): Promise<void> {
    const audio = this.audio;
    if (!audio || this.disposed) return;
    const generation = ++this.playGeneration;
    this.playbackRequested = true;
    const current = () =>
      audio === this.audio && !this.disposed && generation === this.playGeneration;
    try {
      await audio.play();
      if (current()) {
        this.state.error = undefined;
        this.update();
      }
    } catch (error) {
      if (current()) {
        this.playbackRequested = false;
        // A pause/load interruption is not a decode or autoplay-policy failure.
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          this.state.error =
            'Playback was not allowed or the audio could not be decoded. Use the audio Play button to try again.';
        }
        this.update();
      }
    }
  }

  pause(): void {
    if (this.disposed) return;
    this.playGeneration += 1;
    this.playbackRequested = false;
    this.cancelLoopFrame();
    this.audio?.pause();
    this.update();
  }

  seek(time: number): void {
    if (!this.audio || this.disposed || !Number.isFinite(time)) return;
    const requested = Math.max(0, time);
    if (!this.state.ready) {
      this.pendingSeek = requested;
      this.state.time = requested;
      this.publish();
      return;
    }
    const target = Math.min(this.state.duration, requested);
    const loop = this.state.loop;
    if (loop && (target < loop.start || target >= loop.end)) this.clearLoop();
    try {
      this.audio.currentTime = target;
      this.update();
    } catch {
      this.state.error = 'Seeking is not available for this audio file yet.';
      this.publish();
    }
  }

  setRate(rate: number): void {
    if (this.disposed) return;
    const next = clampRate(rate);
    try {
      if (this.audio) {
        this.audio.defaultPlaybackRate = next;
        this.audio.playbackRate = next;
      }
      this.state.rate = next;
    } catch {
      this.state.error = 'This browser could not apply that playback speed.';
    }
    this.publish();
  }

  setLoop(start?: number, end?: number): void {
    if (this.disposed) return;
    this.clearLoop();
    if (
      this.audio &&
      this.state.ready &&
      start !== undefined &&
      end !== undefined &&
      Number.isFinite(start) &&
      Number.isFinite(end)
    ) {
      const first = Math.max(0, start);
      const last = Math.min(this.state.duration, end);
      if (last > first) {
        this.state.loop = { start: first, end: last };
        if (this.audio.currentTime < first || this.audio.currentTime >= last) this.seek(first);
        this.scheduleLoopFrame();
      }
    }
    this.publish();
  }

  private scheduleLoopFrame(): void {
    if (
      !this.state.loop ||
      !this.audio ||
      this.audio.paused ||
      this.frame !== undefined ||
      this.disposed
    )
      return;
    const generation = this.frameGeneration;
    this.frame = this.environment.requestFrame(() => {
      if (generation !== this.frameGeneration || this.disposed) return;
      this.frame = undefined;
      if (this.state.loop && !this.disposed) {
        this.update();
        this.scheduleLoopFrame();
      }
    });
  }
  private cancelLoopFrame(): void {
    this.frameGeneration += 1;
    if (this.frame !== undefined) this.environment.cancelFrame(this.frame);
    this.frame = undefined;
  }

  private release(): void {
    this.playGeneration += 1;
    this.metadataLoaded = false;
    this.playbackRequested = false;
    this.cancelLoopFrame();
    for (const remove of this.removeListeners) remove();
    this.removeListeners = [];
    const previous = this.audio;
    const url = this.url;
    this.audio = undefined;
    this.url = undefined;
    this.pendingSeek = undefined;
    // Each cleanup is independent: a media/host failure must not leak the URL.
    if (previous) {
      try {
        previous.pause();
      } catch {
        /* Best-effort native cleanup. */
      }
      try {
        previous.removeAttribute('src');
        previous.load();
      } catch {
        /* Detached media is retired. */
      }
    }
    try {
      this.environment.attach(undefined);
    } catch {
      /* The host may already be gone. */
    }
    try {
      if (url) this.environment.revokeURL(url);
    } catch {
      /* No media references remain. */
    }
  }

  clear(): void {
    if (this.disposed) return;
    this.release();
    this.state = { time: 0, duration: 0, ready: false, paused: true, rate: this.state.rate };
    this.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
  }
}
