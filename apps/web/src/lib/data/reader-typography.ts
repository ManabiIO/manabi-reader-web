/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** New defaults only. Existing explicit fontFamilyGroupOne/Two values are retained. */
export const SYSTEM_JAPANESE = 'System Japanese';
export const SYSTEM_SANS = 'System Sans';

// Yoko is the horizontal-use face. Native Reader currently reverses these two
// preferences; keep this web choice explicit instead of copying that discrepancy.
const JAPANESE_FALLBACKS =
  'Klee, "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif CJK JP", "Klee One", serif';
export const SYSTEM_SANS_STACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif';

export function japaneseFontStack(vertical: boolean): string {
  return (
    (vertical ? 'YuKyokasho, "YuKyokasho Yoko", ' : '"YuKyokasho Yoko", YuKyokasho, ') +
    JAPANESE_FALLBACKS
  );
}

/** Preserve explicit family lists, including user-installed and imported fonts. */
export function resolveReaderFont(value: string, vertical: boolean, sans = false): string {
  const fallback = sans ? SYSTEM_SANS_STACK : japaneseFontStack(vertical);
  if (typeof value !== 'string' || value.length > 1024 || !value.trim()) return fallback;
  const family = value.trim();
  if (family === SYSTEM_JAPANESE) return japaneseFontStack(vertical);
  if (family === SYSTEM_SANS) return SYSTEM_SANS_STACK;
  return `${family}, ${fallback}`;
}
