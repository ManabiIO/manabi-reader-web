/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export enum LocalFont {
  YUKYOKASHO = 'YuKyokasho',
  SYSTEMSANS = 'System Sans',
  KZUDGOTHIC = 'KZ UDGothic',
  KZUDMINCHO = 'KZ UDMincho',
  GENEI = 'Genei Koburi Mincho v5',
  KLEEONE = 'Klee One',
  KLEEONESEMIBOLD = 'Klee One SemiBold',
  NOTOSANSJP = 'Noto Sans JP',
  NOTOSERIFJP = 'Noto Serif JP',
  SHIPPORIMINCHO = 'Shippori Mincho',
  SERIF = 'Serif',
  SANSSERIF = 'Sans-Serif'
}

export interface UserFont {
  name: string;
  path: string;
  fileName: string;
}

export const userFontsCacheName = 'ttu-userfonts';

export const reservedFontNames = new Set([
  LocalFont.YUKYOKASHO,
  // Released builds used this synthetic name; keep it reserved while startup migrates it.
  'System Japanese',
  LocalFont.SYSTEMSANS,
  'KZ UDGothic',
  'KZ UDMincho',
  'Genei Koburi Mincho v5',
  'Klee One',
  'Klee One SemiBold',
  'Noto Sans JP',
  'Noto Serif JP',
  'Shippori Mincho',
  'Serif',
  'Sans-Serif'
]);

export function isStoredFont(fontName: string, userFonts: UserFont[]) {
  return (
    reservedFontNames.has(fontName) || !!userFonts.find((userFont) => userFont.name === fontName)
  );
}
