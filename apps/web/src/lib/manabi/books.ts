/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { WebDavSource } from '$lib/webdav/source';
import { davSyncStatus, syncDavBook, syncEnabledDavBooks } from '$lib/webdav/sync';
import { get, writable } from 'svelte/store';
import { database } from '$lib/data/store';
import { stabilizeOrganization } from '$lib/library/organization';
import { StorageKey } from '$lib/data/storage/storage-types';
import { storageSource$ } from '$lib/data/storage/storage-view';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import type { StoredBookData } from '$lib/data/database/books-db/versions/books-db';
import { encodeBook } from '$lib/data/database/books-db/book-binary';
import { commitTransaction } from '$lib/data/database/books-db/commit-transaction.mjs';
import {
  commitLibraryBook,
  readIndexedBookIdentities
} from '$lib/data/database/books-db/library-import';
import {
  normalizedContentHash,
  resolveImportedBook,
  selectBookLink
} from '$lib/library/book-identity';
import loadEpub from '$lib/functions/file-loaders/epub/load-epub';
import loadTxt from '$lib/functions/file-loaders/txt/load-txt';
import loadHtmlz from '$lib/functions/file-loaders/htmlz/load-htmlz';
import { currentUser, localProfileUser, localUser, IntegrationError } from './client';
import { integrationDB, exclusive, type BookLink } from './persistence';
import { captureLibraryOperation } from './operation-scope';
import { LocalLibrarySource, sha256, type LibraryEntry, type LibrarySource } from './sources';
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
let linkRefreshGeneration = 0;
export async function refreshLinkedBooks() {
  const generation = ++linkRefreshGeneration;
  const owner = localProfileUser()?.id ?? null;
  const current = () =>
    generation === linkRefreshGeneration && (localProfileUser()?.id ?? null) === owner;
  const books = await (await integrationDB()).getAll('books');
  if (!current()) return;
  const visible = books.filter((book) => book.owner === null || book.owner === owner);
  const records = await readIndexedBookIdentities(await database.db);
  if (!current()) return;
  await stabilizeOrganization(visible, records);
  if (!current()) return;
  allLinkedBooks.set(books);
  const byId = new Map(records.map((record) => [record.id, record]));
  // Keep historical claims in allLinkedBooks and alias migration, but do not
  // expose stale claims as usable links to cached-open, cover or sync callers.
  linkedBooks.set(
    visible.filter((link) => {
      const record = byId.get(link.bookId);
      const hash = normalizedContentHash(record?.contentHash);
      return (
        !!hash &&
        hash === normalizedContentHash(link.contentHash) &&
        (record?.libraryOwner === undefined || record.libraryOwner === link.owner)
      );
    })
  );
}

export async function importLibraryBook(
  source: LibrarySource,
  item: LibraryEntry,
  syncEnabled = false,
  expectedBookId?: number
): Promise<BookLink> {
  const scope = captureLibraryOperation(source.owner);
  const selectedFile = { ...item };
  const sourceIdentity = { id: source.id, owner: source.owner, root: source.root };
  try {
    return await exclusive(
      'import-library-book',
      async () => {
        scope.assertCurrent();
        const file = await source.read(selectedFile);
        scope.assertCurrent();
        const contentHash = await sha256(await file.arrayBuffer());
        if (
          selectedFile.expectedContentHash !== undefined &&
          normalizedContentHash(selectedFile.expectedContentHash) !== contentHash
        )
          throw new Error('The source book changed. Refresh the Library before opening it again.');
        const integration = await integrationDB();
        const db = await database.db;
        const links = await integration.getAll('books');
        const records = await readIndexedBookIdentities(db);
        scope.assertCurrent();
        const selected = resolveImportedBook(
          records,
          links,
          sourceIdentity,
          selectedFile.id,
          contentHash,
          expectedBookId
        );
        const cached = selected === undefined ? undefined : await db.get('data', selected);
        scope.assertCurrent();
        let prepared: Omit<StoredBookData, 'id'> | undefined;
        if (!cached?.elementHtml) {
          const suffix = file.name.split('.').pop()?.toLowerCase();
          const now = Date.now();
          const content =
            suffix === 'epub'
              ? await loadEpub(file, document, now)
              : suffix === 'txt'
                ? await loadTxt(file, now)
                : await loadHtmlz(file, document, now);
          scope.assertCurrent();
          content.contentHash = contentHash;
          prepared = await encodeBook(content);
        }
        scope.assertCurrent();
        const id = await sha256(
          JSON.stringify([
            sourceIdentity.owner,
            sourceIdentity.id,
            sourceIdentity.root,
            selectedFile.id,
            contentHash
          ])
        );
        // Normal links retain their old encoding; only a moved/occupied row ID
        // needs a new opaque ID. Compute non-IDB work before the transaction.
        const fallbackId = await sha256(`${id}:${crypto.randomUUID()}`);
        const currentLinks = await integration.getAll('books');
        const stored = await commitLibraryBook(
          db,
          currentLinks,
          {
            source: sourceIdentity,
            fileId: selectedFile.id,
            contentHash,
            expectedBookId: expectedBookId ?? selected
          },
          prepared,
          scope.assertCurrent,
          scope.signal
        );
        const proposed: BookLink = {
          id,
          sourceId: sourceIdentity.id,
          owner: sourceIdentity.owner,
          root: sourceIdentity.root,
          fileId: selectedFile.id,
          name: selectedFile.name,
          contentHash,
          bookId: stored.id,
          title: stored.title,
          syncEnabled
        };
        scope.assertCurrent();
        let savedLink: BookLink;
        if (source instanceof WebDavSource) {
          const candidate = selectBookLink(
            await integration.getAll('books'),
            proposed,
            stored.compatibleBookIds,
            fallbackId
          );
          scope.assertCurrent();
          // This path retains WebDAV's connection/configuration and consent checks.
          savedLink = await source.persistLink(candidate);
        } else {
          const tx = integration.transaction(['books', 'localLibraries'], 'readwrite');
          const abort = () => {
            try {
              tx.abort();
            } catch {
              /* Already settled. */
            }
          };
          scope.signal.addEventListener('abort', abort, { once: true });
          try {
            savedLink = await commitTransaction(tx, async () => {
              scope.assertCurrent();
              if (
                source instanceof LocalLibrarySource &&
                !(await tx.objectStore('localLibraries').get(sourceIdentity.id))
              )
                throw new IntegrationError('not_found');
              const latest = await tx.objectStore('books').getAll();
              const candidate = selectBookLink(
                latest,
                proposed,
                stored.compatibleBookIds,
                fallbackId
              );
              scope.assertCurrent();
              // add, never put: an occupied ID cannot silently replace another locator.
              if (!latest.some((link) => link.id === candidate.id))
                await tx.objectStore('books').add(candidate);
              scope.assertCurrent();
              return candidate;
            });
          } finally {
            scope.signal.removeEventListener('abort', abort);
          }
        }
        scope.assertCurrent();
        // Promotion validates all retained claims; an old path alias cannot
        // migrate to a replacement revision merely because its link appeared last.
        await refreshLinkedBooks();
        scope.assertCurrent();
        getStorageHandler(window, StorageKey.BROWSER).clearData();
        storageSource$.next(StorageKey.BROWSER);
        database.dataListChanged$.next(undefined);
        if (syncEnabled) await syncBook(savedLink.id);
        return savedLink;
      },
      scope.signal
    );
  } finally {
    scope.stop();
  }
}

export async function syncBook(id: string, choice?: 'local' | 'remote'): Promise<void> {
  const link = await (await integrationDB()).get('books', id);
  if (!link) throw new IntegrationError('not_found');
  ensureOwner(link);
  if (link.sourceId.startsWith('webdav-')) return syncDavBook(id, choice);
  const conflicts = get(personalSyncStatus).conflicts.filter(
    (value) => value.bookKey === `content:${link.contentHash}`
  );
  if (choice) for (const conflict of conflicts) await resolvePersonalConflict(conflict.id, choice);
  else await syncPersonalState();
}

export async function syncAllLinkedBooks() {
  await refreshLinkedBooks();
  if (currentUser()) await syncPersonalState();
  await syncEnabledDavBooks();
}

export function startBookSync() {
  const stop = startPersonalSync();
  const updateStatuses = () => {
    const status = get(personalSyncStatus);
    const entries: Record<string, SyncStatus> = {};
    for (const link of get(linkedBooks)) {
      if (link.sourceId.startsWith('webdav-')) {
        const dav = get(davSyncStatus)[link.id];
        entries[link.id] = dav ?? {
          state: link.syncEnabled ? 'idle' : 'off',
          message: link.syncEnabled
            ? 'WebDAV reading sync is enabled.'
            : 'WebDAV reading sync is off.'
        };
        continue;
      }
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
  const unsubscribeDav = davSyncStatus.subscribe(updateStatuses);
  const syncDav = () => {
    void syncEnabledDavBooks().catch(() => undefined);
  };
  const davTimer = setInterval(syncDav, 45000);
  window.addEventListener('online', syncDav);
  document.addEventListener('visibilitychange', syncDav);
  const unsubscribeBooks = linkedBooks.subscribe(updateStatuses);
  const unsubscribeAccount = localUser.subscribe(() => {
    void refreshLinkedBooks();
  });
  void refreshLinkedBooks();
  return () => {
    stop();
    unsubscribeStatus();
    unsubscribeDav();
    clearInterval(davTimer);
    window.removeEventListener('online', syncDav);
    document.removeEventListener('visibilitychange', syncDav);
    unsubscribeBooks();
    unsubscribeAccount();
  };
}
