/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { get, writable } from 'svelte/store';
import { database } from '$lib/data/store';
import type {
  BooksDbBookmarkData,
  BooksDbStatistic
} from '$lib/data/database/books-db/versions/books-db';
import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
import { storageSource$ } from '$lib/data/storage/storage-view';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import loadEpub from '$lib/functions/file-loaders/epub/load-epub';
import loadTxt from '$lib/functions/file-loaders/txt/load-txt';
import loadHtmlz from '$lib/functions/file-loaders/htmlz/load-htmlz';
import { account, currentUser, IntegrationError } from './client';
import { integrationDB, exclusive, equal, mergeRecords, type BookLink } from './persistence';
import {
  sha256,
  sourceFor,
  type LibraryEntry,
  type LibrarySource,
  type StateCopy
} from './sources';

interface ReadingState extends Record<string, unknown> {
  version: 1;
  contentHash: string;
  bookmark: Record<string, unknown> | null;
  statistics: Record<string, Record<string, unknown>>;
}
interface SyncStatus {
  state: string;
  message: string;
  at?: number;
  conflicts?: string[];
  branches?: { id: string; createdAt: string }[];
}
export const bookSyncStatus = writable<Record<string, SyncStatus>>({});
export const linkedBooks = writable<BookLink[]>([]);
const numericBookmark = [
  'scrollX',
  'scrollY',
  'exploredCharCount',
  'lastBookmarkModified'
] as const;
const statisticFields = [
  'charactersRead',
  'readingTime',
  'minReadingSpeed',
  'altMinReadingSpeed',
  'lastReadingSpeed',
  'maxReadingSpeed',
  'lastStatisticModified'
] as const;
const allowedBookmark = new Set<string>([...numericBookmark, 'progress']);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finite(value: unknown, signed = false): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= 1e15 &&
    (signed || value >= 0)
  );
}
function validateState(value: unknown, hash: string): ReadingState {
  if (
    !object(value) ||
    value.version !== 1 ||
    value.contentHash !== hash ||
    !object(value.statistics) ||
    Object.keys(value).some(
      (key) => !['version', 'contentHash', 'bookmark', 'statistics'].includes(key)
    )
  ) {
    throw new IntegrationError('invalid_response');
  }
  if (value.bookmark !== null) {
    if (
      !object(value.bookmark) ||
      Object.keys(value.bookmark).some((key) => !allowedBookmark.has(key))
    )
      throw new IntegrationError('invalid_response');
    for (const key of numericBookmark) {
      if (
        value.bookmark[key] !== undefined &&
        !finite(value.bookmark[key], key === 'scrollX' || key === 'scrollY')
      )
        throw new IntegrationError('invalid_response');
    }
    const progress = value.bookmark.progress;
    if (
      progress !== undefined &&
      !finite(progress) &&
      !(typeof progress === 'string' && /^\d+(?:\.\d+)?%?$/.test(progress))
    ) {
      throw new IntegrationError('invalid_response');
    }
  }
  if (Object.keys(value.statistics).length > 20000) throw new IntegrationError('too_large');
  for (const [date, statistic] of Object.entries(value.statistics)) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      !object(statistic) ||
      Object.keys(statistic).some(
        (key) => ![...statisticFields, 'completedBook', 'completedData'].includes(key as any)
      )
    ) {
      throw new IntegrationError('invalid_response');
    }
    for (const key of statisticFields)
      if (!finite(statistic[key])) throw new IntegrationError('invalid_response');
    if (statistic.completedBook !== undefined && statistic.completedBook !== 1)
      throw new IntegrationError('invalid_response');
    if (statistic.completedData !== undefined) {
      if (
        !object(statistic.completedData) ||
        Object.keys(statistic.completedData).some(
          (key) => ![...statisticFields, 'dateKey', 'completedBook'].includes(key as any)
        )
      )
        throw new IntegrationError('invalid_response');
      for (const [key, field] of Object.entries(statistic.completedData)) {
        if (key === 'dateKey' ? field !== date : !finite(field))
          throw new IntegrationError('invalid_response');
      }
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > 65536)
    throw new IntegrationError('too_large');
  return value as ReadingState;
}
function empty(hash: string): ReadingState {
  return { version: 1, contentHash: hash, bookmark: null, statistics: {} };
}
function flat(state: ReadingState): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  if (state.bookmark !== null) result.bookmark = state.bookmark;
  for (const [date, statistic] of Object.entries(state.statistics))
    result[`day/${date}`] = statistic;
  return result;
}
function unflat(hash: string, state: Record<string, unknown>): ReadingState {
  const result = empty(hash);
  result.bookmark = (state.bookmark as Record<string, unknown>) ?? null;
  for (const [key, value] of Object.entries(state))
    if (key.startsWith('day/')) result.statistics[key.slice(4)] = value as Record<string, unknown>;
  return result;
}
function compact(
  bookmark: BooksDbBookmarkData | undefined,
  statistics: BooksDbStatistic[],
  hash: string
): ReadingState {
  const result = empty(hash);
  if (bookmark) {
    result.bookmark = {};
    for (const key of [...numericBookmark, 'progress'] as const) {
      if (bookmark[key] !== undefined) result.bookmark[key] = bookmark[key];
    }
  }
  for (const statistic of statistics) {
    const item: Record<string, unknown> = {};
    for (const key of statisticFields) item[key] = statistic[key];
    if (statistic.completedBook) item.completedBook = statistic.completedBook;
    if (statistic.completedData) item.completedData = statistic.completedData;
    result.statistics[statistic.dateKey] = item;
  }
  return validateState(result, hash);
}
async function capture(link: BookLink): Promise<ReadingState> {
  const db = await database.db;
  const tx = db.transaction(['bookmark', 'statistic']);
  const [bookmark, statistics] = await Promise.all([
    tx.objectStore('bookmark').get(link.bookId),
    tx.objectStore('statistic').getAll(IDBKeyRange.bound([link.title], [link.title, []]))
  ]);
  await tx.done;
  return compact(bookmark, statistics, link.contentHash);
}
function ensureOwner(link: BookLink) {
  if (link.owner !== null && currentUser()?.id !== link.owner)
    throw new IntegrationError('account_changed');
}
function setStatus(id: string, value: SyncStatus) {
  bookSyncStatus.update((statuses) => ({ ...statuses, [id]: value }));
}
export async function refreshLinkedBooks() {
  const books = await (await integrationDB()).getAll('books');
  linkedBooks.set(books.filter((book) => book.owner === null || book.owner === currentUser()?.id));
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
    const existing = await integration.get('books', id);
    if (existing && (await database.getData(existing.bookId))) return existing;
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
    getStorageHandler(window, StorageKey.BROWSER).clearData();
    storageSource$.next(StorageKey.BROWSER);
    database.dataListChanged$.next(undefined);
    await refreshLinkedBooks();
    if (syncEnabled) await syncBook(link.id);
    return link;
  });
}

export async function setBookSync(id: string, enabled: boolean) {
  const db = await integrationDB();
  const link = await db.get('books', id);
  if (!link) throw new IntegrationError('not_found');
  ensureOwner(link);
  link.syncEnabled = enabled;
  await db.put('books', link);
  await refreshLinkedBooks();
  if (enabled) await syncBook(id);
  else
    setStatus(id, {
      state: 'off',
      message: 'Reading sync is off. Local reading data is retained.'
    });
}

async function applyAcknowledged(link: BookLink, captured: ReadingState, accepted: ReadingState) {
  ensureOwner(link);
  const db = await database.db;
  const tx = db.transaction(['data', 'bookmark', 'statistic', 'lastModified'], 'readwrite');
  try {
    const book = await tx.objectStore('data').get(link.bookId);
    if (!book || book.title !== link.title) throw new IntegrationError('not_found');
    const bookmarks = tx.objectStore('bookmark'),
      statistics = tx.objectStore('statistic');
    const latest = compact(
      await bookmarks.get(link.bookId),
      await statistics.getAll(IDBKeyRange.bound([link.title], [link.title, []])),
      link.contentHash
    );
    const merge = mergeRecords(flat(captured), flat(latest), flat(accepted));
    const next = unflat(link.contentHash, merge.merged);
    // Keep changes made while I/O was pending; the acknowledgement is only the
    // accepted remote baseline, not permission to replace newer local reading.
    if (next.bookmark === null) await bookmarks.delete(link.bookId);
    else
      await bookmarks.put({
        ...next.bookmark,
        dataId: link.bookId
      } as unknown as BooksDbBookmarkData);
    const nextDates = new Set(Object.keys(next.statistics));
    for (const date of Object.keys(latest.statistics))
      if (!nextDates.has(date)) await statistics.delete([link.title, date]);
    let lastModified = 0;
    for (const [date, value] of Object.entries(next.statistics)) {
      await statistics.put({
        ...value,
        title: link.title,
        dateKey: date
      } as unknown as BooksDbStatistic);
      lastModified = Math.max(lastModified, Number(value.lastStatisticModified));
    }
    await tx.objectStore('lastModified').put({
      title: link.title,
      dataType: StorageDataType.STATISTICS,
      lastModifiedValue: lastModified
    });
    await tx.done;
    database.bookmarksChanged$.next();
    return equal(next, accepted);
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* The transaction may already have completed. */
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
}

export async function syncBook(
  id: string,
  choice?: 'local' | 'remote',
  branchId?: string
): Promise<void> {
  await exclusive(`book-sync/${id}`, async () => {
    const integration = await integrationDB();
    const link = await integration.get('books', id);
    if (!link?.syncEnabled) return;
    try {
      ensureOwner(link);
      const data = await database.getData(link.bookId);
      if (!data || data.title !== link.title) throw new IntegrationError('not_found');
      setStatus(id, { state: 'syncing', message: 'Syncing reading progress and statistics…' });
      const source = await sourceFor(link.sourceId, link.root, link.owner);
      const captured = await capture(link);
      const remote = await source.state(`book_${link.contentHash}`);
      ensureOwner(link);
      let there: ReadingState;
      if (remote.branches?.length) {
        if (choice !== 'local' && !(choice === 'remote' && branchId)) {
          setStatus(id, {
            state: 'conflict',
            message: 'This folder contains concurrent saves. Choose a copy to keep.',
            branches: remote.branches.map(({ id: branch, createdAt }) => ({
              id: branch,
              createdAt
            }))
          });
          return;
        }
        const selected = branchId
          ? remote.branches.find((branch) => branch.id === branchId)
          : undefined;
        if (choice === 'remote' && !selected) throw new IntegrationError('conflict');
        there = selected
          ? validateState(selected.value, link.contentHash)
          : empty(link.contentHash);
      } else
        there =
          remote.value === null
            ? empty(link.contentHash)
            : validateState(remote.value, link.contentHash);
      const base = link.base ? validateState(link.base, link.contentHash) : empty(link.contentHash);
      let merged: ReadingState;
      if (choice === 'local') merged = captured;
      else if (choice === 'remote') merged = there;
      else {
        const result = mergeRecords(flat(base), flat(captured), flat(there));
        if (result.conflicts.length) {
          setStatus(id, {
            state: 'conflict',
            message: 'Reading data changed on both devices. No copy was overwritten.',
            conflicts: result.conflicts
          });
          return;
        }
        merged = unflat(link.contentHash, result.merged);
      }
      validateState(merged, link.contentHash);
      const stillEnabled = async () => (await integration.get('books', id))?.syncEnabled === true;
      if (!(await stillEnabled())) return;
      let accepted: StateCopy = remote;
      if (remote.branches?.length || !equal(merged, there)) {
        accepted = await source.write(`book_${link.contentHash}`, merged, remote.revision);
        ensureOwner(link);
        if (
          accepted.branches ||
          accepted.value === null ||
          !equal(validateState(accepted.value, link.contentHash), merged)
        ) {
          throw new IntegrationError('conflict');
        }
      }
      if (!(await stillEnabled())) return;
      ensureOwner(link);
      const clean = await applyAcknowledged(link, captured, merged);
      // Do not resurrect a binding removed or disabled while synchronization ran.
      const current = await integration.get('books', id);
      if (current) await integration.put('books', { ...current, base: merged });
      setStatus(id, {
        state: clean ? 'synced' : 'pending',
        message: clean
          ? link.owner === null
            ? 'Saved to this folder. Its cloud client manages upload separately.'
            : 'Reading data synced.'
          : 'Newer local changes are saved on this device and pending sync.',
        at: Date.now()
      });
    } catch (error) {
      const failure =
        error instanceof IntegrationError
          ? error
          : new IntegrationError(
              error instanceof DOMException &&
              ['NotAllowedError', 'SecurityError'].includes(error.name)
                ? 'permission_required'
                : 'unavailable'
            );
      setStatus(id, { state: failure.code, message: failure.message });
    }
  });
}

export async function syncAllLinkedBooks() {
  await refreshLinkedBooks();
  for (const link of get(linkedBooks)) if (link.syncEnabled) await syncBook(link.id);
}

export function startBookSync() {
  let stopped = false,
    running = false,
    bootstrapped = false;
  const run = async (all = false) => {
    if (stopped || running) return;
    running = true;
    try {
      await refreshLinkedBooks();
      const currentId = Number(new URL(location.href).searchParams.get('id'));
      const links = get(linkedBooks).filter(
        (link) => link.syncEnabled && (all || link.bookId === currentId)
      );
      for (const link of links) {
        if (stopped) break;
        const status = get(bookSyncStatus)[link.id];
        // Conflict resolution is always an explicit user choice.
        if (status?.state !== 'conflict') await syncBook(link.id);
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') void run();
  }, 30000);
  const leave = () => {
    if (document.visibilityState === 'hidden') void run();
  };
  const online = () => {
    void run(true);
  };
  const unsubscribe = account.subscribe(({ status }) => {
    void refreshLinkedBooks();
    if (status === 'available' && !bootstrapped) {
      bootstrapped = true;
      void run(true);
    }
  });
  document.addEventListener('visibilitychange', leave);
  window.addEventListener('online', online);
  void run();
  return () => {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
    document.removeEventListener('visibilitychange', leave);
    window.removeEventListener('online', online);
  };
}
