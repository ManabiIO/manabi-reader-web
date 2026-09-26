/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { get, writable } from 'svelte/store';
import { database } from '$lib/data/store';
import {
  bookKey,
  contentBookKey,
  sourceBookKey,
  relocatePresentation,
  stabilizeOrganization
} from '$lib/library/organization';
import { StorageKey } from '$lib/data/storage/storage-types';
import { storageSource$ } from '$lib/data/storage/storage-view';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import loadEpub from '$lib/functions/file-loaders/epub/load-epub';
import loadTxt from '$lib/functions/file-loaders/txt/load-txt';
import loadHtmlz from '$lib/functions/file-loaders/htmlz/load-htmlz';
import { account, currentUser, IntegrationError } from './client';
import { integrationDB, exclusive, type BookLink } from './persistence';
import { sha256, type LibraryEntry, type LibrarySource } from './sources';
import {
  personalSyncStatus,
  resolvePersonalConflict,
  syncPersonalState,
  startPersonalSync
} from './personal-sync';

interface SyncStatus {
  state: string;
  message: string;
  at?: number;
  conflicts?: string[];
}
export const bookSyncStatus = writable<Record<string, SyncStatus>>({});
export const linkedBooks = writable<BookLink[]>([]);
// Keep the ownership map available even when the active account cannot use a link.
// The Library needs it to distinguish a direct browser import from a book saved
// through another account's cloud connection.
export const allLinkedBooks = writable<BookLink[] | null>(null);
function ensureOwner(link: BookLink) {
  if (link.owner !== null && currentUser()?.id !== link.owner)
    throw new IntegrationError('account_changed');
}
export async function refreshLinkedBooks() {
  const books = await (await integrationDB()).getAll('books');
  allLinkedBooks.set(books);
  const owner = currentUser()?.id ?? null;
  const visible = books.filter((book) => book.owner === null || book.owner === owner);
  await stabilizeOrganization(visible);
  if ((currentUser()?.id ?? null) !== owner) return;
  linkedBooks.set(visible);
}

export async function importLibraryBook(
  source: LibrarySource,
  item: LibraryEntry,
  syncEnabled = false
): Promise<BookLink> {
  return exclusive('import-library-book', async () => {
    if (source.owner !== null && source.owner !== currentUser()?.id)
      throw new IntegrationError('account_changed');
    const file = await source.read(item);
    const contentHash = await sha256(await file.arrayBuffer());
    const id = await sha256(
      JSON.stringify([source.owner, source.id, source.root, item.id, contentHash])
    );
    const integration = await integrationDB();
    const existing =
      (await integration.get('books', id)) ??
      (await integration.getAll('books')).find(
        (link) =>
          link.owner === source.owner &&
          link.sourceId === source.id &&
          link.root === source.root &&
          link.fileId === item.id &&
          link.contentHash === contentHash
      );
    if (existing && (await database.getData(existing.bookId))) {
      await relocatePresentation(
        sourceBookKey(source, item.id),
        contentBookKey(existing.contentHash)
      );
      await relocatePresentation(bookKey(existing.bookId), contentBookKey(existing.contentHash));
      return existing;
    }
    const same = (await integration.getAll('books')).find(
      (book) => book.contentHash === contentHash && book.owner === source.owner
    );
    let stored = same ? await database.getData(same.bookId) : undefined;
    if (!stored) {
      const suffix = file.name.split('.').pop()?.toLowerCase();
      const now = Date.now();
      const content =
        suffix === 'epub'
          ? await loadEpub(file, document, now)
          : suffix === 'txt'
            ? await loadTxt(file, now)
            : await loadHtmlz(file, document, now);
      let title = content.title;
      // Upstream's primary logical identity is the title. Never overwrite an
      // unrelated local book, another account's book, or a duplicate filename.
      if (await database.getDataByTitle(title))
        title = `${content.title} [${contentHash.slice(0, 10)}]`;
      let attempt = 1;
      while (await database.getDataByTitle(title))
        title = `${content.title} [${contentHash.slice(0, 10)}-${++attempt}]`;
      content.title = title;
      content.contentHash = contentHash;
      if (source.owner !== null && source.owner !== currentUser()?.id)
        throw new IntegrationError('account_changed');
      stored = await database.upsertData(content, ReplicationSaveBehavior.NewOnly, false, true);
    }
    const link: BookLink = {
      id,
      sourceId: source.id,
      owner: source.owner,
      root: source.root,
      fileId: item.id,
      name: item.name,
      contentHash,
      bookId: stored.id,
      title: stored.title,
      syncEnabled
    };
    await integration.put('books', link);
    await relocatePresentation(sourceBookKey(source, item.id), contentBookKey(contentHash));
    await relocatePresentation(bookKey(stored.id), contentBookKey(contentHash));
    getStorageHandler(window, StorageKey.BROWSER).clearData();
    storageSource$.next(StorageKey.BROWSER);
    database.dataListChanged$.next(undefined);
    await refreshLinkedBooks();
    if (syncEnabled) await syncBook(link.id);
    return link;
  });
}

export async function syncBook(id: string, choice?: 'local' | 'remote'): Promise<void> {
  const link = await (await integrationDB()).get('books', id);
  if (!link) throw new IntegrationError('not_found');
  ensureOwner(link);
  const conflicts = get(personalSyncStatus).conflicts.filter(
    (value) => value.bookKey === `content:${link.contentHash}`
  );
  if (choice) for (const conflict of conflicts) await resolvePersonalConflict(conflict.id, choice);
  else await syncPersonalState();
}

export async function syncAllLinkedBooks() {
  await refreshLinkedBooks();
  await syncPersonalState();
}

export function startBookSync() {
  const stop = startPersonalSync();
  const updateStatuses = () => {
    const status = get(personalSyncStatus);
    const entries: Record<string, SyncStatus> = {};
    for (const link of get(linkedBooks)) {
      const conflicts = status.conflicts.filter(
        (value) => value.bookKey === `content:${link.contentHash}`
      );
      entries[link.id] = {
        state: conflicts.length ? 'conflict' : status.state,
        message: conflicts.length
          ? `${conflicts.length} personal-state conflict(s) need review.`
          : status.message,
        conflicts: conflicts.map((value) => `${value.kind}: ${value.fields.join(', ')}`),
        at: Date.now()
      };
    }
    bookSyncStatus.set(entries);
  };
  const unsubscribeStatus = personalSyncStatus.subscribe(updateStatuses);
  const unsubscribeBooks = linkedBooks.subscribe(updateStatuses);
  const unsubscribeAccount = account.subscribe(() => {
    void refreshLinkedBooks();
  });
  void refreshLinkedBooks();
  return () => {
    stop();
    unsubscribeStatus();
    unsubscribeBooks();
    unsubscribeAccount();
  };
}
