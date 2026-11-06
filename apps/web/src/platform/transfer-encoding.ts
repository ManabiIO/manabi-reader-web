/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Works in Hermes and browsers without assuming Node's Buffer or btoa globals. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i],
      b = bytes[i + 1],
      c = bytes[i + 2];
    parts.push(
      alphabet[a >> 2] +
        alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)] +
        (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)] : '=') +
        (i + 2 < bytes.length ? alphabet[c & 63] : '=')
    );
  }
  return parts.join('');
}

/** Strict bounded decoding without Buffer/atob, including Hermes. */
export function base64ToBytes(value: unknown, maximum: number): Uint8Array {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length % 4 ||
    value.length > Math.ceil(maximum / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new Error('The file transfer contains invalid bytes.');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const size = (value.length / 4) * 3 - padding;
  if (size > maximum) throw new Error('The file transfer chunk is too large.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (let i = 0; i < value.length; i += 4) {
    const a = alphabet.indexOf(value[i]),
      b = alphabet.indexOf(value[i + 1]);
    const c = value[i + 2] === '=' ? 0 : alphabet.indexOf(value[i + 2]);
    const d = value[i + 3] === '=' ? 0 : alphabet.indexOf(value[i + 3]);
    if (i + 4 === value.length && ((padding === 2 && b & 15) || (padding === 1 && c & 3)))
      throw new Error('The file transfer contains noncanonical bytes.');
    bytes[offset++] = (a << 2) | (b >> 4);
    if (offset < size) bytes[offset++] = ((b & 15) << 4) | (c >> 2);
    if (offset < size) bytes[offset++] = ((c & 3) << 6) | d;
  }
  return bytes;
}
