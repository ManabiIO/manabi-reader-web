/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { writable, get } from 'svelte/store';
import type { IDBPTransaction } from 'idb';
import { database } from '$lib/data/store';
import type BooksDb from '$lib/data/database/books-db/versions/books-db';
import type { ReaderAnnotation } from '$lib/data/database/books-db/versions/v7/books-db-v7';
import type {
  ReaderImportRecord,
  ExternalSyncState
} from '$lib/data/database/books-db/versions/v10/books-db-v10';
import {
  migrateLegacyStatistics,
  statisticRange
} from '$lib/data/database/books-db/reader-statistics';
import { currentUser } from '$lib/manabi/client';
import {
  integrationDB,
  exclusive,
  equal,
  mergeRecords,
  type BookLink
} from '$lib/manabi/persistence';
import { documentFor, validateDavDocument, wireCopy } from './sync-codec';
import { davSource, withDavSourceLock } from './source';
import { withWebDavApplyLease } from './reader-lock';
import { DavError } from './client';

export interface DavSyncStatus {
  state: 'off' | 'idle' | 'syncing' | 'synced' | 'conflict' | 'error';
  message: string;
  conflicts?: string[];
  missing?: boolean;
}
export const davSyncStatus = writable<Record<string, DavSyncStatus>>({});
const stores = [
  'data',
  'bookmark',
  'readerStatistic',
  'readerAnnotation',
  'readerAnnotationScope',
  'readerAnnotationOutbox',
  'readerBookScope',
  'readerImportRecord',
  'readerExternalSync',
  'lastModified'
] as const;
type Tx = IDBPTransaction<BooksDb, typeof stores, 'readwrite'>;
const currentScope = () => currentUser()?.id ?? null;
function status(id: string, value: DavSyncStatus) {
  davSyncStatus.update((map) => ({ ...map, [id]: value }));
}
export function readerIsOpen() {
  return typeof window !== 'undefined' && /\/b\/?$/.test(window.location.pathname);
}
function guard(link: BookLink) {
  if (link.davAccountId === undefined || link.davAccountId !== currentScope())
    throw new Error(
      'WebDAV reading sync is bound to a different account session. Review this book’s sync choice.'
    );
  if (readerIsOpen())
    throw new Error(
      'Reading data will sync after returning to the Library, so an active reader cannot overwrite a newly received position.'
    );
}
const stateId = (link: BookLink) => JSON.stringify([link.id, link.davAccountId]);
function checkSourceRoot(link: BookLink, root: string) {
  if (link.root !== root)
    throw new DavError(
      'reconnect',
      'This book belongs to a different WebDAV folder. Reimport it from the selected folder before enabling sync.'
    );
}
async function active(link: BookLink) {
  guard(link);
  const now = await (await integrationDB()).get('books', link.id);
  if (
    !now ||
    !now.syncEnabled ||
    now.davAccountId !== link.davAccountId ||
    now.contentHash !== link.contentHash ||
    now.root !== link.root
  )
    throw new Error('This WebDAV sync was disabled or its book changed.');
  guard(link);
}
async function snapshot(tx: Tx, link: BookLink) {
  guard(link);
  const book = await tx.objectStore('data').get(link.bookId),
    scope = await tx.objectStore('readerBookScope').get(link.bookId);
  if (
    !book ||
    book.contentHash !== link.contentHash ||
    (scope && scope.accountId !== link.davAccountId)
  )
    throw new Error('This WebDAV book is unavailable in the active account.');
  const bookKey = `content:${link.contentHash}`,
    records: Record<string, unknown> = Object.create(null);
  const mark = await tx.objectStore('bookmark').get(book.id);
  if (mark) {
    const { dataId: _id, ...value } = mark;
    records.resume = value;
  }
  for (const row of await tx.objectStore('readerStatistic').getAll(statisticRange(bookKey))) {
    const { title: _title, bookKey: _key, ...value } = row;
    records[`statistics/${row.dateKey}`] = value;
  }
  for (const row of await tx.objectStore('readerAnnotation').index('bookKey').getAll(bookKey)) {
    const owner = await tx.objectStore('readerAnnotationScope').get(row.id);
    if (!owner || owner.accountId === link.davAccountId) records[`annotation/${row.id}`] = row;
  }
  for (const row of await tx.objectStore('readerImportRecord').index('bookKey').getAll(bookKey)) {
    if (row.accountId !== null && row.accountId !== link.davAccountId) continue;
    const { bookId: _id, accountId: _account, ...value } = row;
    records[`import/${row.id}`] = value;
  }
  const checkpoint = await tx.objectStore('readerExternalSync').get(stateId(link));
  if (
    checkpoint &&
    (checkpoint.bookId !== book.id ||
      checkpoint.root !== link.root ||
      checkpoint.sourceId !== link.sourceId ||
      checkpoint.accountId !== link.davAccountId)
  )
    throw new Error('WebDAV acknowledgement belongs to another source.');
  guard(link);
  return { book, records: documentFor(bookKey, wireCopy(records)).records, checkpoint };
}
async function apply(
  tx: Tx,
  link: BookLink,
  here: Record<string, unknown>,
  next: Record<string, unknown>,
  title: string
) {
  const bookKey = `content:${link.contentHash}`,
    time = new Date().toISOString();
  for (const key of new Set([...Object.keys(here), ...Object.keys(next)])) {
    if (equal(here[key], next[key])) continue;
    guard(link);
    if (key === 'resume') {
      const value = next[key] as Omit<BooksDb['bookmark']['value'], 'dataId'> | undefined;
      if (value) await tx.objectStore('bookmark').put({ ...value, dataId: link.bookId });
      else await tx.objectStore('bookmark').delete(link.bookId);
    } else if (key.startsWith('statistics/')) {
      const day = key.slice(11),
        value = next[key] as
          | Omit<BooksDb['readerStatistic']['value'], 'title' | 'bookKey'>
          | undefined;
      if (value) await tx.objectStore('readerStatistic').put({ ...value, title, bookKey });
      else await tx.objectStore('readerStatistic').delete([bookKey, day]);
      await tx
        .objectStore('lastModified')
        .put({ title: bookKey, dataType: 'statistic', lastModifiedValue: Date.now() });
    } else if (key.startsWith('annotation/')) {
      const id = key.slice(11),
        previous = await tx.objectStore('readerAnnotation').get(id);
      const owner = await tx.objectStore('readerAnnotationScope').get(id);
      if (
        (previous?.bookKey !== undefined && previous.bookKey !== bookKey) ||
        (owner && owner.accountId !== link.davAccountId)
      )
        throw new Error('WebDAV annotation collides with another book or account.');
      const incoming = next[key] as ReaderAnnotation | undefined;
      if (!incoming && !previous) continue;
      const value: ReaderAnnotation = incoming
        ? {
            ...incoming,
            revision: previous
              ? Math.max(previous.revision, incoming.revision) + 1
              : incoming.revision
          }
        : { ...previous!, revision: previous!.revision + 1, modifiedAt: time, deletedAt: time };
      await tx.objectStore('readerAnnotation').put(value);
      if (link.davAccountId) {
        await tx
          .objectStore('readerAnnotationScope')
          .put({ annotationId: id, accountId: link.davAccountId });
        await tx.objectStore('readerAnnotationOutbox').put({
          id: crypto.randomUUID(),
          accountId: link.davAccountId,
          bookKey,
          annotationId: id,
          baseRevision: previous?.revision ?? 0,
          localRevision: value.revision,
          value,
          createdAt: time
        });
      }
    } else if (key.startsWith('import/')) {
      const id = key.slice(7),
        previous = await tx.objectStore('readerImportRecord').get(id);
      if (
        previous &&
        (previous.bookKey !== bookKey ||
          (previous.accountId !== null && previous.accountId !== link.davAccountId))
      )
        throw new Error('WebDAV notebook collides with another book or account.');
      const incoming = next[key] as ReaderImportRecord | undefined;
      if (incoming)
        await tx
          .objectStore('readerImportRecord')
          .put({ ...incoming, bookId: link.bookId, accountId: link.davAccountId! });
      else if (previous)
        await tx
          .objectStore('readerImportRecord')
          .put({ ...previous, modifiedAt: time, deletedAt: time });
    }
  }
}
export async function setDavBookSync(id: string, enabled: boolean) {
  const scope = currentScope();
  const db = await integrationDB(),
    link = await db.get('books', id);
  if (!link || !link.sourceId.startsWith('webdav-')) throw new Error('WebDAV book not found.');
  return withDavSourceLock(link.sourceId, async () => {
    const source = await davSource(link.sourceId);
    checkSourceRoot(link, source.root);
    const bookScope = await (await database.db).get('readerBookScope', link.bookId);
    if (enabled && bookScope && bookScope.accountId !== scope)
      throw new Error('This book belongs to another account.');
    if (enabled && !source.configuration.writable)
      throw new Error('Allow reading-data write-back in the WebDAV connection first.');
    if (scope !== currentScope()) throw new Error('Account changed.');
    // Consent cannot resurrect a disconnected or replaced link after a picker/account await.
    const tx = db.transaction(['books', 'metadata'], 'readwrite');
    try {
      const latest = await tx.objectStore('books').get(id);
      const configuration = await tx.objectStore('metadata').get(`webdav-source:${link.sourceId}`);
      if (
        scope !== currentScope() ||
        !equal(latest, link) ||
        !equal(configuration, source.configuration)
      )
        throw new Error('The account or WebDAV book changed. Review its sync choice again.');
      await tx.objectStore('books').put({ ...link, syncEnabled: enabled, davAccountId: scope });
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* The transaction may already have failed. */
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
    status(id, {
      state: enabled ? 'idle' : 'off',
      message: enabled
        ? 'WebDAV reading sync enabled for this account session.'
        : 'WebDAV reading sync is off.'
    });
  });
}
/** Three-way field merge. A remote acceptance and local edits are reconciled in one local transaction. */
export async function syncDavBook(id: string, choice?: 'local' | 'remote') {
  const scope = currentScope();
  return exclusive(`webdav-sync:${id}`, async () => {
    try {
      const link = await (await integrationDB()).get('books', id);
      if (!link) {
        status(id, { state: 'off', message: 'This WebDAV source is disconnected.' });
        return;
      }
      return await withDavSourceLock(link.sourceId, () => {
        if (scope !== currentScope() || link.davAccountId !== scope)
          throw new Error('Account changed while WebDAV sync was waiting. Review its sync choice.');
        return withWebDavApplyLease(() => performDavSync(id, choice));
      });
    } catch (error) {
      status(id, {
        state: 'error',
        message: error instanceof Error ? error.message : 'WebDAV sync failed; local data was kept.'
      });
    }
  });
}
async function performDavSync(id: string, choice?: 'local' | 'remote') {
  let link: BookLink | undefined;
  try {
    link = await (await integrationDB()).get('books', id);
    if (!link || !link.syncEnabled) {
      status(id, { state: 'off', message: 'Enable WebDAV reading sync for this book first.' });
      return;
    }
    await active(link);
    status(id, { state: 'syncing', message: 'Syncing directly with WebDAV…' });
    const source = await davSource(link.sourceId),
      db = await database.db,
      bookKey = `content:${link.contentHash}`;
    checkSourceRoot(link, source.root);
    const book = await db.get('data', link.bookId);
    if (!book) throw new Error('Book no longer exists.');
    const scope = await db.get('readerBookScope', link.bookId);
    if (scope && scope.accountId !== link.davAccountId)
      throw new Error('Book belongs to another account.');
    await migrateLegacyStatistics(db, book);
    await active(link);
    const read = db.transaction(stores, 'readwrite');
    let observed: Awaited<ReturnType<typeof snapshot>>;
    try {
      observed = await snapshot(read, link);
      await read.done;
    } catch (error) {
      try {
        read.abort();
      } catch {
        /* Already committed or aborted. */
      }
      await read.done.catch(() => undefined);
      throw error;
    }
    const remote = await source.state(`book_${link.contentHash}`);
    await active(link);
    const base = observed.checkpoint?.base ?? {};
    if (remote.value === null && Object.keys(base).length && choice !== 'local') {
      status(id, {
        state: 'conflict',
        message:
          'The previously synced WebDAV file is missing. Local data was kept. Restore it explicitly; a missing file is not a reset.',
        conflicts: ['missing remote file'],
        missing: true
      });
      return;
    }
    const remoteRecords =
      remote.value === null ? {} : validateDavDocument(remote.value, bookKey).records;
    const result =
      remote.value === null
        ? { merged: observed.records, conflicts: [] }
        : mergeRecords(base, observed.records, remoteRecords);
    const conflicts = [
      ...new Set([
        ...result.conflicts,
        ...(observed.checkpoint?.conflicts ?? []).filter(
          (key) => !equal(observed.records[key], remoteRecords[key])
        )
      ])
    ];
    if (conflicts.length && !choice) {
      status(id, {
        state: 'conflict',
        message: `${conflicts.length} WebDAV field(s) changed in both places. Review before choosing a copy.`,
        conflicts
      });
      return;
    }
    for (const key of conflicts) {
      const selected = (choice === 'local' ? observed.records : remoteRecords)[key];
      if (selected === undefined) delete result.merged[key];
      else result.merged[key] = selected;
    }
    const document = documentFor(bookKey, result.merged);
    await active(link);
    if (remote.value === null || !equal(remoteRecords, document.records))
      await source.write(
        `book_${link.contentHash}`,
        document as unknown as Record<string, unknown>,
        remote.revision
      );
    await active(link);
    const tx = db.transaction(stores, 'readwrite');
    let lateConflicts: string[] = [];
    try {
      const current = await snapshot(tx, link);
      if (!equal(current.checkpoint, observed.checkpoint))
        throw new Error('Another tab completed a WebDAV sync. Refresh and retry.');
      const late = mergeRecords(observed.records, current.records, document.records);
      lateConflicts = late.conflicts;
      await apply(tx, link, current.records, late.merged, current.book.title);
      const checkpoint: ExternalSyncState = {
        id: stateId(link),
        bookId: link.bookId,
        sourceId: link.sourceId,
        root: link.root,
        accountId: link.davAccountId!,
        base: document.records,
        conflicts: lateConflicts
      };
      await tx.objectStore('readerExternalSync').put(checkpoint);
      guard(link);
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already committed or aborted. */
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
    database.bookmarksChanged$.next();
    database.dataListChanged$.next(undefined);
    status(
      id,
      lateConflicts.length
        ? {
            state: 'conflict',
            message:
              'Local edits arrived during sync. They were kept; review before the next upload.',
            conflicts: lateConflicts
          }
        : {
            state: 'synced',
            message:
              'Reading position, statistics, annotations and imported notes synced directly with WebDAV.'
          }
    );
  } catch (error) {
    status(id, {
      state: error instanceof DavError && error.code === 'conflict' ? 'conflict' : 'error',
      message: error instanceof Error ? error.message : 'WebDAV sync failed; local data was kept.'
    });
  }
}
export async function syncEnabledDavBooks() {
  if (readerIsOpen() || (typeof document !== 'undefined' && document.visibilityState === 'hidden'))
    return;
  const links = await (await integrationDB()).getAll('books');
  for (const link of links) {
    if (
      link.sourceId.startsWith('webdav-') &&
      link.syncEnabled &&
      link.davAccountId === currentScope() &&
      get(davSyncStatus)[link.id]?.state !== 'conflict'
    )
      await syncDavBook(link.id);
  }
}
