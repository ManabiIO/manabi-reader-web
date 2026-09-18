/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

const MAX_COVER_BYTES = 64 * 1024 * 1024;
const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/svg+xml'
]);

/** Covers bypass the book-body renderer. Never treat restored strings as URLs. */
export function createLocalCoverUrl(
  value: unknown,
  createObjectURL: (blob: Blob) => string = (blob) => URL.createObjectURL(blob)
): string {
  if (value instanceof Blob) {
    if (value.size === 0 || value.size > MAX_COVER_BYTES) return '';
    const mime = (value.type || 'image/jpeg').toLowerCase();
    if (!IMAGE_MIMES.has(mime)) return '';
    // SVG is displayed in an image element, not injected into document HTML.
    return createObjectURL(value.type ? value : new Blob([value], { type: mime }));
  }
  // Older libraries contain raster data URLs; retain those without accepting
  // remote, relative, file, javascript, SVG data or stale persisted blob URLs.
  if (typeof value !== 'string' || value.length > (MAX_COVER_BYTES * 4) / 3 + 128) return '';
  if (!/^data:image\/(?:png|jpeg|gif|webp|bmp|avif);base64,[a-z0-9+/]*={0,2}$/i.test(value))
    return '';
  return value;
}

function cssString(value: string): string {
  return (
    '"' +
    value.replace(
      // eslint-disable-next-line no-control-regex
      /["\\\x00-\x1f\x7f]/g,
      (character) => `\\${character.charCodeAt(0).toString(16)} `
    ) +
    '"'
  );
}

/** Local font metadata is untrusted even though the CSS element is app-owned. */
export function buildLocalFontStyleSheet(fonts: unknown): string {
  if (!Array.isArray(fonts)) return '';
  const formats: Record<string, string> = {
    woff: 'woff',
    woff2: 'woff2',
    ttf: 'truetype',
    otf: 'opentype'
  };
  const rules: string[] = [];
  for (const font of fonts.slice(0, 256)) {
    if (!font || typeof font !== 'object') continue;
    const { name, fileName, path } = font;
    if (
      typeof name !== 'string' ||
      !name ||
      name.length > 200 ||
      typeof fileName !== 'string' ||
      !fileName ||
      fileName.length > 255 ||
      // eslint-disable-next-line no-control-regex
      /[\\/\x00-\x1f\x7f]/.test(fileName)
    )
      continue;
    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    const format = Object.hasOwn(formats, extension) ? formats[extension] : undefined;
    let expectedPath: string;
    try {
      expectedPath = `/userfonts/${encodeURIComponent(fileName)}`;
    } catch {
      // Malformed UTF-16 in restored metadata must not prevent Reader startup.
      continue;
    }
    if (!format || path !== expectedPath) continue;
    rules.push(
      `@font-face{font-family:${cssString(name)};font-style:normal;font-weight:400;font-display:swap;src:url(${cssString(expectedPath)}) format(${cssString(format)})}`
    );
  }
  return rules.join('\n');
}
