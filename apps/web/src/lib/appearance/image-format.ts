/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const maxBackgroundBytes = 8 * 1024 * 1024;
export const maxBackgroundPixels = 24_000_000;
export const maxBackgroundDimension = 8192;
export const backgroundMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];
export function imageDimensions(bytes: Uint8Array, type: string): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, count: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + count));
  let width = 0,
    height = 0;
  if (
    type === 'image/png' &&
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n) &&
    ascii(12, 4) === 'IHDR'
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker
        ) &&
        length >= 8
      ) {
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (
    type === 'image/webp' &&
    bytes.length >= 30 &&
    ascii(0, 4) === 'RIFF' &&
    ascii(8, 4) === 'WEBP'
  ) {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') {
      // Animated wallpapers are intentionally not accepted: no hidden motion or decoder churn.
      if (bytes[20] & 2) throw new Error('Choose a still image rather than an animated WebP.');
      width = 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536;
      height = 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536;
    } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    }
  }
  if (!width || !height) throw new Error('This is not a readable PNG, JPEG, or WebP image.');
  if (
    width > maxBackgroundDimension ||
    height > maxBackgroundDimension ||
    width * height > maxBackgroundPixels
  )
    throw new Error(
      'Choose an image up to 24 megapixels, with neither side larger than 8192 pixels.'
    );
  return [width, height];
}
