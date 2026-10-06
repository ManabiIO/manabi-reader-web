/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { NativeLibraryBook } from './contract';

/** Pure UI selection reconciliation; never import the DOM shelf owner into Hermes. */
export function reconcileNativeSelection(
  selected: readonly string[],
  items: readonly (NativeLibraryBook | { kind: 'series'; key: string })[]
): string[] {
  const available = new Set(items.filter((item) => item.kind === 'book').map((item) => item.key));
  return [...new Set(selected)].filter((key) => available.has(key));
}
