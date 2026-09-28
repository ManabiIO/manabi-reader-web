/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface DirectImportIdentity {
  id: number;
  title: string;
  contentHash?: string;
  libraryOwner?: string;
}

export interface DirectImportCandidate {
  title: string;
  contentHash?: string;
  libraryOwner?: string;
}

export function normalizedDirectImportHash(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

/** Exact bytes define a direct browser import independently of its filename/title.
 * Hashless legacy records retain title matching. Persistent account scope is part
 * of identity so a local import cannot adopt a connected account's cached copy.
 */
export function matchesDirectImportIdentity(
  existing: DirectImportIdentity,
  incoming: DirectImportCandidate
): boolean {
  if (existing.libraryOwner !== incoming.libraryOwner) return false;
  const hash = normalizedDirectImportHash(incoming.contentHash);
  if (hash) return normalizedDirectImportHash(existing.contentHash) === hash;
  return !incoming.contentHash && !existing.contentHash && existing.title === incoming.title;
}
