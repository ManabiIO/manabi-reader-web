/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** New Group 1 preferences use the native textbook face when the browser can access it. */
export const YU_KYOKASHO = 'YuKyokasho';
export const YU_KYOKASHO_YOKO = 'YuKyokasho Yoko';
export const LEGACY_SYSTEM_JAPANESE = 'System Japanese';
export const JAPANESE_FALLBACK_FONT = 'Klee One';
export const SYSTEM_SANS = 'System Sans';

// Yoko is the horizontal-use face. Keep the opposite YuKyokasho face immediately
// after it so a platform exposing only one variant can still render with the family.
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

/**
 * Normalize only the automatic/native choice. Explicit packaged, imported and custom
 * family names remain user-owned even when CSS ultimately has to use a fallback.
 */
export function normalizePrimaryReaderFont(value: unknown, yuKyokashoAvailable: boolean): string {
  const family = typeof value === 'string' ? value.trim() : '';
  if (!family || family === LEGACY_SYSTEM_JAPANESE || family === YU_KYOKASHO) {
    return yuKyokashoAvailable ? YU_KYOKASHO : JAPANESE_FALLBACK_FONT;
  }
  return family;
}

/**
 * Probe the actual browser-visible local faces. local() is intentional: the selector
 * should expose YuKyokasho only when the web reader can really activate it.
 */
let yuKyokashoAvailability: Promise<boolean> | undefined;

async function localFontFaceAvailable(source: string): Promise<boolean> {
  if (typeof FontFace === 'undefined') return false;
  try {
    const face = new FontFace('__manabi_yukyokasho_probe__', source);
    await face.load();
    return face.status === 'loaded';
  } catch {
    return false;
  }
}

export function detectYuKyokashoAvailability(): Promise<boolean> {
  yuKyokashoAvailability ??= Promise.all([
    localFontFaceAvailable('local("YuKyokasho Medium"), local("YuKyokasho")'),
    localFontFaceAvailable('local("YuKyokasho Yoko Medium"), local("YuKyokasho Yoko")')
  ]).then((available) => available.some(Boolean));
  return yuKyokashoAvailability;
}

/** Preserve explicit family lists, including user-installed and imported fonts. */
export function resolveReaderFont(value: unknown, vertical: boolean, sans = false): string {
  const fallback = sans ? SYSTEM_SANS_STACK : japaneseFontStack(vertical);
  if (typeof value !== 'string' || value.length > 1024 || !value.trim()) return fallback;
  const family = value.trim();
  if (family === YU_KYOKASHO || family === LEGACY_SYSTEM_JAPANESE)
    return japaneseFontStack(vertical);
  if (family === SYSTEM_SANS) return SYSTEM_SANS_STACK;
  return `${family}, ${fallback}`;
}
