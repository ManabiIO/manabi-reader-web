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
export function assertSupportedEpubRendition(
  value: unknown,
  spine: readonly { properties?: readonly string[] }[] = []
): void {
  const globalLayout =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).layout
      : undefined;
  const fixedPackage =
    typeof globalLayout === 'string' && globalLayout.trim().toLowerCase() === 'pre-paginated';
  const fixedOverride = spine.some((item) =>
    item.properties?.includes('rendition:layout-pre-paginated')
  );
  if (fixedPackage || fixedOverride)
    throw new Error('Fixed-layout EPUBs are not supported by this reader yet.');
}
