/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export type EpubSpineLinear = 'yes' | 'no';

/** EPUB defaults missing/unknown linear values to ordinary sequential reading. */
export function normalizeEpubSpineLinear(value: unknown): EpubSpineLinear {
  return value === 'no' ? 'no' : 'yes';
}

/**
 * Reader Web currently owns only reflowable EPUB pagination. A pre-paginated
 * package needs intrinsic page geometry/spread handling; silently running it
 * through the reflow engine corrupts the publisher's layout.
 */
export function assertSupportedEpubRendition(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const layout = (value as Record<string, unknown>).layout;
  if (typeof layout === 'string' && layout.trim().toLowerCase() === 'pre-paginated')
    throw new Error('Fixed-layout EPUBs are not supported by this reader yet.');
}
