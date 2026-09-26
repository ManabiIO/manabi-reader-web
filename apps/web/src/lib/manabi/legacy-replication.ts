/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export function legacyReplicationTypes<T>(
  types: readonly T[],
  hasPersonalReadingAuthority: boolean,
  personalTypes: readonly T[]
): T[] {
  if (!hasPersonalReadingAuthority) return [...types];
  const blocked = new Set(personalTypes);
  return types.filter((type) => !blocked.has(type));
}
