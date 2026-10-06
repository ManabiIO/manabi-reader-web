/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const LIBRARY_COVER_CONCURRENCY = 2;
export const LIBRARY_COVER_VISIBLE_LIMIT = 12;
export const LIBRARY_COVER_CACHE_LIMIT = 24;
export const LIBRARY_COVER_MAX_BYTES = 48 * 1024;
export interface NativeLibraryCover {
  /** Re-encoded local raster bytes only. Never an original URL, SVG, or file path. */
  uri: string;
  width: number;
  height: number;
}
export interface LibraryCoverRequest {
  token: string;
  key: string;
  request: string;
}
export interface LibraryCoverReply extends LibraryCoverRequest {
  image: NativeLibraryCover | null;
}
export function validNativeLibraryCover(value: unknown): value is NativeLibraryCover {
  if (!value || typeof value !== 'object') return false;
  const image = value as NativeLibraryCover;
  const data = typeof image.uri === 'string' ? image.uri.slice(23) : '';
  const bytes = (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  return (
    Object.keys(value).every((key) => ['uri', 'width', 'height'].includes(key)) &&
    typeof image.uri === 'string' &&
    image.uri.length <= Math.ceil(LIBRARY_COVER_MAX_BYTES / 3) * 4 + 32 &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.uri) &&
    data.length % 4 === 0 &&
    bytes <= LIBRARY_COVER_MAX_BYTES &&
    Number.isInteger(image.width) &&
    Number.isInteger(image.height) &&
    image.width > 0 &&
    image.width <= 240 &&
    image.height > 0 &&
    image.height <= 360
  );
}
