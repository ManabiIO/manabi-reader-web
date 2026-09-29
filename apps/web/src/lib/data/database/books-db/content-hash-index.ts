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

export interface IndexedBookMetadata {
  id: number;
  title: string;
  contentHash: string;
  libraryOwner?: string;
}

interface IndexedBookMetadataStore {
  index(name: 'title' | 'contentHash' | 'libraryOwner'): ContentHashIndex;
}

/** Reconstruct compact book metadata entirely from index keys. No data-store
 * values are cloned, so EPUB HTML/resources stay inside IndexedDB.
 */
export async function readIndexedBookMetadata(
  store: IndexedBookMetadataStore,
  assertCurrent: () => void = () => undefined,
  signal?: AbortSignal
): Promise<IndexedBookMetadata[]> {
  const titles = new Map<number, string>();
  const hashes = new Map<number, string>();
  const owners = new Map<number, string>();
  const invalidOwners = new Set<number>();

  const read = async (
    name: 'title' | 'contentHash' | 'libraryOwner',
    accept: (id: number, key: IDBValidKey) => void
  ) => {
    for (
      let cursor = await store.index(name).openKeyCursor();
      cursor;
      cursor = await cursor.continue()
    ) {
      assertCurrent();
      signal?.throwIfAborted();
      if (
        typeof cursor.primaryKey !== 'number' ||
        !Number.isSafeInteger(cursor.primaryKey) ||
        cursor.primaryKey <= 0
      )
        continue;
      accept(cursor.primaryKey, cursor.key);
    }
  };

  await Promise.all([
    read('title', (id, key) => {
      if (typeof key === 'string') titles.set(id, key);
    }),
    read('contentHash', (id, key) => {
      const hash = normalizedIndexedContentHash(key);
      if (hash) hashes.set(id, hash);
    }),
    read('libraryOwner', (id, key) => {
      if (typeof key === 'string') owners.set(id, key);
      else invalidOwners.add(id);
    })
  ]);

  return [...hashes].flatMap(([id, contentHash]) =>
    !titles.has(id) || invalidOwners.has(id)
      ? []
      : [
          {
            id,
            title: titles.get(id)!,
            contentHash,
            ...(owners.has(id) ? { libraryOwner: owners.get(id)! } : {})
          }
        ]
  );
}
