/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Shared with the inherited reader counter. A reading count is not a UTF-16 offset.
const counted =
  /^[0-9A-Z○◯々-〇〻ぁ-ゖゝ-ゞァ-ヺー０-９Ａ-Ｚｦ-ﾝ\p{Radical}\p{Unified_Ideograph}]$/iu;
export const isReadingCharacter = (character: string): boolean => counted.test(character);
export function countReadingCharacters(text: string): number {
  // Retain the inherited reader's native-regexp fast path for frequent tracker measurements.
  return Array.from(
    text.replace(
      /[^0-9A-Z○◯々-〇〻ぁ-ゖゝ-ゞァ-ヺー０-９Ａ-Ｚｦ-ﾝ\p{Radical}\p{Unified_Ideograph}]+/gimu,
      ''
    )
  ).length;
}
