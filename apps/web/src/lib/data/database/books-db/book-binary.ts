/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** IndexedDB's Blob backing files are not durable on every WebKit implementation.
 * Store bytes in the record's structured clone so images commit atomically with
 * the book. Convert before opening a transaction: Blob reads are asynchronous.
 * Legacy Blob records remain readable and are converted on their next save.
 */
export interface StoredBinary {
  format: 'reader-bytes-v1';
  type: string;
  bytes: ArrayBuffer;
}

type Binary = Blob | StoredBinary;
type BinaryBook = { blobs: Record<string, Binary>; coverImage?: string | Binary };

async function encodeBinary(value: Binary): Promise<StoredBinary> {
  if (!(value instanceof Blob)) return value;
  return { format: 'reader-bytes-v1', type: value.type, bytes: await value.arrayBuffer() };
}

export function decodeBookBinary(value: Binary): Blob {
  if (value instanceof Blob) return value;
  if (value.format !== 'reader-bytes-v1' || !(value.bytes instanceof ArrayBuffer))
    throw new Error('The saved book contains an unsupported image format.');
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
  const blobs: Record<string, StoredBinary> = {};
  // Sequential conversion bounds temporary memory for image-heavy books.
  for (const [name, value] of Object.entries(book.blobs))
    Object.defineProperty(blobs, name, {
      value: await encodeBinary(value),
      enumerable: true,
      configurable: true,
      writable: true
    });
  const coverImage =
    typeof book.coverImage === 'string' || !book.coverImage
      ? book.coverImage
      : await encodeBinary(book.coverImage);
  return { ...book, blobs, coverImage };
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
      typeof book.coverImage === 'string' || !book.coverImage
        ? book.coverImage
        : decodeBookBinary(book.coverImage)
  };
}
