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

/** Repair invalid scalars without changing the surrounding HTML tokenization.
 * Leave valid references to the parser: decoding quotes/angles early creates
 * markup, decoding ampersands twice changes text, and C1 references have HTML
 * mappings that raw Unicode substitution does not reproduce.
 */
export function repairEpubNumericReferences(source: string): string {
  return source.replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (reference, hex, decimal) => {
    const decoded = epubNumericReference(hex ?? decimal, hex === undefined ? 10 : 16);
    return decoded === '\uFFFD' ? decoded : reference;
  });
}
