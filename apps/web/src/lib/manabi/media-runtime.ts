/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { ALL_FORMATS, Input, BlobSource, CustomSource, AudioBufferSink } from 'mediabunny';
import type { Bunny, TrackDisposition } from '../media/pipeline';
import { sourceLifetime, streamedRange } from '../media/sources';

/** Lazy-loaded by the video route; third-party constructors stay behind a typed adapter. */
export const mediaRuntime: Bunny = {
  create(source, signal) {
    signal.throwIfAborted();
    const current = sourceLifetime(source);
    current(); // Do not construct a cached reader for an already revoked source.
    let backgroundError: unknown;
    const check = () => {
      signal.throwIfAborted();
      try {
        current();
      } catch (error) {
        input.dispose();
        throw error;
      }
      if (backgroundError !== undefined) throw backgroundError;
    };
    const guarded = async <T>(operation: () => T | PromiseLike<T>): Promise<T> => {
      check();
      const result = await operation();
      check();
      return result;
    };
    const input = new Input({
      formats: ALL_FORMATS,
      source: source.file
        ? new BlobSource(source.file, { maxCacheSize: 4 * 1024 * 1024 })
        : new CustomSource({
            getSize: () => source.size,
            read: (start, end) => streamedRange(source, start, end, signal),
            maxCacheSize: 4 * 1024 * 1024,
            // Cloud providers are high-latency range sources; let Mediabunny combine
            // sequential reads instead of turning every parse step into a request.
            prefetchProfile: 'network',
            // Mediabunny otherwise reports prefetch failures as unhandled rejections.
            // Keep the first latent source failure and surface it through the next
            // foreground operation owned by this pipeline.
            handleUnhandledError: (error) => {
              if (backgroundError === undefined) backgroundError = error;
            }
          })
    });
    return {
      async getAudioTracks() {
        const tracks = await guarded(() => input.getAudioTracks());
        return tracks.map((track) => ({
          id: track.id,
          getName: () => guarded(() => track.getName()),
          getLanguageCode: () => guarded(() => track.getLanguageCode()),
          getDisposition: () => guarded(() => track.getDisposition()) as Promise<TrackDisposition>,
          canDecode: () => guarded(() => track.canDecode()),
          getNumberOfChannels: () => guarded(() => track.getNumberOfChannels()),
          buffers: (start: number, end: number) => {
            check();
            const iterable = new AudioBufferSink(track).buffers(start, end);
            return {
              async *[Symbol.asyncIterator]() {
                check();
                for await (const item of iterable) {
                  check();
                  yield item;
                }
                check();
              }
            };
          }
        }));
      },
      async getPrimaryVideoTrack() {
        const track = await guarded(() => input.getPrimaryVideoTrack());
        if (!track) return null;
        return {
          getDisplayWidth: () => guarded(() => track.getDisplayWidth()),
          getDisplayHeight: () => guarded(() => track.getDisplayHeight())
        };
      },
      computeDuration: () => guarded(() => input.computeDuration()),
      dispose: () => input.dispose()
    };
  }
};
