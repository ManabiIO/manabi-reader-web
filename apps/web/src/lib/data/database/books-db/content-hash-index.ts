/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

interface ContentHashKeyCursor {
  key: IDBValidKey;
  primaryKey: IDBValidKey;
  continue(): Promise<ContentHashKeyCursor | null>;
}

export interface ContentHashIndex {
  openKeyCursor(): Promise<ContentHashKeyCursor | null>;
}

export function normalizedIndexedContentHash(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

/** Find exact-content primary keys without materializing stored book payloads.
 * The index may retain historical uppercase hashes, so compare normalized keys
 * instead of issuing one case-sensitive IDBKeyRange lookup.
 */
export async function contentHashPrimaryKeys(
  index: ContentHashIndex,
  contentHash: string,
  assertCurrent: () => void = () => undefined,
  signal?: AbortSignal
): Promise<number[]> {
  const wanted = normalizedIndexedContentHash(contentHash);
  if (!wanted) return [];
  const result: number[] = [];
  for (let cursor = await index.openKeyCursor(); cursor; cursor = await cursor.continue()) {
    assertCurrent();
    signal?.throwIfAborted();
    if (normalizedIndexedContentHash(cursor.key) !== wanted) continue;
    if (
      typeof cursor.primaryKey === 'number' &&
      Number.isSafeInteger(cursor.primaryKey) &&
      cursor.primaryKey > 0
    )
      result.push(cursor.primaryKey);
  }
  return result;
}
