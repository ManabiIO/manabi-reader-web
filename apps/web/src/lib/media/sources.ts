/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { LIMITS, type ContentKey } from './contracts.js';
import { Sha256 } from './hash.js';
import { validateCloudLocator, type CloudLocator } from './cloud-locator.js';
import { abortable } from './abort.js';
export interface ByteSource {
  name: string;
  size: number;
  version: string;
  file?: File;
  cloud?: CloudLocator;
  isCurrent?(): boolean;
  read(start: number, end: number, signal: AbortSignal): Promise<Uint8Array>;
  playback(): {
    url: string;
    release(): void;
  };
}
/**
 * Capture an operation's source authority before any asynchronous/cache work.
 * A cached result is not evidence that its original account is still current.
 * Keep revocation sticky and retain the admitted predicate, not a mutable field.
 */
export function sourceLifetime(source: ByteSource): () => void {
  const current = source.isCurrent?.bind(source);
  let failure: { error: unknown } | undefined;
  return () => {
    if (failure) throw failure.error;
    try {
      if (current && !current()) throw new Error('Media source is no longer current');
    } catch (error) {
      failure = { error };
      throw error;
    }
  };
}
export const supportedVideo = (name: string) => /\.(mp4|m4v|mov|webm|mkv|ogv)$/i.test(name);
export function assertRange(start: number, end: number, size: number) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > size ||
    end - start > LIMITS.rangeBytes
  )
    throw new Error('Invalid or oversized media range');
}
export function localSource(file: File): ByteSource {
  return {
    name: file.name,
    size: file.size,
    version: `${file.size}:${file.lastModified}`,
    file,
    async read(start, end, signal) {
      signal.throwIfAborted();
      assertRange(start, end, file.size);
      // Blob reads have no AbortSignal API. Detach the caller without claiming
      // to stop the underlying filesystem read; observe its eventual result.
      const result = new Uint8Array(
        await abortable(signal, () => file.slice(start, end).arrayBuffer())
      );
      signal.throwIfAborted();
      return result;
    },
    playback() {
      const url = URL.createObjectURL(file);
      return { url, release: () => URL.revokeObjectURL(url) };
    }
  };
}
export async function boundedResponse(
  response: Response,
  maximum: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error('Invalid response size limit');
  if (!response.body) throw new Error('Empty media response');
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {
      /* Main read reports cancellation. */
    });
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await abortable(signal, () => reader.read());
      signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new Error('Oversized media response');
      parts.push(value);
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  } catch (e) {
    // Underlying transports are allowed to make cancellation asynchronous.
    // Observe cleanup without letting a broken source hold the user's error path open.
    try {
      void Promise.resolve(reader.cancel()).catch(() => {});
    } catch {
      /* Preserve the read error. */
    }
    throw e;
  } finally {
    signal.removeEventListener('abort', cancel);
    try {
      reader.releaseLock();
    } catch {
      // Some stream implementations reject/throw while an earlier read is
      // still pending. Cleanup must never replace the authoritative read/abort error.
    }
  }
}
export interface CloudManifest {
  name: string;
  size: number;
  version: string;
  url: string;
}
export function cloudSource(
  manifest: CloudManifest,
  userId: string,
  current: () => boolean
): ByteSource {
  if (
    !manifest ||
    typeof manifest.url !== 'string' ||
    typeof manifest.name !== 'string' ||
    !manifest.name ||
    manifest.name.length > 1024 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted text.
    /[\x00-\x1f\x7f]/.test(manifest.name) ||
    !Number.isSafeInteger(manifest.size) ||
    manifest.size <= 0 ||
    typeof manifest.version !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.version)
  )
    throw new Error('Invalid cloud media metadata');
  const { name, size, version } = manifest; // Do not retain a mutable response object.
  const url = new URL(manifest.url, location.origin);
  const path = /^\/api\/reader-web\/connections\/([a-f0-9-]{36})\/media\/$/i.exec(url.pathname);
  if (
    url.origin !== location.origin ||
    !path ||
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams.keys()].sort().join(',') !== 'id,root,user,version' ||
    url.searchParams.get('user') !== userId ||
    url.searchParams.get('version') !== version
  )
    throw new Error('Invalid media endpoint');
  const cloud = validateCloudLocator({
    connectionId: path[1],
    root: url.searchParams.get('root'),
    id: url.searchParams.get('id')
  });
  let revoked: { error: unknown; thrown: boolean } | undefined;
  const stillCurrent = () => {
    if (revoked) {
      if (revoked.thrown) throw revoked.error;
      return false;
    }
    try {
      if (!current()) {
        revoked = { error: new Error('Account changed'), thrown: false };
        return false;
      }
      return true;
    } catch (error) {
      revoked = { error, thrown: true };
      throw error;
    }
  };
  const assertCurrent = () => {
    if (!stillCurrent()) throw revoked!.error;
  };
  return {
    name,
    size,
    version,
    cloud,
    isCurrent: stillCurrent,
    async read(start, end, signal) {
      signal.throwIfAborted();
      assertRange(start, end, size);
      assertCurrent();
      const response = await abortable(signal, () =>
        fetch(url, {
          signal,
          credentials: 'same-origin',
          redirect: 'error',
          cache: 'no-store',
          headers: { Range: `bytes=${start}-${end - 1}`, 'X-Manabi-User': userId }
        })
      );
      const discard = () => {
        try {
          void Promise.resolve(response.body?.cancel()).catch(() => {});
        } catch {
          /* Reject with the account/range error, not cleanup failure. */
        }
      };
      try {
        assertCurrent();
      } catch (error) {
        discard();
        throw error;
      }
      if (
        response.status !== 206 ||
        response.headers.get('X-Manabi-User') !== userId ||
        response.headers.get('ETag') !== `"${version}"` ||
        response.headers.get('Content-Range') !== `bytes ${start}-${end - 1}/${size}`
      ) {
        discard();
        throw new Error('Cloud media changed or its range response was invalid');
      }
      const bytes = await boundedResponse(response, end - start, signal);
      if (bytes.length !== end - start) throw new Error('Incomplete cloud media range');
      assertCurrent();
      return bytes;
    },
    playback() {
      assertCurrent();
      return { url: url.href, release() {} };
    }
  };
}
/** Full-file verification is explicit for remote sources, never triggered by browsing a folder. */
export async function identify(
  source: ByteSource,
  signal: AbortSignal,
  progress: (n: number) => void = () => {}
): Promise<ContentKey> {
  if (!Number.isSafeInteger(source.size) || source.size <= 0) throw new Error('Invalid media size');
  signal.throwIfAborted();
  const current = sourceLifetime(source);
  current();
  const hash = new Sha256();
  const yieldBytes = 1024 * 1024;
  // Remote range requests are expensive. Read the permitted 4 MiB at once,
  // but keep hashing/progress and main-thread yielding at 1 MiB intervals.
  const requestBytes = source.cloud ? LIMITS.rangeBytes : yieldBytes;
  for (let start = 0; start < source.size; start += requestBytes) {
    signal.throwIfAborted();
    current();
    const end = Math.min(source.size, start + requestBytes);
    const bytes = await abortable(signal, () => source.read(start, end, signal));
    signal.throwIfAborted();
    current();
    if (bytes.length !== end - start) throw new Error('Incomplete media identity read');
    for (let offset = 0; offset < bytes.length; offset += yieldBytes) {
      signal.throwIfAborted();
      current();
      const boundary = Math.min(bytes.length, offset + yieldBytes);
      hash.update(bytes.subarray(offset, boundary));
      progress(start + boundary);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  signal.throwIfAborted();
  current();
  return `content:${hash.hex()}`;
}
export function streamedRange(
  source: ByteSource,
  start: number,
  end: number,
  signal: AbortSignal
): ReadableStream<Uint8Array> {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > source.size
  )
    throw new Error('Invalid stream range');
  const current = sourceLifetime(source);
  const abort = new AbortController();
  const parentAborted = () => abort.abort(signal.reason);
  signal.addEventListener('abort', parentAborted, { once: true });
  if (signal.aborted) parentAborted();
  let at = start,
    cancelled = false;
  const clean = () => signal.removeEventListener('abort', parentAborted);
  return new ReadableStream({
    async pull(controller) {
      try {
        abort.signal.throwIfAborted();
        current();
        if (at >= end) {
          clean();
          controller.close();
          return;
        }
        const next = Math.min(end, at + 1024 * 1024);
        const bytes = await abortable(abort.signal, () => source.read(at, next, abort.signal));
        if (cancelled) return;
        abort.signal.throwIfAborted();
        current();
        if (bytes.length !== next - at) throw new Error('Incomplete media stream');
        controller.enqueue(bytes);
        at = next;
      } catch (e) {
        clean();
        if (!cancelled) controller.error(e);
      }
    },
    cancel(reason) {
      cancelled = true;
      clean();
      abort.abort(reason);
    }
  });
}
