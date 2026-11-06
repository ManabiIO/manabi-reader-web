/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { sameScope, type BridgeMethod, type BridgeScope } from '../platform/bridge-contract';
import { assertNotAborted } from '../platform/abort-signal';
import { base64ToBytes } from '../platform/transfer-encoding';
import {
  EXPORT_CHUNK_BYTES,
  parseBookExportRequest,
  type NativeBookExportRequest,
  type NativeBookExportStatus
} from './export-contract';

interface ExportHandle {
  readBytes(length: number): Promise<Uint8Array>;
  writeBytes(bytes: Uint8Array): Promise<void>;
  close(): void;
}
interface ExportFile {
  size: number;
  openWrite(): ExportHandle;
  openRead(): ExportHandle;
  delete(): void;
}
export interface NativeExportDependencies {
  scope(): BridgeScope;
  pickDirectory(): Promise<{ createFile(name: string): ExportFile } | null>;
  command(method: BridgeMethod, payload: Record<string, unknown>): Promise<unknown>;
  wait(): Promise<void>;
}

/** The shell alone owns the destination URI. Verify saved bytes in bounded reads
 * before reporting success. Never overwrite or clean up a pre-existing file.
 * The returned filename is the requested label, not metadata decoded from a URI. */
export async function saveNativeBookExport(
  dependencies: NativeExportDependencies,
  input: NativeBookExportRequest,
  signal: AbortSignal,
  progress: (message: string) => void
): Promise<{ filename: string } | null> {
  const selection = parseBookExportRequest(input);
  const owner = { ...dependencies.scope() };
  const check = () => {
    assertNotAborted(signal);
    if (!owner.session || !sameScope(owner, dependencies.scope()))
      throw new Error('The reader or account changed. Select the books again.');
  };
  check();
  progress('Choose a folder for the ZIP.');
  const directory = await dependencies.pickDirectory();
  check();
  if (!directory) return null;
  let token: string | undefined;
  let file: ExportFile | undefined;
  let filename: string | undefined;
  let handle: ExportHandle | undefined;
  let saved = false;
  let result: { filename: string } | undefined;
  let failed = false;
  let failure: unknown;
  const cancel = async () => {
    if (token && sameScope(owner, dependencies.scope()))
      await dependencies.command('library.export.cancel', { token }).catch(() => {});
  };
  const abort = () => {
    void cancel();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    check();
    let status = (await dependencies.command('library.export.start', {
      ...selection
    })) as NativeBookExportStatus;
    if (!status || typeof status.token !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(status.token))
      throw new Error('The export did not return a valid transfer. Refresh before trying again.');
    token = status.token;
    check();
    while (status.phase === 'preparing') {
      progress(`Preparing ZIP… ${status.completed} of ${status.total} books`);
      await dependencies.wait();
      check();
      status = (await dependencies.command('library.export.status', {
        token
      })) as NativeBookExportStatus;
      check();
      if (status?.token !== token) throw new Error('The export transfer changed.');
    }
    if (status.phase === 'error') throw new Error(status.error);
    if (
      status.phase !== 'ready' ||
      !Number.isSafeInteger(status.size) ||
      status.size < 1 ||
      typeof status.filename !== 'string' ||
      !/^ttu-reader-export-[0-9-]+\.zip$/.test(status.filename)
    )
      throw new Error('The completed ZIP metadata is invalid.');
    const size = status.size;
    filename = status.filename.replace(/\.zip$/, `-${token}.zip`);
    check();
    // SAF creates a new document. Use a unique name; never open an existing path
    // for truncation. SAF rename is not supported by the installed Expo API.
    file = directory.createFile(filename);
    check();
    const chunk = async (offset: number) => {
      check();
      const reply = (await dependencies.command('library.export.chunk', { token, offset })) as {
        token: string;
        offset: number;
        data: string;
      };
      check();
      if (reply?.token !== token || reply.offset !== offset)
        throw new Error('The ZIP transfer is out of order.');
      const bytes = base64ToBytes(reply.data, EXPORT_CHUNK_BYTES);
      if (bytes.length !== Math.min(EXPORT_CHUNK_BYTES, size - offset))
        throw new Error('The ZIP transfer is incomplete.');
      return bytes;
    };
    progress('Saving ZIP…');
    handle = file.openWrite();
    for (let offset = 0; offset < size; offset += EXPORT_CHUNK_BYTES) {
      const bytes = await chunk(offset);
      await handle.writeBytes(bytes);
      check();
    }
    handle.close();
    handle = undefined;
    check();
    if (file.size !== size) throw new Error('The saved ZIP has an unexpected size.');
    progress('Checking saved ZIP…');
    handle = file.openRead();
    for (let offset = 0; offset < size; offset += EXPORT_CHUNK_BYTES) {
      const expected = await chunk(offset);
      let read = 0;
      while (read < expected.length) {
        const actual = await handle.readBytes(expected.length - read);
        check();
        if (
          !actual.length ||
          actual.length > expected.length - read ||
          actual.some((byte, index) => byte !== expected[read + index])
        )
          throw new Error('The saved ZIP could not be verified.');
        read += actual.length;
      }
    }
    const extra = await handle.readBytes(1);
    check();
    if (extra.length || file.size !== size)
      throw new Error('The saved ZIP changed during verification.');
    handle.close();
    handle = undefined;
    check();
    saved = true;
    result = { filename };
  } catch (cause) {
    failed = true;
    failure = cause;
  } finally {
    signal.removeEventListener('abort', abort);
    try {
      handle?.close();
    } catch (cause) {
      failed = true;
      failure = cause;
    } finally {
      try {
        if (file && !saved) {
          try {
            file.delete();
          } catch {
            const error = new Error(
              `Export did not finish. An incomplete ZIP could not be removed from the chosen folder. Look for “${filename}” and delete it.`
            );
            error.name = 'ExportCleanupError';
            failed = true;
            failure = error;
          }
        }
      } finally {
        await cancel();
      }
    }
  }
  if (failed) throw failure;
  return result!;
}
