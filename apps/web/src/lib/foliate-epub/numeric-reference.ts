/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Decode an import-repair numeric reference without truncating supplementary kanji. */
export function epubNumericReference(value: string, radix: 10 | 16): string {
  const codePoint = Number.parseInt(value, radix);
  if (
    !Number.isSafeInteger(codePoint) ||
    codePoint <= 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  )
    return '\uFFFD';
  return String.fromCodePoint(codePoint);
}
