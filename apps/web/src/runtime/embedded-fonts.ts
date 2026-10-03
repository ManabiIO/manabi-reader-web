/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { buildLocalFontStyleSheet } from '../lib/functions/book-security/local-media.ts';
interface FontCache {
  match(path: string): Promise<Response | undefined>;
}
interface FontUrlOwner {
  create(blob: Blob): string;
  revoke(url: string): void;
}
const browserUrls: FontUrlOwner = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url)
};
/** The Android DOM owner has no service worker. Materialize only validated local
 * cache records, never widen its asset-origin policy or fetch a restored URL. */
export async function embeddedFontStyleSheet(
  fonts: unknown,
  cache: FontCache,
  signal: AbortSignal,
  urls: FontUrlOwner = browserUrls
) {
  const resources = new Map<string, string>();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const url of resources.values()) urls.revoke(url);
    resources.clear();
  };
  try {
    signal.throwIfAborted();
    if (Array.isArray(fonts))
      for (const font of fonts.slice(0, 256)) {
        if (!buildLocalFontStyleSheet([font]) || resources.has(font.path)) continue;
        const response = await cache.match(font.path);
        signal.throwIfAborted();
        if (!response) continue;
        const blob = await response.blob();
        signal.throwIfAborted();
        if (!blob.size || blob.size > 256 * 1024 * 1024) continue;
        const url = urls.create(blob);
        if (!url.startsWith('blob:'))
          throw new Error('Stored font did not receive a local object URL.');
        resources.set(font.path, url);
      }
    signal.throwIfAborted();
    return { css: buildLocalFontStyleSheet(fonts, resources), dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
