/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { writable } from 'svelte/store';
import { organizationIdentityReplacements, type BookIdentityRecord } from './book-identity.ts';
import { equal, integrationDB, type BookLink } from '$lib/manabi/persistence';
import { libraryName } from './series-metadata';
import {
  applyPortableOrganization,
  isPortablePresentation,
  isPortableText,
  portableOrganization
} from './organization-portability';
import type { BookMetadata, BookSeries } from './book-presentation';
import { latestBookPresentation } from './presentation-compatibility';
import type { PageDirection } from './direction';
import { changeWantToRead, WANT_TO_READ_ID, type CollectionBook } from './want-to-read';

export { bookKey, contentBookKey, sourceKey, sourceBookKey } from './organization-keys.ts';

export interface Collection {
  id: string;
  name: string;
  members: string[];
}
export interface BookPresentation {
  title?: string;
  direction?: PageDirection;
  cover?: string;
  metadata?: BookMetadata;
  series?: BookSeries | null;
  coverBlur?: boolean;
  modifiedAt: number;
}
export interface Organization {
  version: 1;
  collections: Collection[];
  books: Record<string, BookPresentation>;
}
const key = 'books-organization-v1';
export const emptyOrganization = (): Organization => ({ version: 1, collections: [], books: {} });
let currentOrganization = emptyOrganization();
let publicationRevision = 0;
export const organization = writable<Organization>(currentOrganization);

function normalizedOrganization(value: unknown): Organization | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const item = value as Partial<Organization>;
  if (
    item.version !== 1 ||
    !Array.isArray(item.collections) ||
    !item.books ||
    typeof item.books !== 'object' ||
    Array.isArray(item.books)
  )
    return;
  const collections = item.collections.filter(
    (collection): collection is Collection =>
      !!collection &&
      isPortableText(collection.id, 128) &&
      isPortableText(collection.name, 240) &&
      Array.isArray(collection.members) &&
      collection.members.every((member) => typeof member === 'string' && member.length <= 1000)
  );
  if (
    collections.length !== item.collections.length ||
    collections.length > 1000 ||
    new Set(collections.map((collection) => collection.id)).size !== collections.length
  )
    return;
  const entries = Object.entries(item.books);
  if (
    entries.length > 50000 ||
    entries.some(([id, book]) => id.length > 1000 || !isPortablePresentation(book))
  )
    return;
  return {
    version: 1,
    collections: collections.map((collection) => ({
      ...collection,
      members: [...new Set(collection.members)]
    })),
    books: Object.fromEntries(entries)
  };
}
function publish(value: Organization) {
  currentOrganization = value;
  publicationRevision++;
  organization.set(value);
}
function notifyOrganizationChange() {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(key);
    channel.postMessage('changed');
    channel.close();
  } catch {
    /* Other tabs refresh on their next visit. */
  }
}

/** Account sync transports content identity, never another browser's numeric IDs. */
export const organizationPreference = {
  getValue: () => portableOrganization(currentOrganization),
  next(value: unknown) {
    const normalized = normalizedOrganization(value);
    if (!normalized) return;
    return updateOrganization((stored) => {
      const applied = applyPortableOrganization(stored, normalized);
      stored.collections = applied.collections;
      stored.books = applied.books;
    });
  },
  subscribe(fn: () => void) {
    const unsubscribe = organization.subscribe(() => fn());
    return { unsubscribe };
  }
};

export async function reloadOrganization() {
  const db = await integrationDB();
  let saved: unknown;
  let revision: number;
  do {
    revision = publicationRevision;
    saved = await db.get('metadata', key);
    // A newer local publication can overtake an older asynchronous read.
  } while (revision !== publicationRevision);
  const value = normalizedOrganization(saved) ?? emptyOrganization();
  if (!equal(value, currentOrganization)) publish(value);
}
export async function updateOrganization(
  change: (value: Organization) => void,
  receipt?: { key: string; value: string; modified: number }
) {
  // IndexedDB serializes cross-tab read/modify/write transactions even without Web Locks.
  const db = await integrationDB(),
    tx = db.transaction('metadata', 'readwrite');
  try {
    const value = ((await tx.store.get(key)) as Organization | undefined) ?? emptyOrganization();
    if (receipt) {
      const previous = (await tx.store.get(receipt.key)) as typeof receipt | undefined;
      if (previous && (previous.value === receipt.value || previous.modified > receipt.modified)) {
        await tx.done;
        return;
      }
    }
    const before = structuredClone(value);
    change(value);
    if (!normalizedOrganization(value))
      throw new Error('The library organization is invalid or exceeds its size limit.');
    // Migration retry protection commits atomically with collection memberships.
    if (receipt) await tx.store.put(receipt, receipt.key);
    if (equal(before, value)) {
      await tx.done;
      return;
    }
    await tx.store.put(value, key);
    await tx.done;
    publish(value);
    notifyOrganizationChange();
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* transaction already settled */
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
export function watchOrganization(onError: (error: unknown) => void = () => undefined) {
  void reloadOrganization().catch(onError);
  const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(key);
  if (channel)
    channel.onmessage = () => {
      void reloadOrganization().catch(onError);
    };
  return () => channel?.close();
}
export async function createCollection(
  name: string,
  members: string[] = [],
  current: () => boolean = () => true
) {
  const collection = {
    id: crypto.randomUUID(),
    name: libraryName(name),
    members: [...new Set(members)]
  };
  await updateOrganization((value) => {
    if (!current()) throw new Error('The library changed. Reopen this action.');
    if (value.collections.length >= 1000) throw new Error('The collection limit has been reached.');
    value.collections.push(collection);
  });
  return collection.id;
}
export async function renameCollection(id: string, name: string) {
  if (id === WANT_TO_READ_ID) throw new Error('Want to Read is a built-in collection.');
  const title = libraryName(name);
  await updateOrganization((value) => {
    const collection = value.collections.find((c) => c.id === id);
    if (!collection) throw new Error('This collection no longer exists.');
    collection.name = title;
  });
}
export async function removeCollection(id: string) {
  if (id === WANT_TO_READ_ID) throw new Error('Want to Read is a built-in collection.');
  await updateOrganization((value) => {
    value.collections = value.collections.filter((c) => c.id !== id);
  });
}
export async function setWantToRead(books: CollectionBook[], included: boolean) {
  await updateOrganization((value) => changeWantToRead(value, books, included));
}
export async function setMembership(
  id: string,
  member: string,
  included: boolean,
  aliases: string[] = []
) {
  if (id === WANT_TO_READ_ID)
    return setWantToRead([{ organizationKey: member, organizationAliases: aliases }], included);
  await updateOrganization((value) => {
    const collection = value.collections.find((c) => c.id === id);
    if (!collection) throw new Error('This collection no longer exists.');
    const retained = collection.members.filter((key) => key !== member && !aliases.includes(key));
    collection.members = included ? [...retained, member] : retained;
  });
}
export type PresentationChange = Partial<Omit<BookPresentation, 'modifiedAt'>>;
export async function presentBook(id: string, change: PresentationChange) {
  return presentBooks([id], change);
}
/** Commit a batch once. Validation failure rolls back every selected book. */
export async function presentBooks(
  ids: string[],
  change: PresentationChange,
  current: () => boolean = () => true,
  expected?: Record<string, BookPresentation | undefined>,
  preserveSeriesIndex = false
) {
  const patch = structuredClone(change);
  const targets = [...new Set(ids)];
  const baseline = expected && structuredClone(expected);
  if (patch.title !== undefined) patch.title = libraryName(patch.title);
  await updateOrganization((value) => {
    if (!current()) throw new Error('The library changed. Reopen this action.');
    for (const id of targets) {
      if (baseline && !equal(value.books[id], baseline[id]))
        throw new Error('This book was edited elsewhere. Reopen its metadata before saving.');
      const presentation = { ...value.books[id], ...patch, modifiedAt: Date.now() };
      // A batch membership edit never erases a book's existing volume number in that series.
      // The metadata editor can still explicitly clear or change the number.
      const previousSeries = value.books[id]?.series;
      if (
        preserveSeriesIndex &&
        patch.series &&
        previousSeries?.name === patch.series.name &&
        patch.series.index === undefined &&
        previousSeries.index !== undefined
      ) {
        presentation.series = { ...patch.series, index: previousSeries.index };
      }
      // Explicit undefined resets a field; never serialize undefined to the wire.
      for (const field of Object.keys(presentation))
        if (presentation[field as keyof BookPresentation] === undefined)
          delete presentation[field as keyof BookPresentation];
      if (!isPortablePresentation(presentation))
        throw new Error('The book presentation override is invalid or too large.');
      value.books[id] = presentation;
    }
  });
}
export async function setMembershipMany(
  id: string,
  books: CollectionBook[],
  included: boolean,
  current: () => boolean = () => true
) {
  const targets = structuredClone(books);
  await updateOrganization((value) => {
    if (!current()) throw new Error('The library changed. Reopen this action.');
    if (id === WANT_TO_READ_ID) {
      changeWantToRead(value, targets, included);
      return;
    }
    const collection = value.collections.find((entry) => entry.id === id);
    if (!collection) throw new Error('This collection no longer exists.');
    const replaced = new Set(
      targets.flatMap((book) => [book.organizationKey, ...book.organizationAliases])
    );
    const retained = collection.members.filter((key) => !replaced.has(key));
    collection.members = [
      ...new Set(
        included ? [...retained, ...targets.map((book) => book.organizationKey)] : retained
      )
    ];
  });
}

/** Replace browser- and provider-specific locators with content identity once it is known. */
export async function stabilizeOrganization(
  links: BookLink[],
  records: readonly BookIdentityRecord[] = []
) {
  // Conflicting revision claims cannot choose a migration destination by order.
  const replacements = organizationIdentityReplacements(links, records);
  await updateOrganization((value) => {
    for (const collection of value.collections)
      collection.members = [
        ...new Set(collection.members.map((member) => replacements.get(member) || member))
      ];
    for (const [before, after] of replacements) {
      const prior = value.books[before],
        current = value.books[after];
      if (prior) value.books[after] = latestBookPresentation([current, prior])!;
      if (before !== after) delete value.books[before];
    }
  });
}
/** Import and file moves change locators, not the user's collections or display names. */
export async function relocatePresentation(before: string, after: string) {
  if (before === after) return;
  await updateOrganization((value) => {
    for (const collection of value.collections)
      collection.members = [
        ...new Set(collection.members.map((member) => (member === before ? after : member)))
      ];
    const prior = value.books[before],
      current = value.books[after];
    if (prior) value.books[after] = latestBookPresentation([current, prior])!;
    delete value.books[before];
  });
}
