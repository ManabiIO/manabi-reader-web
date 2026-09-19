/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BlobReader, Writer, ZipReader, type Entry } from '@zip.js/zip.js';

export interface ArchiveLimits {
  compressedBytes: number;
  entryBytes: number;
  textBytes: number;
  totalBytes: number;
  entryCount: number;
  concurrency: number;
  metadataReadBytes: number;
}

export const BOOK_ARCHIVE_LIMITS: Readonly<ArchiveLimits> = Object.freeze({
  compressedBytes: 256 * 1024 * 1024,
  entryBytes: 64 * 1024 * 1024,
  textBytes: 16 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  entryCount: 8192,
  concurrency: 2,
  metadataReadBytes: 16 * 1024 * 1024
});

/** One cumulative decoder budget can span an outer backup and its nested books. */
export class ArchiveBudget {
  private decoded = 0;
  constructor(readonly maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum <= 0)
      throw new Error('Invalid shared archive budget');
  }
  claim(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.decoded + bytes > this.maximum)
      throw new ArchiveLimitError('Decoded backup data exceeds the shared size limit');
    this.decoded += bytes;
  }
}

export const BACKUP_ARCHIVE_LIMITS: Readonly<ArchiveLimits> = Object.freeze({
  ...BOOK_ARCHIVE_LIMITS,
  compressedBytes: 1024 * 1024 * 1024,
  entryBytes: BOOK_ARCHIVE_LIMITS.compressedBytes,
  totalBytes: 1024 * 1024 * 1024,
  entryCount: 32768
});

export interface ArchiveOptions {
  signal?: AbortSignal;
  budget?: ArchiveBudget;
  /** Backup names are literal ZIP keys: upstream encodes title punctuation with %. */
  literalNames?: boolean;
  limits?: Readonly<ArchiveLimits>;
  useWebWorkers?: boolean;
}

export class ArchiveLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveLimitError';
  }
}

/** ZIP names are logical, relative paths; never filesystem destinations. */
export function validateArchivePath(name: string, directory = false, literalNames = false): string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 1024) {
    throw new Error('Invalid archive entry name');
  }
  // Reject ambiguous URL/path encodings as well as literal traversal.
  if (
    // eslint-disable-next-line no-control-regex
    /[\\\x00-\x1f\x7f]/.test(name) ||
    (!literalNames && /%(?:2e|2f|5c|00)/i.test(name)) ||
    name.startsWith('/') ||
    /^[a-z][\w+.-]*:/i.test(name)
  ) {
    throw new Error(`Unsafe archive path: ${name}`);
  }
  const result = directory && name.endsWith('/') ? name.slice(0, -1) : name;
  if (result.split('/').some((part) => part === '.' || part === '..' || part === '')) {
    throw new Error(`Unsafe archive path: ${name}`);
  }
  return result;
}

/** Resolve a manifest URI relative to its owning archive file, without escaping the archive. */
export function resolveArchivePath(owner: string, reference: string): string {
  if (
    typeof reference !== 'string' ||
    reference.length > 2048 ||
    /^(?:[a-z][\w+.-]*:|[\\/])/i.test(reference)
  ) {
    throw new Error('Archive resource must have a relative local URI');
  }
  const path = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  // eslint-disable-next-line no-control-regex
  if (path.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(path))
    throw new Error('Unsafe archive resource URI');
  const parts = owner.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) throw new Error('Archive resource escapes its root');
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return validateArchivePath(parts.join('/'));
}

class LimitedBlobReader extends BlobReader {
  constructor(
    private readonly input: Blob,
    private readonly maximumRead: number
  ) {
    super(input);
  }

  override async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(length) ||
      index < 0 ||
      length < 0 ||
      index + length > this.input.size
    ) {
      throw new Error('Invalid ZIP data range');
    }
    if (length > this.maximumRead) throw new ArchiveLimitError('Archive metadata is too large');
    return super.readUint8Array(index, length);
  }
}

/** Count actual decoder output before retaining it, including dishonest ZIP headers. */
class LimitedBlobWriter extends Writer<Blob> {
  private parts: ArrayBuffer[] = [];
  private written = 0;

  constructor(
    private readonly claim: (bytes: number, entryBytes: number) => void,
    private readonly mime: string
  ) {
    super();
  }

  override async writeUint8Array(bytes: Uint8Array): Promise<void> {
    const next = this.written + bytes.byteLength;
    this.claim(bytes.byteLength, next);
    this.written = next;
    this.size = next;
    // Some zip.js versions hand writers a subarray. Retain exactly that slice,
    // never the potentially larger backing buffer used by the decoder.
    this.parts.push(new Uint8Array(bytes).buffer);
  }

  override async getData(): Promise<Blob> {
    const blob = new Blob(this.parts, { type: this.mime });
    this.parts = [];
    return blob;
  }

  clear(): void {
    this.parts = [];
  }
}

/**
 * One bounded archive lifetime. All reads share a budget and concurrency limit.
 * close() aborts/drains readers before closing zip.js; no queued promise is left
 * pending by clearing a third-party limiter queue.
 */
export class LimitedArchive {
  readonly entries = new Map<string, Entry>();
  readonly limits: Readonly<ArchiveLimits>;
  private readonly controller = new AbortController();
  private readonly reader: ZipReader<Blob>;
  private readonly operations = new Set<Promise<unknown>>();
  private readonly waiters: Array<() => void> = [];
  private readonly forwardAbort: () => void;
  private active = 0;
  private decoded = 0;
  private closing: Promise<void> | undefined;

  private constructor(
    blob: Blob,
    private readonly options: ArchiveOptions
  ) {
    this.limits = Object.freeze({ ...(options.limits ?? BOOK_ARCHIVE_LIMITS) });
    for (const value of Object.values(this.limits)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid archive limit');
    }
    if (blob.size > this.limits.compressedBytes)
      throw new ArchiveLimitError('Compressed archive exceeds the size limit');
    this.reader = new ZipReader(new LimitedBlobReader(blob, this.limits.metadataReadBytes), {
      signal: this.controller.signal,
      checkSignature: true,
      useWebWorkers: options.useWebWorkers
    });
    this.forwardAbort = () => this.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', this.forwardAbort, { once: true });
    if (options.signal?.aborted) this.forwardAbort();
  }

  static async open(blob: Blob, options: ArchiveOptions = {}): Promise<LimitedArchive> {
    const archive = new LimitedArchive(blob, options);
    try {
      let declaredTotal = 0;
      let count = 0;
      for await (const entry of archive.reader.getEntriesGenerator()) {
        archive.controller.signal.throwIfAborted();
        if (++count > archive.limits.entryCount)
          throw new ArchiveLimitError('Archive has too many entries');
        const name = validateArchivePath(entry.filename, entry.directory, options.literalNames);
        if (archive.entries.has(name)) throw new Error(`Duplicate archive path: ${name}`);
        if (entry.encrypted) throw new Error('Encrypted archives are not supported');
        for (const size of [entry.compressedSize, entry.uncompressedSize]) {
          if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid ZIP entry size');
        }
        if (entry.uncompressedSize > archive.limits.entryBytes)
          throw new ArchiveLimitError(`Archive entry is too large: ${name}`);
        declaredTotal += entry.uncompressedSize;
        if (declaredTotal > archive.limits.totalBytes)
          throw new ArchiveLimitError('Archive decompressed size exceeds the limit');
        archive.entries.set(name, entry);
      }
      archive.controller.signal.throwIfAborted();
      return archive;
    } catch (error) {
      await archive.close();
      throw error;
    }
  }

  abort(reason: unknown = new DOMException('Archive operation cancelled', 'AbortError')): void {
    this.controller.abort(reason);
    this.waiters.splice(0).forEach((wake) => wake());
  }

  async readBlob(name: string, mime = '', maximum = this.limits.entryBytes): Promise<Blob> {
    this.controller.signal.throwIfAborted();
    if (!Number.isSafeInteger(maximum) || maximum <= 0)
      throw new Error('Invalid archive read limit');
    const entry = this.entries.get(name);
    if (!entry || entry.directory || !entry.getData)
      throw new Error(`Archive resource not found: ${name}`);
    if (entry.uncompressedSize > maximum)
      throw new ArchiveLimitError(`Archive resource is too large: ${name}`);
    const operation = this.readEntry(entry, mime, maximum);
    this.operations.add(operation);
    try {
      return await operation;
    } finally {
      this.operations.delete(operation);
    }
  }

  async readText(name: string, maximum = this.limits.textBytes): Promise<string> {
    const data = await this.readBlob(name, 'text/plain', Math.min(maximum, this.limits.textBytes));
    this.controller.signal.throwIfAborted();
    const text = await data.text();
    this.controller.signal.throwIfAborted();
    return text;
  }

  async map<T, R>(items: readonly T[], work: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    let failed = false;
    let failure: unknown;
    const workers = Array.from(
      { length: Math.min(this.limits.concurrency, items.length) },
      async () => {
        try {
          while (next < items.length) {
            this.controller.signal.throwIfAborted();
            const index = next++;
            results[index] = await work(items[index], index);
          }
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          }
          this.abort(error);
        }
      }
    );
    await Promise.all(workers);
    if (failed) throw failure;
    this.controller.signal.throwIfAborted();
    return results;
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.abort();
      this.closing = (async () => {
        await Promise.allSettled([...this.operations]);
        try {
          await this.reader.close();
        } finally {
          this.entries.clear();
          this.options.signal?.removeEventListener('abort', this.forwardAbort);
        }
      })();
    }
    return this.closing;
  }

  private async readEntry(entry: Entry, mime: string, maximum: number): Promise<Blob> {
    while (this.active >= this.limits.concurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
      this.controller.signal.throwIfAborted();
    }
    this.controller.signal.throwIfAborted();
    this.active++;
    const writer = new LimitedBlobWriter((bytes, entryBytes) => {
      this.controller.signal.throwIfAborted();
      if (entryBytes > maximum || entryBytes > this.limits.entryBytes)
        throw new ArchiveLimitError(`Decoded archive entry is too large: ${entry.filename}`);
      if (this.decoded + bytes > this.limits.totalBytes)
        throw new ArchiveLimitError('Decoded archive data exceeds the total limit');
      this.options.budget?.claim(bytes);
      this.decoded += bytes;
    }, mime);
    try {
      const value = await entry.getData!(writer, {
        signal: this.controller.signal,
        checkSignature: true,
        useWebWorkers: this.options.useWebWorkers
      });
      this.controller.signal.throwIfAborted();
      if (value.size !== entry.uncompressedSize)
        throw new Error(`ZIP size mismatch: ${entry.filename}`);
      return value;
    } catch (error) {
      this.abort(error);
      throw error;
    } finally {
      writer.clear();
      this.active--;
      this.waiters.shift()?.();
    }
  }
}
