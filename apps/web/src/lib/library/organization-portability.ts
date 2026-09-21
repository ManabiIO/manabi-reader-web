/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Organization } from './organization';

/** A browser ID, provider locator or filename is not a cross-device book identity. */
export const isPortableBookKey = (key: string) => /^content:[a-f0-9]{64}$/.test(key);

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
export function applyPortableOrganization(
  local: Organization,
  remote: Organization
): Organization {
  const shared = portableOrganization(remote);
  const localCollections = new Map(
    local.collections.map((collection) => [collection.id, collection])
  );
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
