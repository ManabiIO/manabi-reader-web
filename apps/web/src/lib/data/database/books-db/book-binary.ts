/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** IndexedDB's Blob backing files are not durable on every WebKit implementation.
 * Store bytes in the record's structured clone so images commit atomically with
 * the book. Convert before opening a transaction: Blob reads are asynchronous.
 * Legacy Blob records remain readable and are converted on a content save.
 */
export interface StoredBinary {
  format: 'reader-bytes-v1';
  type: string;
  bytes: ArrayBuffer;
}

type Binary = Blob | StoredBinary;
type BinaryBook = { blobs: Record<string, Binary>; coverImage?: string | Binary };

function validateStoredBinary(value: unknown): asserts value is StoredBinary {
  if (
    !value ||
    typeof value !== 'object' ||
    !('format' in value) ||
    value.format !== 'reader-bytes-v1' ||
    !('type' in value) ||
    typeof value.type !== 'string' ||
    !('bytes' in value) ||
    !(value.bytes instanceof ArrayBuffer)
  )
    throw new Error('The saved book contains an unsupported image format.');
}

async function encodeBinary(value: Binary): Promise<StoredBinary> {
  if (!(value instanceof Blob)) {
    validateStoredBinary(value);
    // Own the mutable bytes and retain only the declared storage fields. A
    // restored record must not smuggle another native Blob into the database.
    return { format: 'reader-bytes-v1', type: value.type, bytes: value.bytes.slice(0) };
  }
  try {
    return { format: 'reader-bytes-v1', type: value.type, bytes: await value.arrayBuffer() };
  } catch (cause) {
    // This operation has no user AbortSignal. Native byte-read AbortError must
    // reach the save-failure UI, not replication's intentional-cancellation path.
    throw new Error(
      'The book’s image bytes could not be read. Re-import the original source to restore ' +
        'unavailable images. Your original book file has not been changed.',
      { cause }
    );
  }
}

export function decodeBookBinary(value: Binary): Blob {
  if (value instanceof Blob) return value;
  validateStoredBinary(value);
  return new Blob([value.bytes], { type: value.type });
}

export async function encodeBook<T extends BinaryBook>(
  book: T
): Promise<
  Omit<T, 'blobs' | 'coverImage'> & {
    blobs: Record<string, StoredBinary>;
    coverImage?: string | StoredBinary;
  }
> {
  // Capture top-level fields and resource membership before asynchronous reads.
  const snapshot = { ...book };
  const entries = Object.entries(snapshot.blobs);
  const binaries = new Map<Binary, Promise<StoredBinary>>();
  const encode = (value: Binary) => {
    let pending = binaries.get(value);
    if (!pending) {
      pending = encodeBinary(value);
      binaries.set(value, pending);
    }
    return pending;
  };
  const blobs: Record<string, StoredBinary> = {};
  // Read sequentially and share repeated resources, including an identical
  // cover. The completed book still occupies its total encoded byte size.
  for (const [name, value] of entries)
    Object.defineProperty(blobs, name, {
      value: await encode(value),
      enumerable: true,
      configurable: true,
      writable: true
    });
  const coverImage =
    typeof snapshot.coverImage === 'string' || snapshot.coverImage === undefined
      ? snapshot.coverImage
      : await encode(snapshot.coverImage);
  return { ...snapshot, blobs, coverImage };
}

export function decodeBook<T extends BinaryBook>(
  book: T
): Omit<T, 'blobs' | 'coverImage'> & { blobs: Record<string, Blob>; coverImage?: string | Blob } {
  return {
    ...book,
    blobs: Object.fromEntries(
      Object.entries(book.blobs).map(([name, value]) => [name, decodeBookBinary(value)])
    ),
    coverImage:
      typeof book.coverImage === 'string' || book.coverImage === undefined
        ? book.coverImage
        : decodeBookBinary(book.coverImage)
  };
}
