/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { createLocalCoverUrl } from '../lib/functions/book-security/local-media';
import type { LibraryAuthority } from './contract';
import { validNativeLibraryCover, type NativeLibraryCover } from './cover-contract';

export const NATIVE_COVER_SOURCE_LIMIT = 8 * 1024 * 1024;
function supported(value: unknown) {
  if (value instanceof Blob)
    return (
      value.size <= NATIVE_COVER_SOURCE_LIMIT &&
      !!createLocalCoverUrl(value, () => 'blob:local-validation')
    );
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(NATIVE_COVER_SOURCE_LIMIT / 3) * 4 + 128 ||
    !createLocalCoverUrl(value)
  )
    return false;
  const data = value.slice(value.indexOf(',') + 1);
  const bytes =
    Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  return bytes > 0 && bytes <= NATIVE_COVER_SOURCE_LIMIT;
}
function check(authority: LibraryAuthority) {
  authority.signal.throwIfAborted();
  authority.assertCurrent();
}
/** Local bytes only, including legacy raster data URLs. Never fetch a restored URL. */
export async function localCoverFingerprint(value: unknown, authority: LibraryAuthority) {
  check(authority);
  if (!supported(value)) return '';
  const bytes =
    value instanceof Blob ? await value.arrayBuffer() : new TextEncoder().encode(String(value));
  check(authority);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  check(authority);
  const mime = value instanceof Blob ? (value.type || 'image/jpeg').toLowerCase() : 'data';
  return `${mime}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
/** Decode only through an inert image element and re-encode the first frame to bounded JPEG.
 * Original strings, SVG source, and object URLs never leave this DOM owner. */
export async function rasterizeLocalCover(
  value: unknown,
  blurred: boolean,
  authority: LibraryAuthority
): Promise<NativeLibraryCover | null> {
  check(authority);
  if (!supported(value)) return null;
  const url = createLocalCoverUrl(value);
  if (!url) return null;
  const image = document.createElement('img');
  image.referrerPolicy = 'no-referrer';
  image.decoding = 'async';
  let cancelDecode: (() => void) | undefined;
  const abort = () => cancelDecode?.();
  authority.signal.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      cancelDecode = () => reject(new Error('Library cover loading was cancelled.'));
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Library cover could not be decoded.'));
      timer = setTimeout(() => reject(new Error('Library cover decoding timed out.')), 6000);
      check(authority);
      image.src = url;
    });
    check(authority);
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width > 8192 || height > 8192 || width * height > 16 * 1024 * 1024)
      return null;
    for (const [maxWidth, maxHeight, quality] of [
      [240, 360, 0.78],
      [160, 240, 0.65],
      [80, 120, 0.55]
    ]) {
      check(authority);
      const scale = Math.min(1, maxWidth / width, maxHeight / height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.fillStyle = '#eeeae2';
      context.fillRect(0, 0, canvas.width, canvas.height);
      // Apply the saved privacy preference before any bytes cross the native bridge.
      if (blurred) {
        if (!('filter' in context)) return null;
        context.filter = 'blur(12px)';
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const result = {
        uri: canvas.toDataURL('image/jpeg', quality),
        width: canvas.width,
        height: canvas.height
      };
      canvas.width = canvas.height = 0;
      check(authority);
      if (validNativeLibraryCover(result)) return result;
    }
    return null;
  } catch {
    check(authority);
    return null;
  } finally {
    clearTimeout(timer);
    authority.signal.removeEventListener('abort', abort);
    image.onload = image.onerror = null;
    image.removeAttribute('src');
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}
