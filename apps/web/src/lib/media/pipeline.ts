/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ByteSource } from './sources.js';

export interface TrackDisposition {
  default: boolean;
  primary: boolean;
  forced: boolean;
  original: boolean;
  commentary: boolean;
  hearingImpaired: boolean;
  visuallyImpaired: boolean;
}
export interface AudioTrack {
  id: number;
  getName(): Promise<string | null>;
  getLanguageCode(): Promise<string>;
  getDisposition(): Promise<TrackDisposition>;
  canDecode(): Promise<boolean>;
  getNumberOfChannels(): Promise<number>;
  buffers(
    start: number,
    end: number
  ): AsyncIterable<{ buffer: AudioBuffer; timestamp: number; duration: number }>;
}
export interface AudioTrackDescription extends TrackDisposition {
  id: number;
  name: string | null;
  language: string;
  decodable: boolean;
}

export interface MediaInput {
  getAudioTracks(): Promise<AudioTrack[]>;
  getPrimaryVideoTrack(): Promise<{
    getDisplayWidth(): Promise<number>;
    getDisplayHeight(): Promise<number>;
  } | null>;
  computeDuration(): Promise<number>;
  dispose(): void;
}
/** Explicit adapter boundary; never cast the entire third-party module to our interface. */
export interface Bunny {
  create(source: ByteSource, signal: AbortSignal): MediaInput;
}

export const MAX_DECODE_PACKETS = 32768;

export class MediaPipeline {
  private input: MediaInput;
  private controller = new AbortController();
  private parent?: AbortSignal;
  private stopParent = () => this.dispose();
  private closed = false;
  constructor(bunny: Bunny, source: ByteSource, signal?: AbortSignal) {
    signal?.throwIfAborted();
    this.input = bunny.create(source, this.controller.signal);
    this.parent = signal;
    signal?.addEventListener('abort', this.stopParent, { once: true });
    if (signal?.aborted) this.dispose();
  }
  private guard(signal?: AbortSignal) {
    this.controller.signal.throwIfAborted();
    signal?.throwIfAborted();
  }
  /** Disposing a decoder is not a promise that its pending callback will settle.
   * Detach callers promptly on abort while still observing any late rejection.
   */
  private wait<T>(task: () => T | PromiseLike<T>): Promise<T> {
    const signal = this.controller.signal;
    return new Promise<T>((resolve, reject) => {
      const finish = (result: () => void) => {
        signal.removeEventListener('abort', abort);
        result();
      };
      const abort = () =>
        finish(() =>
          reject(signal.reason ?? new DOMException('Audio decoding canceled', 'AbortError'))
        );
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
      try {
        Promise.resolve(task()).then(
          (value) => finish(() => resolve(value)),
          (error) => finish(() => reject(error))
        );
      } catch (e) {
        finish(() => reject(e));
      }
    });
  }
  async audioTracks() {
    this.guard();
    const tracks = await this.wait(() => this.input.getAudioTracks());
    this.guard();
    return tracks;
  }
  async describeAudioTracks(): Promise<AudioTrackDescription[]> {
    const tracks = await this.audioTracks();
    const descriptions: AudioTrackDescription[] = [];
    const booleanKeys = [
      'default',
      'primary',
      'forced',
      'original',
      'commentary',
      'hearingImpaired',
      'visuallyImpaired'
    ] as const;
    for (const track of tracks) {
      this.guard();
      if (!Number.isSafeInteger(track.id) || track.id < 0)
        throw new Error('Invalid audio track ID');
      const [name, language, decodable, disposition] = await this.wait(() =>
        Promise.all([
          track.getName(),
          track.getLanguageCode(),
          track.canDecode(),
          track.getDisposition()
        ])
      );
      this.guard();
      if (
        name !== null &&
        (typeof name !== 'string' ||
          name.length > 1024 ||
          // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted text.
          /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(name))
      )
        throw new Error('Invalid audio track name');
      if (
        typeof language !== 'string' ||
        language.length > 64 ||
        typeof decodable !== 'boolean' ||
        !disposition ||
        typeof disposition !== 'object' ||
        booleanKeys.some((key) => typeof disposition[key] !== 'boolean')
      )
        throw new Error('Invalid audio track metadata');
      descriptions.push({ id: track.id, name, language, decodable, ...disposition });
    }
    return descriptions;
  }
  async metadata() {
    this.guard();
    const [duration, video] = await this.wait(() =>
      Promise.all([this.input.computeDuration(), this.input.getPrimaryVideoTrack()])
    );
    this.guard();
    const width = video ? await this.wait(() => video.getDisplayWidth()) : 0,
      height = video ? await this.wait(() => video.getDisplayHeight()) : 0;
    this.guard();
    if (
      ![duration, width, height].every(Number.isFinite) ||
      duration <= 0 ||
      duration > 604800 ||
      width < 0 ||
      height < 0 ||
      width > 32768 ||
      height > 32768
    )
      throw new Error('Invalid video metadata');
    return { duration, width, height };
  }
  async decode(
    trackId: number,
    start: number,
    end: number,
    signal: AbortSignal
  ): Promise<Float32Array> {
    if (
      ![start, end].every(Number.isFinite) ||
      start < 0 ||
      end <= start ||
      end - start > 64 ||
      !Number.isSafeInteger(trackId)
    )
      throw new Error('Audio must be decoded in bounded windows');
    this.guard(signal);
    // Cancellation must cover metadata and decoder setup, not only the final iterator.
    const stop = () => this.dispose();
    signal.addEventListener('abort', stop, { once: true });
    const nodes: AudioBufferSourceNode[] = [];
    let iterator:
      | AsyncIterator<{ buffer: AudioBuffer; timestamp: number; duration: number }>
      | undefined;
    let exhausted = false;
    try {
      this.guard(signal);
      const track = (await this.wait(() => this.input.getAudioTracks())).find(
        (t) => t.id === trackId
      );
      this.guard(signal);
      if (!track || !(await this.wait(() => track.canDecode())))
        throw new Error('This browser cannot decode the selected audio track');
      this.guard(signal);
      const channels = await this.wait(() => track.getNumberOfChannels());
      this.guard(signal);
      if (!Number.isInteger(channels) || channels < 1 || channels > 8)
        throw new Error('Unsupported audio channel count');
      const context = new OfflineAudioContext(1, Math.ceil((end - start) * 16000), 16000);
      let decodedBytes = 0,
        packets = 0;
      iterator = track.buffers(start, end)[Symbol.asyncIterator]();
      for (;;) {
        const next = await this.wait(() => iterator!.next());
        this.guard(signal);
        if (next.done) {
          exhausted = true;
          break;
        }
        if (++packets > MAX_DECODE_PACKETS)
          throw new Error('Decoded audio exceeds the window packet budget');
        const { buffer, timestamp, duration: mediaDuration } = next.value;
        if (
          !Number.isFinite(timestamp) ||
          !Number.isFinite(mediaDuration) ||
          mediaDuration <= 0 ||
          !Number.isFinite(buffer.duration) ||
          buffer.duration <= 0 ||
          !Number.isSafeInteger(buffer.length) ||
          buffer.length < 1 ||
          !Number.isInteger(buffer.numberOfChannels) ||
          buffer.numberOfChannels < 1 ||
          buffer.numberOfChannels > 8
        )
          throw new Error('Invalid decoded audio packet');
        decodedBytes += buffer.length * buffer.numberOfChannels * 4;
        if (decodedBytes > 128 * 1024 * 1024)
          throw new Error('Decoded audio exceeds the window memory budget');
        const packetDuration = Math.min(mediaDuration, buffer.duration);
        const skip = Math.max(0, start - timestamp),
          when = Math.max(0, timestamp - start);
        const duration = Math.min(packetDuration - skip, end - Math.max(start, timestamp));
        if (duration <= 0) continue;
        // Web Audio resamples and downmixes; retain silent gaps and the media timestamps.
        const node = context.createBufferSource();
        node.buffer = buffer;
        node.connect(context.destination);
        node.start(when, skip, duration);
        nodes.push(node);
      }
      this.guard(signal);
      const rendered = await this.wait(() => context.startRendering());
      this.guard(signal);
      return rendered.getChannelData(0).slice();
    } finally {
      signal.removeEventListener('abort', stop);
      // An async generator can queue return() behind an unresolved next().
      // Observe cleanup failures without waiting forever or replacing the abort.
      if (iterator && !exhausted) {
        try {
          void Promise.resolve(iterator.return?.()).catch(() => {});
        } catch {
          /* Best-effort decoder cleanup. */
        }
      }
      for (const node of nodes) {
        try {
          node.stop();
        } catch {
          /* It may already have ended. */
        }
        try {
          node.disconnect();
        } catch {
          /* Cleanup must not hide the original error. */
        }
      }
    }
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.parent?.removeEventListener('abort', this.stopParent);
    this.controller.abort();
    try {
      this.input.dispose();
    } catch {
      /* Cancellation must still settle all waiting callers. */
    }
  }
}
