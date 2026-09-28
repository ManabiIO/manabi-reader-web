/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BookPresentation, Organization } from './organization';

const extensionKeys = ['metadata', 'series', 'coverBlur'] as const;
type Preferences = Record<string, unknown>;

/** Aliases may have been edited by older clients. Recency cannot erase unknown fields. */
export function latestBookPresentation(
  candidates: readonly (BookPresentation | undefined)[]
): BookPresentation | undefined {
  const ordered = candidates
    .filter((value): value is BookPresentation => !!value)
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (!ordered.length) return undefined;
  const result = structuredClone(ordered[0]);
  for (const field of extensionKeys) {
    const owner = ordered.find((value) => Object.hasOwn(value, field));
    if (owner) Object.assign(result, { [field]: structuredClone(owner[field]) });
  }
  return result;
}

/** Resolve every current locator for one logical book before editing or conflict checks. */
export function presentationFromAliases(
  books: Readonly<Record<string, BookPresentation | undefined>>,
  aliases: readonly string[]
): BookPresentation | undefined {
  return latestBookPresentation([...new Set(aliases)].map((alias) => books[alias]));
}

/** An older client cannot express an extension reset. Empty metadata/null/false can. */
export function retainMissingBookExtensions(
  previous: Organization['books'],
  incoming: Organization['books']
): Organization['books'] {
  const books = structuredClone(incoming);
  for (const [key, before] of Object.entries(previous)) {
    const missing = extensionKeys.filter(
      (field) => Object.hasOwn(before, field) && !Object.hasOwn(books[key] ?? {}, field)
    );
    if (!missing.length) continue;
    const after: BookPresentation = books[key] ?? { modifiedAt: before.modifiedAt };
    books[key] = {
      ...Object.fromEntries(missing.map((field) => [field, structuredClone(before[field])])),
      ...after,
      modifiedAt: Math.max(before.modifiedAt, after.modifiedAt)
    };
  }
  return books;
}

function organization(value: unknown): Organization | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const candidate = value as Organization;
  if (
    candidate.version === 1 &&
    Array.isArray(candidate.collections) &&
    candidate.books &&
    typeof candidate.books === 'object' &&
    !Array.isArray(candidate.books)
  )
    return candidate;
  return undefined;
}

/** Keep ordinary settings sync working against a pre-extension server. Never claim new fields were sent. */
export function preferenceWireSnapshot(
  value: Preferences,
  supportsExtensions: boolean
): Preferences {
  const next = structuredClone(value);
  const library = organization(next.library_organization);
  if (supportsExtensions || !library) return next;
  const books: Organization['books'] = {};
  for (const [key, before] of Object.entries(library.books)) {
    const after = { ...before };
    const extended = extensionKeys.some((field) => Object.hasOwn(after, field));
    for (const field of extensionKeys) delete after[field];
    // A cover-blur-only edit must not manufacture an empty remote presentation.
    if (extended && Object.keys(after).every((field) => field === 'modifiedAt')) continue;
    books[key] = after;
  }
  next.library_organization = { ...library, books };
  return next;
}

export function retainMissingPreferenceExtensions(
  previous: Preferences,
  incoming: Preferences
): Preferences {
  const before = organization(previous.library_organization);
  if (!before) return structuredClone(incoming);
  const after = organization(incoming.library_organization) ?? {
    version: 1,
    collections: [],
    books: {}
  };
  const books = retainMissingBookExtensions(before.books, after.books);
  return {
    ...structuredClone(incoming),
    ...(Object.keys(books).length || incoming.library_organization
      ? { library_organization: { ...structuredClone(after), books } }
      : {})
  };
}

export function hasPresentationExtensions(value: Preferences): boolean {
  const library = organization(value.library_organization);
  return (
    !!library &&
    Object.values(library.books).some((book) =>
      extensionKeys.some((key) => Object.hasOwn(book, key))
    )
  );
}
