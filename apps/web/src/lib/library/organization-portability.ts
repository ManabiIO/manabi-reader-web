/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BookPresentation, Organization } from './organization';
import { WANT_TO_READ_ID, wantToReadCollection } from './want-to-read.ts';

/** A browser ID, provider locator or filename is not a cross-device book identity. */
export const isPortableBookKey = (key: string) => /^content:[a-f0-9]{64}$/.test(key);

export function isPortableText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff);
    })
  );
}

export function isPortablePresentation(value: unknown): value is BookPresentation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !['title', 'direction', 'cover', 'modifiedAt'].includes(key)))
    return false;
  if (
    !Number.isSafeInteger(item.modifiedAt) ||
    (item.modifiedAt as number) < 0 ||
    (item.title !== undefined && !isPortableText(item.title, 1000)) ||
    (item.direction !== undefined && !['ltr', 'rtl', 'unknown'].includes(item.direction as string))
  )
    return false;
  if (item.cover === undefined) return true;
  if (typeof item.cover !== 'string' || item.cover.length > 512 * 1024) return false;
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(item.cover);
  if (!match) return false;
  try {
    return atob(match[1]).length <= 384 * 1024;
  } catch {
    return false;
  }
}

/** Export only identities that another installation can independently verify. */
export function portableOrganization(value: Organization): Organization {
  return {
    version: 1,
    collections: value.collections.map(({ id, name, members }) => ({
      id,
      name,
      members: [...new Set(members.filter(isPortableBookKey))]
    })),
    books: Object.fromEntries(
      Object.entries(value.books)
        .filter(([key]) => isPortableBookKey(key))
        .map(([key, presentation]) => [key, structuredClone(presentation)])
    )
  };
}

/** Apply accepted shared state without adopting another browser's local locators. */
export function applyPortableOrganization(local: Organization, remote: Organization): Organization {
  const shared = portableOrganization(remote);
  const localCollections = new Map(
    local.collections.map((collection) => [collection.id, collection])
  );
  // Accounts last synced before Want to Read existed have no built-in record.
  // Its absence can clear shared membership, but cannot delete this device's
  // unsynced references: the built-in collection itself is never deleted.
  if (
    !shared.collections.some((collection) => collection.id === WANT_TO_READ_ID) &&
    localCollections.get(WANT_TO_READ_ID)?.members.some((member) => !isPortableBookKey(member))
  ) {
    shared.collections.push(wantToReadCollection(shared));
  }
  return {
    version: 1,
    // The accepted collection list remains authoritative, including deletions.
    // Within surviving collections, local-only membership remains on this device
    // until stabilizeOrganization can promote it to a verified content identity.
    collections: shared.collections.map((collection) => ({
      ...collection,
      members: [
        ...new Set([
          ...collection.members,
          ...(localCollections.get(collection.id)?.members ?? []).filter(
            (member) => !isPortableBookKey(member)
          )
        ])
      ]
    })),
    books: {
      ...Object.fromEntries(
        Object.entries(local.books)
          .filter(([key]) => !isPortableBookKey(key))
          .map(([key, presentation]) => [key, structuredClone(presentation)])
      ),
      ...shared.books
    }
  };
}
