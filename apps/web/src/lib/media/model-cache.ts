/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Sha256, hashBlob } from './hash.js';
import { abortable } from './abort.js';
export const MOSS = Object.freeze({
  repository: 'mudler/moss-transcribe.cpp-gguf',
  revision: '54e4bbd17da3f84adf1c1bcf7791b9b9266f741e',
  filename: 'moss-transcribe-q5_0.gguf',
  bytes: 648174592,
  sha256: '7e9ce1de5648ed49fc5c4f5e003d61a7421a63c14074f7275dc8a8cc664ff865',
  engineRevision: '190a569c13b4b247450f2fb3b2a431244e84833e+manabi-web-v3',
  ggmlRevision: 'eced84c86f8b012c752c016f7fe789adea168e1e',
  quantization: 'q5_0',
  model: 'MOSS-Transcribe-Diarize-0.9B'
});
export interface ModelProgress {
  stage: 'checking' | 'downloading' | 'verifying' | 'loading';
  loaded: number;
  total: number;
}
export interface DownloadTarget {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
/** Abort requests must not hide the original error or hold Cancel open forever.
 * createWritable stages writes until close; abort is cleanup, not publication.
 */
function abortTarget(target: Pick<DownloadTarget, 'abort'>) {
  try {
    void Promise.resolve(target.abort()).catch(() => {});
  } catch {
    /* The write/verification error remains authoritative. */
  }
}
export async function downloadVerified(
  response: Response,
  target: DownloadTarget,
  expected: {
    bytes: number;
    sha256: string;
  },
  signal: AbortSignal,
  progress: (p: ModelProgress) => void = () => {}
) {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const hash = new Sha256();
  let loaded = 0;
  const magic: number[] = [];
  // Teardown can reject or never settle. Observe it without delaying the
  // original failure, and never take ownership of an already locked body.
  const cancelBody = () => {
    try {
      const cancellation = reader
        ? reader.cancel(signal.reason)
        : !response.body?.locked
          ? response.body?.cancel(signal.reason)
          : undefined;
      void Promise.resolve(cancellation).catch(() => {});
    } catch {
      /* Best effort; preserve the actual download error. */
    }
  };
  const abort = () => cancelBody();
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    if (!response.ok || !response.body)
      throw new Error(`Model download failed (${response.status})`);
    reader = response.body.getReader();
    const length = response.headers.get('Content-Length');
    if (length !== null && Number(length) !== expected.bytes)
      throw new Error('Unexpected model size');
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await abortable(signal, () => reader!.read());
      signal.throwIfAborted();
      if (done) break;
      loaded += value.length;
      if (loaded > expected.bytes) throw new Error('Model download exceeds expected size');
      for (let i = 0; i < value.length && magic.length < 4; i++) magic.push(value[i]);
      hash.update(value);
      await abortable(signal, () => target.write(value));
      signal.throwIfAborted();
      progress({ stage: 'downloading', loaded, total: expected.bytes });
    }
    if (
      loaded !== expected.bytes ||
      String.fromCharCode(...magic) !== 'GGUF' ||
      hash.hex() !== expected.sha256
    )
      throw new Error('Model verification failed. No model was installed.');
    signal.throwIfAborted();
    // Cancellation can race the browser's final atomic close. Only verified
    // bytes ever reach close; a fully verified cache may remain after a late
    // Cancel, but this caller must never continue into model loading.
    await abortable(signal, () => target.close());
    signal.throwIfAborted();
  } catch (error) {
    cancelBody();
    abortTarget(target);
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    try {
      reader?.releaseLock();
    } catch {
      /* Cleanup must not hide the failure. */
    }
  }
}
export async function getModel(
  signal: AbortSignal,
  progress: (p: ModelProgress) => void
): Promise<File> {
  if (!navigator.storage?.getDirectory)
    throw new Error(
      'This browser cannot cache the transcription model. Video playback remains available.'
    );
  const work = async () => {
    signal.throwIfAborted();
    progress({ stage: 'checking', loaded: 0, total: MOSS.bytes });
    const root = await abortable(signal, () => navigator.storage.getDirectory());
    const dir = await abortable(signal, () =>
      root.getDirectoryHandle('manabi-models', { create: true })
    );
    const name = `${MOSS.sha256}.gguf`;
    let cached: File | undefined;
    try {
      const handle = await abortable(signal, () => dir.getFileHandle(name));
      cached = await abortable(signal, () => handle.getFile());
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
    }
    if (
      cached?.size === MOSS.bytes &&
      (await abortable(signal, () =>
        hashBlob(cached!, signal, (loaded) =>
          progress({ stage: 'verifying', loaded, total: MOSS.bytes })
        )
      )) === MOSS.sha256
    )
      return cached;
    signal.throwIfAborted();
    const { quota, usage } = await abortable(signal, () => navigator.storage.estimate());
    const requiredBytes = MOSS.bytes + 32 * 1024 * 1024;
    if (quota !== undefined && usage !== undefined && quota - usage < requiredBytes)
      throw new Error(
        `The transcription model needs at least ${Math.ceil(requiredBytes / 1_000_000)} MB of free browser storage. Free some space, then retry.`
      );
    const handle = await abortable(signal, () => dir.getFileHandle(name, { create: true }));
    const writer = await abortable(signal, () =>
      handle.createWritable().then((opened) => {
        // The browser may finish opening a stream after cancellation. Retire it
        // rather than leaking the staging file or admitting a late download.
        if (signal.aborted) {
          abortTarget(opened);
          signal.throwIfAborted();
        }
        return opened;
      })
    );
    let downloadOwnsWriter = false;
    try {
      signal.throwIfAborted();
      const response = await fetch(
        `https://huggingface.co/${MOSS.repository}/resolve/${MOSS.revision}/${MOSS.filename}`,
        { signal, credentials: 'omit', referrerPolicy: 'no-referrer' }
      );
      downloadOwnsWriter = true;
      await downloadVerified(
        response,
        {
          write: (b) => writer.write(b as Uint8Array<ArrayBuffer>),
          close: () => writer.close(),
          abort: () => writer.abort()
        },
        MOSS,
        signal,
        progress
      );
      signal.throwIfAborted();
      return await abortable(signal, () => handle.getFile());
    } catch (e) {
      if (!downloadOwnsWriter) abortTarget(writer);
      throw e;
    }
  };
  return navigator.locks
    ? navigator.locks.request(`manabi-model/${MOSS.sha256}`, { signal }, work)
    : work();
}
export async function removeModel() {
  const work = async () => {
    try {
      const dir = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('manabi-models');
      await dir.removeEntry(`${MOSS.sha256}.gguf`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
    }
  };
  if (navigator.locks) await navigator.locks.request(`manabi-model/${MOSS.sha256}`, work);
  else await work();
}
