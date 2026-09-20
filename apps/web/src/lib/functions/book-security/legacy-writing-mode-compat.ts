/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

const LEGACY_TEXT_COMBINE_DECLARATION =
  /(^|[;{])(\s*)-(?:epub|webkit)-text-combine\s*:\s*(horizontal|none)\b/gi;

/**
 * Upgrade the legacy EPUB/WebKit tate-chu-yoko aliases before handing CSS to
 * the browser parser. Firefox drops these unknown declarations from CSSOM, so
 * normalizing after parsing is too late.
 */
export function normalizeLegacyTextCombine(css: string): string {
  return css.replace(
    LEGACY_TEXT_COMBINE_DECLARATION,
    (_match, boundary: string, whitespace: string, value: string) =>
      `${boundary}${whitespace}text-combine-upright: ${value.toLowerCase() === 'horizontal' ? 'all' : 'none'}`
  );
}
