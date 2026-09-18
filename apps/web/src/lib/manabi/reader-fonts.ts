/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const automaticReaderFont = 'Manabi Automatic';

/** Resolve only the automatic option; existing explicit user choices are kept. */
export function resolveReaderFontFamily(chosen: string, vertical: boolean): string {
  if (chosen && chosen !== automaticReaderFont) return chosen;
  const kyokasho = vertical ? ['YuKyokasho', 'YuKyokasho Yoko'] : ['YuKyokasho Yoko', 'YuKyokasho'];
  return [...kyokasho, 'Yu Mincho', 'Hiragino Mincho ProN', 'Klee One']
    .map((name) => JSON.stringify(name))
    .concat('serif')
    .join(', ');
}
