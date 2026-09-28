/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** A truncated TXT is still parseable. Never turn a short successful HTTP
 * response into a verified book when the listing supplied its complete size.
 * The request must also enforce this limit while consuming the response body.
 */
export function validateBookDownloadSize(expected: unknown, actual?: number): void {
  const maximum = 128 * 1024 * 1024;
  if (
    expected !== undefined &&
    (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0)
  )
    throw new Error('The selected book has an invalid file size. Refresh the folder.');
  if (typeof expected === 'number' && expected > maximum)
    throw new Error('This book exceeds the 128 MiB file limit.');
  if (actual === undefined) return;
  if (!Number.isSafeInteger(actual) || actual < 0 || actual > maximum)
    throw new Error('The book download exceeds the supported file size.');
  if (expected !== undefined && expected !== actual)
    throw new Error('The book download does not match the selected size. Refresh the folder.');
}

/** Check at the source boundary: metadata actions read books without importing
 * them. Equal size, title or URL cannot replace the hash of the selected copy.
 * Preserve the original File, and avoid a byte read when discovery has no hash.
 */
export async function verifySelectedBook<T extends Blob>(file: T, expected: unknown): Promise<T> {
  if (expected === undefined) return file;
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected))
    throw new Error('The selected book has an invalid content identity. Refresh the Library.');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  if (hash !== expected.toLowerCase())
    throw new Error('The source book changed. Refresh the Library before opening it again.');
  return file;
}
