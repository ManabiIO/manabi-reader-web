/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const EPUB_SOURCE_HREF_ATTRIBUTE = 'data-manabi-epub-href';

export function isSafeEpubInternalHref(value: string): boolean {
  const normalized = value.trim();
  // eslint-disable-next-line no-control-regex
  return (
    normalized.length > 0 &&
    normalized.length <= 4096 &&
    !/[\x00-\x20\x7f]/.test(normalized) &&
    (normalized.startsWith('#') || !/^(?:[a-z][\w+.-]*:|[\\/])/i.test(normalized))
  );
}

export function legacyFlattenedEpubHref(value: string): string {
  return `#${value.replace(/.+#/, '')}`;
}

export function decodeEpubNumericEntity(value: string, radix: 10 | 16): string {
  const codePoint = Number.parseInt(value, radix);
  if (
    !Number.isSafeInteger(codePoint) ||
    codePoint < 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  )
    return '\uFFFD';
  return String.fromCodePoint(codePoint);
}
