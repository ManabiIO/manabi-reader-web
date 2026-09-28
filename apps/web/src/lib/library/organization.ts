/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { writable } from 'svelte/store';
import { commitTransaction } from '$lib/data/database/books-db/commit-transaction.mjs';
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
  const memberships = collections.reduce((count, collection) => count + collection.members.length, 0);
  if (memberships > 50000) return;
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
  next(value: unknown, signal?: AbortSignal) {
    const normalized = normalizedOrganization(value);
    if (!normalized) return;
    return updateOrganization(
      (stored) => {
        const applied = applyPortableOrganization(stored, normalized);
        stored.collections = applied.collections;
        stored.books = applied.books;
      },
      undefined,
      signal
    );
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
  receipt?: { key: string; value: string; modified: number },
  authority?: AbortSignal | (() => void)
) {
  // Preference recovery carries an AbortSignal; snippet operations carry a
  // live owner guard. Keep both forms of authority at every write checkpoint.
  const signal = typeof authority === 'function' ? undefined : authority;
  const guard = typeof authority === 'function' ? authority : () => undefined;
  const assertCurrent = () => {
    guard();
    signal?.throwIfAborted();
  };
  assertCurrent();
  // Capture migration authority before suspension, not a caller-owned object.
  const admittedReceipt = receipt && { ...receipt };
  const db = await integrationDB();
  assertCurrent();
  // IndexedDB serializes cross-tab read/modify/write transactions even without Web Locks.
  const tx = db.transaction('metadata', 'readwrite');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      // An already committed/aborted transaction cannot be revoked retroactively.
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  let changed: Organization | undefined;
  try {
    // Observe tx.done before even the first read can fail. Request success is
    // not commit, and a failed request has a separate completion rejection.
    changed = await commitTransaction(tx, async () => {
      assertCurrent();
      const value = ((await tx.store.get(key)) as Organization | undefined) ?? emptyOrganization();
      if (admittedReceipt) {
        const previous = (await tx.store.get(admittedReceipt.key)) as
          | typeof admittedReceipt
          | undefined;
        if (
          previous &&
          (previous.value === admittedReceipt.value || previous.modified > admittedReceipt.modified)
        )
          return undefined;
      }
      assertCurrent();
      const before = structuredClone(value);
      change(value);
      assertCurrent();
      if (!normalizedOrganization(value))
        throw new Error('The library organization is invalid or exceeds its size limit.');
      // Migration retry protection commits atomically with collection memberships.
      if (admittedReceipt) await tx.store.put(admittedReceipt, admittedReceipt.key);
      assertCurrent();
      if (equal(before, value)) return undefined;
      await tx.store.put(value, key);
      assertCurrent();
      return value;
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    // A native abort with an empty message must not look like success in a
    // dialog. Actual scope cancellation retains its reason instead.
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
      throw new Error(
        'The library change could not be saved because local storage aborted the transaction. ' +
          'Try again. Your existing collections have been kept.',
        { cause: error }
      );
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
  // A commit is final. Only publication can be suppressed if its initiating
  // scope ended after commit; never describe that as a rolled-back write.
  if (changed) {
    try {
      assertCurrent();
    } catch {
      return;
    }
    publish(changed);
    notifyOrganizationChange();
  }
}
export function watchOrganization(onError: (error: unknown) => void = () => undefined) {
  void reloadOrganization().catch(onError);
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(key);
  } catch {
    // Cross-tab notifications are optional; denied messaging cannot prevent
    // this tab from loading or saving its local organization.
  }
  if (channel)
    channel.onmessage = () => {
      void reloadOrganization().catch(onError);
    };
  return () => channel?.close();
}
export async function createCollection(
  name: string,
  members: string[] = [],
  currentOrGuard: () => boolean | void = () => undefined
) {
  const collection = {
    id: crypto.randomUUID(),
    name: libraryName(name),
    members: [...new Set(members)]
  };
  await updateOrganization(
    (value) => {
      if (value.collections.length >= 1000)
        throw new Error('The collection limit has been reached.');
      value.collections.push(collection);
    },
    undefined,
    () => {
      if (currentOrGuard() === false) throw new Error('The library changed. Reopen this action.');
    }
  );
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
/** Change a batch in one organization transaction, including mixed book/snippet collections. */
export async function setMembershipMany(
  id: string,
  members: (CollectionBook | string)[],
  included: boolean,
  currentOrGuard: () => boolean | void = () => undefined
) {
  const targets = structuredClone(
    members.map((member) =>
      typeof member === 'string' ? { organizationKey: member, organizationAliases: [] } : member
    )
  );
  if (targets.length > 50000) throw new Error('Too many collection members.');
  await updateOrganization(
    (value) => {
      if (id === WANT_TO_READ_ID) {
        changeWantToRead(value, targets, included);
        return;
      }
      const collection = value.collections.find((item) => item.id === id);
      if (!collection) throw new Error('This collection no longer exists.');
      const replaced = new Set(
        targets.flatMap((member) => [member.organizationKey, ...member.organizationAliases])
      );
      const retained = collection.members.filter((key) => !replaced.has(key));
      collection.members = [
        ...new Set(
          included ? [...retained, ...targets.map((member) => member.organizationKey)] : retained
        )
      ];
    },
    undefined,
    () => {
      if (currentOrGuard() === false) throw new Error('The library changed. Reopen this action.');
    }
  );
}
function presentationTitle(value: string): string {
  const title = value.trim();
  if (!isPortableText(title, 1000)) throw new Error('Enter a title of 1–1000 characters.');
  return title;
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
  if (patch.title !== undefined) patch.title = presentationTitle(patch.title);
  await updateOrganization(
    (value) => {
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
    },
    undefined,
    () => {
      if (!current()) throw new Error('The library changed. Reopen this action.');
    }
  );
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

/** Restore only additive portable snippet membership; never clear unrelated books or rename a collection. */
export async function importSnippetCollections(
  collections: Collection[],
  guard: () => void = () => undefined
) {
  await updateOrganization(
    (value) => {
      for (const incoming of collections) {
        if (
          !isPortableText(incoming.id, 128) ||
          !incoming.members.every((member) => /^snippet:[0-9a-f-]{36}$/.test(member))
        )
          throw new Error('Invalid restored collection.');
        const current = value.collections.find((c) => c.id === incoming.id);
        if (current) current.members = [...new Set([...current.members, ...incoming.members])];
        else
          value.collections.push({
            ...incoming,
            name: libraryName(incoming.name),
            members: [...new Set(incoming.members)]
          });
      }
    },
    undefined,
    guard
  );
}
