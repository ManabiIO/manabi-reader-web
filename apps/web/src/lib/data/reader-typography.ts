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
 * Resolve the device-effective primary font without changing the portable preference.
 * Explicit packaged, imported and custom family names remain user-owned.
 */
export function effectivePrimaryReaderFont(
  value: unknown,
  yuKyokashoAvailable: boolean | undefined
): string {
  const family = typeof value === 'string' ? value.trim() : '';
  if (!family || family === LEGACY_SYSTEM_JAPANESE || family === YU_KYOKASHO) {
    // Keep YuKyokasho as the portable preference. Availability is device-local,
    // so a Windows/Linux fallback must not become an account-setting change.
    return yuKyokashoAvailable === false ? JAPANESE_FALLBACK_FONT : YU_KYOKASHO;
  }
  return family;
}

/**
 * Probe the actual browser-visible local faces. local() is intentional: the selector
 * should expose YuKyokasho only when the web reader can really activate it.
 */
let yuKyokashoAvailability: Promise<boolean> | undefined;

async function localFontFaceAvailable(source: string, timeoutMs = 1000): Promise<boolean> {
  if (typeof FontFace === 'undefined') return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const face = new FontFace('__manabi_yukyokasho_probe__', source);
    return await Promise.race([
      face.load().then(
        () => face.status === 'loaded',
        () => false
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      })
    ]);
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function detectYuKyokashoAvailability(): Promise<boolean> {
  yuKyokashoAvailability ??= Promise.all([
    localFontFaceAvailable('local("YuKyokasho Medium"), local("YuKyokasho")'),
    localFontFaceAvailable('local("YuKyokasho Yoko Medium"), local("YuKyokasho Yoko")')
  ]).then((available) => available.every(Boolean));
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
