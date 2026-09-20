/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { writable } from 'svelte/store';
import { integrationDB } from '$lib/manabi/persistence';
import { libraryName } from './series-metadata';
import type { PageDirection } from './direction';

export interface Collection {
  id: string;
  name: string;
  members: string[];
}
export interface BookPresentation {
  title?: string;
  direction?: PageDirection;
  modifiedAt: number;
}
export interface Organization {
  version: 1;
  collections: Collection[];
  books: Record<string, BookPresentation>;
}
const key = 'books-organization-v1';
export const emptyOrganization = (): Organization => ({ version: 1, collections: [], books: {} });
export const organization = writable<Organization>(emptyOrganization());
export const bookKey = (id: number) => `book:${id}`;
export const sourceKey = (source: { id: string; owner: string | null; root: string }) =>
  JSON.stringify([source.owner, source.id, source.root]);
export const sourceBookKey = (
  source: { id: string; owner: string | null; root: string },
  fileId: string
) => `source:${JSON.stringify([source.owner, source.id, source.root, fileId])}`;

export async function reloadOrganization() {
  const value = (await (await integrationDB()).get('metadata', key)) as Organization | undefined;
  organization.set(value ?? emptyOrganization());
}
export async function updateOrganization(change: (value: Organization) => void) {
  // IndexedDB serializes cross-tab read/modify/write transactions even without Web Locks.
  const db = await integrationDB(),
    tx = db.transaction('metadata', 'readwrite');
  const value = ((await tx.store.get(key)) as Organization | undefined) ?? emptyOrganization();
  try {
    change(value);
    await tx.store.put(value, key);
    await tx.done;
    organization.set(value);
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const channel = new BroadcastChannel(key);
        channel.postMessage('changed');
        channel.close();
      } catch {
        /* Other tabs refresh on their next visit. */
      }
    }
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
  const title = libraryName(name);
  await updateOrganization((value) => {
    const collection = value.collections.find((c) => c.id === id);
    if (!collection) throw new Error('This collection no longer exists.');
    collection.name = title;
  });
}
export async function removeCollection(id: string) {
  await updateOrganization((value) => {
    value.collections = value.collections.filter((c) => c.id !== id);
  });
}
export async function setMembership(id: string, member: string, included: boolean) {
  await updateOrganization((value) => {
    const collection = value.collections.find((c) => c.id === id);
    if (!collection) throw new Error('This collection no longer exists.');
    collection.members = included
      ? [...new Set([...collection.members, member])]
      : collection.members.filter((k) => k !== member);
  });
}
export async function presentBook(
  id: string,
  change: { title?: string; direction?: PageDirection }
) {
  if (change.title !== undefined) change.title = libraryName(change.title);
  await updateOrganization((value) => {
    value.books[id] = { ...value.books[id], ...change, modifiedAt: Date.now() };
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
