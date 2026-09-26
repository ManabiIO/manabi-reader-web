/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { writable } from 'svelte/store';
import { equal, integrationDB, type BookLink } from '$lib/manabi/persistence';
import { libraryName } from './series-metadata';
import {
  applyPortableOrganization,
  isPortablePresentation,
  isPortableText,
  portableOrganization
} from './organization-portability';
import type { PageDirection } from './direction';
import { changeWantToRead, WANT_TO_READ_ID, type CollectionBook } from './want-to-read';

export interface Collection {
  id: string;
  name: string;
  members: string[];
}
export interface BookPresentation {
  title?: string;
  direction?: PageDirection;
  cover?: string;
  modifiedAt: number;
}
export interface Organization {
  version: 1;
  collections: Collection[];
  books: Record<string, BookPresentation>;
}
const key = 'books-organization-v1';
// A local write already publishes to this document's Svelte store. Tag
// BroadcastChannel messages so duplicate watchers in the same document do not
// immediately re-read IndexedDB and race that publication. Other tabs have
// their own module instance/source token and still reload normally. String
// messages from older deployed tabs remain compatible.
const broadcastSource = globalThis.crypto?.randomUUID?.() ?? String(Math.random());
export const emptyOrganization = (): Organization => ({ version: 1, collections: [], books: {} });
let currentOrganization = emptyOrganization();
let publicationRevision = 0;
export const organization = writable<Organization>(currentOrganization);
export const bookKey = (id: number) => `book:${id}`;
export const contentBookKey = (hash: string) => `content:${hash}`;
export const sourceKey = (source: { id: string; owner: string | null; root: string }) =>
  JSON.stringify([source.owner, source.id, source.root]);
export const sourceBookKey = (
  source: { id: string; owner: string | null; root: string },
  fileId: string
) => `source:${JSON.stringify([source.owner, source.id, source.root, fileId])}`;

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
    channel.postMessage({ type: 'changed', source: broadcastSource });
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
export async function updateOrganization(change: (value: Organization) => void) {
  // IndexedDB serializes cross-tab read/modify/write transactions even without Web Locks.
  const db = await integrationDB(),
    tx = db.transaction('metadata', 'readwrite');
  const value = ((await tx.store.get(key)) as Organization | undefined) ?? emptyOrganization();
  try {
    const before = structuredClone(value);
    change(value);
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
    channel.onmessage = (event) => {
      const message = event.data;
      if (
        message &&
        typeof message === 'object' &&
        message.type === 'changed' &&
        message.source === broadcastSource
      )
        return;
      void reloadOrganization().catch(onError);
    };
  return () => channel?.close();
}
export async function createCollection(name: string, members: string[] = []) {
  const collection = {
    id: crypto.randomUUID(),
    name: libraryName(name),
    members: [...new Set(members)]
  };
  await updateOrganization((value) => {
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
export async function presentBook(
  id: string,
  change: { title?: string; direction?: PageDirection; cover?: string }
) {
  if (change.title !== undefined) change.title = libraryName(change.title);
  await updateOrganization((value) => {
    const presentation = { ...value.books[id], ...change, modifiedAt: Date.now() };
    if (!isPortablePresentation(presentation))
      throw new Error('The book presentation override is invalid or too large.');
    value.books[id] = presentation;
  });
}

/** Replace browser- and provider-specific locators with content identity once it is known. */
export async function stabilizeOrganization(links: BookLink[]) {
  const replacements = new Map<string, string>();
  for (const link of links) {
    const stable = contentBookKey(link.contentHash);
    replacements.set(bookKey(link.bookId), stable);
    replacements.set(
      sourceBookKey({ id: link.sourceId, owner: link.owner, root: link.root }, link.fileId),
      stable
    );
  }
  await updateOrganization((value) => {
    for (const collection of value.collections)
      collection.members = [
        ...new Set(collection.members.map((member) => replacements.get(member) || member))
      ];
    for (const [before, after] of replacements) {
      const prior = value.books[before],
        current = value.books[after];
      if (prior && (!current || prior.modifiedAt > current.modifiedAt)) value.books[after] = prior;
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
    if (prior && (!current || prior.modifiedAt > current.modifiedAt)) value.books[after] = prior;
    delete value.books[before];
  });
}
