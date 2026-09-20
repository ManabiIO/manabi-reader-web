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
  /** Finite metadata and any initial seek have been accepted. Safe to checkpoint. */
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

/** Owns a media element, its listeners, frame callback and local blob URL. */
export class LocalAudioPlayer {
  private audio?: HTMLAudioElement;
  private url?: string;
  private removeListeners: (() => void)[] = [];
  private frame?: number;
  private lastFrameTime = -Infinity;
  private disposed = false;
  private pendingSeek?: number;
  private metadataAvailable = false;
  private mediaFailed = false;
  private playIntent = 0;
  private state: PlaybackState = { time: 0, duration: 0, ready: false, paused: true, rate: 1 };

  constructor(
    private readonly environment: PlayerEnvironment,
    private readonly changed: (state: PlaybackState) => void
  ) {}

  get snapshot(): PlaybackState {
    // timeupdate is not guaranteed immediately before pause, close or pagehide.
    const time =
      this.pendingSeek ??
      (this.state.ready && this.audio
        ? finite(this.audio.currentTime, this.state.time)
        : this.state.time);
    return {
      ...this.state,
      time: Math.max(0, time),
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
      audio.playbackRate = rate;
      const listen = (type: string, callback: () => void) => {
        const guarded = () => {
          if (!this.disposed && this.audio === audio) callback();
        };
        audio.addEventListener(type, guarded);
        this.removeListeners.push(() => audio.removeEventListener(type, guarded));
      };
      listen('loadedmetadata', () => {
        this.metadataAvailable = true;
        this.updateDuration();
      });
      listen('durationchange', () => this.updateDuration());
      // Some engines expose metadata before a seek can be accepted. Retry without
      // discarding the requested checkpoint or publishing a fabricated zero.
      listen('loadeddata', () => this.updateDuration());
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
        this.state.error = undefined;
        this.update();
        this.scheduleFrame();
      });
      listen('pause', () => {
        this.playIntent += 1;
        this.cancelFrame();
        this.update();
      });
      listen('ratechange', () => {
        this.state.rate = clampRate(audio.playbackRate);
        if (audio.playbackRate !== this.state.rate) this.setRate(this.state.rate);
        else this.publish();
      });
      listen('ended', () => {
        if (this.state.loop) {
          this.seek(this.state.loop.start);
          void this.play();
        } else {
          this.cancelFrame();
          this.update();
        }
      });
      listen('error', () => {
        this.playIntent += 1;
        this.mediaFailed = true;
        this.state.ready = false;
        this.pendingSeek = undefined;
        this.clearLoop();
        audio.pause();
        this.state.error =
          'This audio file could not be played. Try a browser-supported codec or another local file.';
        this.state.paused = true;
        this.cancelFrame();
        this.publish();
      });
      this.url = this.environment.createURL(file);
      audio.src = this.url;
      this.environment.attach(audio);
      audio.load();
    } catch {
      this.release();
      this.state.ready = false;
      this.state.error = 'The local audio file could not be opened.';
    }
    this.publish();
  }

  private updateDuration(): void {
    const audio = this.audio;
    if (!audio || this.mediaFailed) return;
    const durationKnown = Number.isFinite(audio.duration) && audio.duration > 0;
    this.state.duration = durationKnown ? audio.duration : 0;
    this.state.ready = this.metadataAvailable && durationKnown;
    if (this.state.ready && this.pendingSeek !== undefined) {
      const target = Math.min(this.state.duration, this.pendingSeek);
      try {
        audio.currentTime = target;
        this.pendingSeek = undefined;
        this.state.time = target;
      } catch {
        this.state.ready = false;
      }
    }
    if (this.state.loop && (!this.state.ready || this.state.loop.end > this.state.duration))
      this.clearLoop();
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
    this.state.time = Math.max(0, this.pendingSeek ?? finite(audio.currentTime, this.state.time));
    this.state.paused = audio.paused || this.mediaFailed;
    this.publish();
  }

  async play(): Promise<void> {
    const audio = this.audio;
    if (!audio || this.disposed || this.mediaFailed) return;
    const intent = ++this.playIntent;
    try {
      await audio.play();
      if (audio === this.audio && intent === this.playIntent && !this.disposed) {
        this.state.error = undefined;
        this.update();
        this.scheduleFrame();
      }
    } catch {
      if (audio === this.audio && intent === this.playIntent && !this.disposed) {
        this.state.error =
          'Playback was not allowed or the audio could not be decoded. Use the audio Play button to try again.';
        this.update();
      }
    }
  }

  pause(): void {
    this.playIntent += 1;
    this.audio?.pause();
    this.cancelFrame();
    this.update();
  }

  seek(time: number): void {
    if (!this.audio || this.disposed || this.mediaFailed || !Number.isFinite(time)) return;
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
    const requested = clampRate(rate);
    try {
      if (this.audio) this.audio.playbackRate = requested;
      this.state.rate = requested;
    } catch {
      this.state.rate = this.audio ? clampRate(this.audio.playbackRate) : this.state.rate;
      this.state.error = 'This playback speed is not supported by the browser.';
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
      }
    }
    this.scheduleFrame();
    this.publish();
  }

  private clearLoop(): void {
    this.state.loop = undefined;
  }

  private scheduleFrame(): void {
    if (
      !this.audio ||
      this.audio.paused ||
      this.mediaFailed ||
      this.frame !== undefined ||
      this.disposed
    )
      return;
    this.frame = this.environment.requestFrame((time) => {
      this.frame = undefined;
      if (this.disposed) return;
      // Loops need frame accuracy; ordinary subtitle updates are bounded to 16 Hz.
      // timeupdate remains the fallback when a background tab suspends frames.
      if (this.state.loop || time - this.lastFrameTime >= 64) {
        this.lastFrameTime = time;
        this.update();
      }
      this.scheduleFrame();
    });
  }
  private cancelFrame(): void {
    if (this.frame !== undefined) this.environment.cancelFrame(this.frame);
    this.frame = undefined;
    this.lastFrameTime = -Infinity;
  }

  private release(): void {
    this.playIntent += 1;
    this.cancelFrame();
    for (const remove of this.removeListeners) remove();
    this.removeListeners = [];
    const previous = this.audio;
    const url = this.url;
    this.audio = undefined;
    this.url = undefined;
    this.pendingSeek = undefined;
    this.metadataAvailable = false;
    this.mediaFailed = false;
    // Cleanup must finish even if a host has already been removed.
    try {
      previous?.pause();
    } catch {
      /* Continue releasing owned resources. */
    }
    try {
      previous?.removeAttribute('src');
      previous?.load();
    } catch {
      /* Likewise. */
    }
    try {
      this.environment.attach(undefined);
    } catch {
      /* Host may already be gone. */
    }
    if (url) this.environment.revokeURL(url);
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
