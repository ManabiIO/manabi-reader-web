/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BackupArchive } from '../lib/data/storage/handler/backup-handler';
import type { LibraryAuthority } from './contract';
import { EXPORT_CHUNK_BYTES, EXPORT_IDLE_MS, type NativeBookExportStatus } from './export-contract';
import { bytesToBase64 } from '../platform/transfer-encoding';

interface Transfer {
  token: string;
  authority: LibraryAuthority;
  controller: AbortController;
  stop(): void;
  timer?: ReturnType<typeof setTimeout>;
  status: NativeBookExportStatus;
  archive?: BackupArchive;
  reading: boolean;
}

/** One scoped Blob; only bounded chunks cross the bridge, never runtime snapshots.
 * Status/chunk queries use the bridge's bounded read receipt cache. */
export class NativeBookExportService {
  private current?: Transfer;
  constructor(private token = () => crypto.randomUUID()) {}
  get active() {
    return !!this.current;
  }
  start(
    total: number,
    authority: LibraryAuthority,
    stop: () => void,
    prepare: (
      authority: LibraryAuthority,
      progress: (completed: number) => void
    ) => Promise<BackupArchive>
  ): NativeBookExportStatus {
    this.assert(authority);
    if (this.current) throw new Error('Finish or cancel the current export first.');
    const token = this.token();
    const controller = new AbortController();
    const owned: LibraryAuthority = {
      ...authority,
      signal: AbortSignal.any([authority.signal, controller.signal]),
      assertCurrent: () => {
        controller.signal.throwIfAborted();
        authority.assertCurrent();
      }
    };
    const retire = () => this.release(transfer);
    let stopped = false;
    const transfer: Transfer = {
      token,
      controller,
      authority: owned,
      reading: false,
      status: { token, phase: 'preparing', completed: 0, total },
      stop: () => {
        if (stopped) return;
        stopped = true;
        authority.signal.removeEventListener('abort', retire);
        stop();
      }
    };
    this.current = transfer;
    authority.signal.addEventListener('abort', retire, { once: true });
    this.touch(transfer);
    void Promise.resolve()
      .then(() => {
        this.assert(owned);
        return prepare(owned, (completed) => {
          this.assert(owned);
          transfer.status = { token, phase: 'preparing', completed, total };
        });
      })
      .then((archive) => {
        this.assert(owned);
        if (this.current !== transfer) return;
        if (!archive.blob.size) throw new Error('The export contains no data.');
        transfer.archive = archive;
        transfer.status = {
          token,
          phase: 'ready',
          completed: total,
          total,
          filename: archive.filename,
          size: archive.blob.size
        };
      })
      .catch((cause) => {
        if (this.current !== transfer) return;
        transfer.status = {
          token,
          phase: 'error',
          completed: transfer.status.completed,
          total,
          error: (cause instanceof Error
            ? cause.message
            : 'The selected books could not be exported.'
          ).slice(0, 2000)
        };
        transfer.archive = undefined;
      });
    return { ...transfer.status };
  }
  status(payload: unknown, authority: LibraryAuthority): NativeBookExportStatus {
    return { ...this.owned(payload, authority).status };
  }
  async chunk(payload: unknown, authority: LibraryAuthority) {
    const transfer = this.owned(payload, authority, true);
    const offset = (payload as { offset: number }).offset;
    const archive = transfer.archive;
    if (
      !archive ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= archive.blob.size ||
      offset % EXPORT_CHUNK_BYTES
    )
      throw new Error('The export chunk is unavailable or out of range.');
    if (transfer.reading) throw new Error('Another export chunk is still being read.');
    transfer.reading = true;
    try {
      const bytes = new Uint8Array(
        await archive.blob.slice(offset, offset + EXPORT_CHUNK_BYTES).arrayBuffer()
      );
      this.assert(authority);
      this.assert(transfer.authority);
      if (this.current !== transfer) throw new Error('This export expired.');
      return { token: transfer.token, offset, data: bytesToBase64(bytes) };
    } finally {
      transfer.reading = false;
    }
  }
  cancel(payload: unknown, authority: LibraryAuthority) {
    // Delayed cleanup can never cancel a newer transfer.
    this.assert(authority);
    const token = (payload as { token?: unknown } | null)?.token;
    if (typeof token !== 'string') throw new Error('Invalid export token.');
    if (this.current?.token === token && this.current.authority.key === authority.key)
      this.release(this.current);
    return null;
  }
  dispose() {
    if (this.current) this.release(this.current);
  }
  private assert(authority: LibraryAuthority) {
    authority.signal.throwIfAborted();
    authority.assertCurrent();
  }
  private owned(payload: unknown, authority: LibraryAuthority, chunk = false) {
    this.assert(authority);
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      Object.keys(payload).some((key) => !['token', ...(chunk ? ['offset'] : [])].includes(key))
    )
      throw new Error('Invalid export request.');
    const transfer = this.current;
    if (
      !transfer ||
      transfer.token !== (payload as { token?: unknown }).token ||
      transfer.authority.key !== authority.key
    )
      throw new Error('This export expired. Select the books again.');
    this.assert(transfer.authority);
    this.touch(transfer);
    return transfer;
  }
  private touch(transfer: Transfer) {
    clearTimeout(transfer.timer);
    transfer.timer = setTimeout(() => this.release(transfer), EXPORT_IDLE_MS);
  }
  private release(transfer: Transfer) {
    if (this.current === transfer) this.current = undefined;
    clearTimeout(transfer.timer);
    transfer.archive = undefined;
    transfer.controller.abort();
    transfer.stop();
  }
}
