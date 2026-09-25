/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { getModel, type ModelProgress } from './model-cache.js';
import {
  assertRuntimeIdentity,
  assertRuntimeBindings,
  type RuntimeIdentity
} from './moss-runtime-contract.js';
interface Module extends RuntimeIdentity {
  FS: {
    mkdir(p: string): void;
    mount(fs: unknown, args: unknown, p: string): void;
    unmount(p: string): void;
  };
  WORKERFS: unknown;
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  ccall(name: string, type: string, types: string[], args: unknown[]): number;
  UTF8ToString(p: number): string;
  _malloc(n: number): number;
  _free(p: number): void;
  _moss_web_cancel_ptr(): number;
  _moss_web_begin(n: number): void;
  _moss_transcribe_capi_transcribe_pcm(
    ctx: number,
    pcm: number,
    n: number,
    sr: number,
    max: number
  ): number;
  _moss_transcribe_capi_last_error(ctx: number): number;
  _moss_transcribe_capi_free_string(p: number): void;
  _moss_transcribe_capi_free(ctx: number): void;
  PThread?: {
    terminateAllThreads(): void;
  };
}
// DOM-compatible interface also allows this file to typecheck separately from the UI.
const worker = self as unknown as {
  location: Location;
  postMessage(value: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
};
let runtime: Module | undefined,
  ctx = 0,
  busy = false,
  download: AbortController | undefined,
  downloadId: string | undefined;
worker.onmessage = async ({ data }) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const { id, type, operation } = data;
  const reply = (type: string, value: unknown) => worker.postMessage({ id, type, value });
  if (type === 'cancel-download') {
    if (data.id === downloadId) download?.abort();
    return;
  }
  if (busy) {
    reply('error', 'The MOSS worker is busy');
    return;
  }
  busy = true;
  try {
    if (
      (type === 'prepare' || type === 'transcribe') &&
      (!Number.isSafeInteger(operation) || operation < 1 || operation > 0x7ffffffe)
    )
      throw new Error('Invalid MOSS operation identity');
    if (type === 'prepare') {
      if (runtime || ctx) throw new Error('MOSS runtime is already prepared');
      if (
        typeof data.threaded !== 'boolean' ||
        !Number.isSafeInteger(data.threads) ||
        data.threads < 1 ||
        data.threads > 4 ||
        (!data.threaded && data.threads !== 1)
      )
        throw new Error('Invalid CPU runtime mode');
      download = new AbortController();
      downloadId = id;
      const url = new URL(data.url, worker.location.href);
      if (url.origin !== worker.location.origin || !url.pathname.endsWith('/moss.mjs'))
        throw new Error('Invalid runtime path');
      const factory = (await import(/* @vite-ignore */ url.href)).default;
      download.signal.throwIfAborted();
      runtime = await factory({ locateFile: (name: string) => new URL(name, url).href });
      assertRuntimeIdentity(runtime!, data.threaded);
      assertRuntimeBindings(runtime!, data.threaded);
      runtime!._moss_web_begin(operation);
      // Send the cancellation word BEFORE downloading/loading weights. While
      // C++ is loading synchronously its Worker cannot receive cancel messages,
      // but the owner can still store into this word in the pthread build.
      reply(
        'runtime',
        data.threaded
          ? { buffer: runtime!.HEAP32.buffer, offset: runtime!._moss_web_cancel_ptr() }
          : null
      );
      download.signal.throwIfAborted();
      const file = await getModel(download.signal, (p: ModelProgress) => reply('progress', p));
      download.signal.throwIfAborted();
      reply('progress', { stage: 'loading', loaded: 0, total: 1 });
      runtime!.FS.mkdir('/models');
      runtime!.FS.mount(
        runtime!.WORKERFS,
        { blobs: [{ name: 'model.gguf', data: file }] },
        '/models'
      );
      try {
        ctx = runtime!.ccall(
          'moss_web_load',
          'number',
          ['string', 'number'],
          ['/models/model.gguf', data.threads]
        );
      } finally {
        runtime!.FS.unmount('/models');
      }
      if (!ctx) throw new Error('MOSS could not load. This device may not have enough memory.');
      const shared =
        typeof SharedArrayBuffer !== 'undefined' &&
        runtime!.HEAP32.buffer instanceof SharedArrayBuffer;
      reply(
        'ready',
        shared ? { buffer: runtime!.HEAP32.buffer, offset: runtime!._moss_web_cancel_ptr() } : null
      );
    } else if (type === 'transcribe') {
      const pcm = data.pcm;
      if (
        !runtime ||
        !ctx ||
        !(pcm instanceof Float32Array) ||
        !pcm.length ||
        pcm.length > 16000 * 64 ||
        pcm.some((n) => !Number.isFinite(n))
      )
        throw new Error('Invalid audio window');
      runtime._moss_web_begin(operation);
      const p = runtime._malloc(pcm.byteLength);
      if (!p) throw new Error('Not enough memory');
      let result = 0;
      try {
        // Memory growth can replace Emscripten's typed-array views. Read the
        // current view only after malloc and fail closed if it is stale or malformed.
        const heap = runtime.HEAPF32;
        const start = p / Float32Array.BYTES_PER_ELEMENT;
        if (
          !(heap instanceof Float32Array) ||
          p % Float32Array.BYTES_PER_ELEMENT ||
          !Number.isSafeInteger(start) ||
          start < 0 ||
          start + pcm.length > heap.length
        )
          throw new Error('MOSS runtime memory view is unavailable after allocation');
        heap.set(pcm, start);
        result = runtime._moss_transcribe_capi_transcribe_pcm(ctx, p, pcm.length, 16000, 2048);
        if (!result)
          throw new Error(
            runtime.UTF8ToString(runtime._moss_transcribe_capi_last_error(ctx)) || 'MOSS failed'
          );
        reply('result', runtime.UTF8ToString(result));
      } finally {
        runtime._free(p);
        if (result) runtime._moss_transcribe_capi_free_string(result);
      }
    } else if (type === 'dispose') {
      if (ctx) runtime?._moss_transcribe_capi_free(ctx);
      ctx = 0;
      runtime?.PThread?.terminateAllThreads();
      worker.close();
    } else throw new Error('Unknown MOSS operation');
  } catch (e) {
    reply('error', e instanceof Error ? e.message : String(e));
  } finally {
    busy = false;
    download = undefined;
    downloadId = undefined;
  }
};
