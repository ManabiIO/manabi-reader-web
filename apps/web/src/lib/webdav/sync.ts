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
import { captureLibraryOperation } from '$lib/manabi/operation-scope';
import { commitTransaction } from '$lib/data/database/books-db/commit-transaction.mjs';
import { unlocatedImportRecord } from '$lib/manabi/imported-notes';
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
type Operation = ReturnType<typeof captureLibraryOperation>;

// No network/other-database awaits inside this boundary. Revocation rolls back
// pending writes; a successful request is not acknowledgement of a commit.
async function scopedTransaction<T>(
  tx: { done: Promise<unknown>; abort(): void },
  operation: Operation,
  work: () => Promise<T>
): Promise<T> {
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  operation.signal.addEventListener('abort', abort, { once: true });
  try {
    return await commitTransaction(tx, async () => {
      operation.assertCurrent();
      const result = await work();
      operation.assertCurrent();
      return result;
    });
  } finally {
    operation.signal.removeEventListener('abort', abort);
  }
}

function assertBook(
  link: BookLink,
  book: BooksDb['data']['value'] | undefined,
  scope: BooksDb['readerBookScope']['value'] | undefined
): asserts book is BooksDb['data']['value'] {
  if (
    !book ||
    book.id !== link.bookId ||
    !/^[a-f0-9]{64}$/.test(link.contentHash) ||
    book.contentHash?.toLowerCase() !== link.contentHash ||
    (book.libraryOwner !== undefined && book.libraryOwner !== link.davAccountId) ||
    (scope && scope.accountId !== link.davAccountId)
  )
    throw new Error('This WebDAV book is unavailable in the active account.');
}

async function readBook(tx: Tx, link: BookLink) {
  const book = await tx.objectStore('data').get(link.bookId);
  const scope = await tx.objectStore('readerBookScope').get(link.bookId);
  assertBook(link, book, scope);
  // Statistics and legacy unscoped annotations use content keys, not numeric
  // book IDs. A foreign same-byte copy makes those shared records unsafe to
  // export, even when the particular physical link belongs to this account.
  for (
    let cursor = await tx.objectStore('data').openCursor();
    cursor;
    cursor = await cursor.continue()
  ) {
    const copy = cursor.value;
    if (copy.id === book.id || copy.contentHash?.toLowerCase() !== link.contentHash) continue;
    const owner = await tx.objectStore('readerBookScope').get(copy.id);
    if (
      (copy.libraryOwner !== undefined && copy.libraryOwner !== link.davAccountId) ||
      (owner && owner.accountId !== link.davAccountId)
    )
      throw new Error(
        'These book copies have conflicting account ownership. WebDAV sync is paused.'
      );
  }
  return book;
}
function status(id: string, value: DavSyncStatus) {
  davSyncStatus.update((map) => ({ ...map, [id]: value }));
}
export function readerIsOpen() {
  return typeof window !== 'undefined' && /\/b\/?$/.test(window.location.pathname);
}
function guard(link: BookLink, operation: Operation) {
  operation.assertCurrent();
  if (link.davAccountId === undefined || link.davAccountId !== operation.profileId)
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
async function active(link: BookLink, operation: Operation) {
  guard(link, operation);
  const now = await (await integrationDB()).get('books', link.id);
  if (!now || !now.syncEnabled || !equal(now, link))
    throw new Error('This WebDAV sync was disabled or its book changed.');
  guard(link, operation);
}
async function snapshot(tx: Tx, link: BookLink, operation: Operation) {
  guard(link, operation);
  const book = await readBook(tx, link);
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
  guard(link, operation);
  return { book, records: documentFor(bookKey, wireCopy(records)).records, checkpoint };
}
async function apply(
  tx: Tx,
  link: BookLink,
  here: Record<string, unknown>,
  next: Record<string, unknown>,
  title: string,
  operation: Operation
) {
  const bookKey = `content:${link.contentHash}`,
    time = new Date().toISOString();
  for (const key of new Set([...Object.keys(here), ...Object.keys(next)])) {
    if (equal(here[key], next[key])) continue;
    guard(link, operation);
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
  // Imported evidence and its annotation can arrive in either JSON key order.
  // Resolve links only after applying the complete merged document, in the
  // same transaction. This also repairs previously received orphan evidence.
  for (const row of await tx.objectStore('readerImportRecord').index('bookKey').getAll(bookKey)) {
    if (
      row.status !== 'anchored' ||
      (row.accountId !== null && row.accountId !== link.davAccountId)
    )
      continue;
    const annotation = row.annotationId
      ? await tx.objectStore('readerAnnotation').get(row.annotationId)
      : undefined;
    const owner = row.annotationId
      ? await tx.objectStore('readerAnnotationScope').get(row.annotationId)
      : undefined;
    if (
      !annotation ||
      annotation.bookKey !== bookKey ||
      (owner && owner.accountId !== link.davAccountId)
    )
      await tx.objectStore('readerImportRecord').put(unlocatedImportRecord(row));
  }
}
export async function setDavBookSync(id: string, enabled: boolean) {
  const operation = captureLibraryOperation(currentUser()?.id ?? null);
  try {
    const db = await integrationDB(),
      link = await db.get('books', id);
    operation.assertCurrent();
    if (!link || link.owner !== null || !link.sourceId.startsWith('webdav-'))
      throw new Error('WebDAV book not found.');
    return await withDavSourceLock(
      link.sourceId,
      async () => {
        operation.assertCurrent();
        const source = await davSource(link.sourceId);
        checkSourceRoot(link, source.root);
        if (enabled) {
          const books = await database.db;
          const read = books.transaction(stores, 'readwrite');
          await scopedTransaction(read, operation, () =>
            readBook(read, { ...link, davAccountId: operation.profileId })
          );
          if (!source.configuration.writable)
            throw new Error('Allow reading-data write-back in the WebDAV connection first.');
        }
        operation.assertCurrent();
        // Revocation remains possible for a stale/removed book. Enabling requires
        // live content/ownership; every actual sync validates them again.
        const tx = db.transaction(['books', 'metadata'], 'readwrite');
        await scopedTransaction(tx, operation, async () => {
          const latest = await tx.objectStore('books').get(id);
          const configuration = await tx
            .objectStore('metadata')
            .get(`webdav-source:${link.sourceId}`);
          if (!equal(latest, link) || !equal(configuration, source.configuration))
            throw new Error('The account or WebDAV book changed. Review its sync choice again.');
          operation.assertCurrent();
          await tx.objectStore('books').put({
            ...link,
            syncEnabled: enabled,
            davAccountId: operation.profileId
          });
        });
        status(id, {
          state: enabled ? 'idle' : 'off',
          message: enabled
            ? 'WebDAV reading sync enabled for this account session.'
            : 'WebDAV reading sync is off.'
        });
      },
      operation.signal
    );
  } finally {
    operation.stop();
  }
}
/** Three-way field merge. A remote acceptance and local edits are reconciled in one local transaction. */
export async function syncDavBook(id: string, choice?: 'local' | 'remote') {
  const operation = captureLibraryOperation(currentUser()?.id ?? null);
  try {
    // Pin the link before waiting on either lock. Do not reread a replacement
    // link under a lock acquired for a different source or reading history.
    const link = await (await integrationDB()).get('books', id);
    operation.assertCurrent();
    if (!link || !link.syncEnabled) {
      status(id, { state: 'off', message: 'Enable WebDAV reading sync for this book first.' });
      return;
    }
    if (link.owner !== null || !link.sourceId.startsWith('webdav-'))
      throw new Error('WebDAV book not found.');
    await exclusive(
      `webdav-sync:${id}`,
      () =>
        withDavSourceLock(
          link.sourceId,
          () => {
            guard(link, operation);
            return withWebDavApplyLease(() => performDavSync(link, operation, choice));
          },
          operation.signal
        ),
      operation.signal
    );
  } catch (error) {
    status(id, {
      state: error instanceof DavError && error.code === 'conflict' ? 'conflict' : 'error',
      message: error instanceof Error ? error.message : 'WebDAV sync failed; local data was kept.'
    });
  } finally {
    operation.stop();
  }
}
async function performDavSync(link: BookLink, operation: Operation, choice?: 'local' | 'remote') {
  const id = link.id;
  await active(link, operation);
  status(id, { state: 'syncing', message: 'Syncing directly with WebDAV…' });
  const source = await davSource(link.sourceId),
    db = await database.db,
    bookKey = `content:${link.contentHash}`;
  checkSourceRoot(link, source.root);
  const preflight = db.transaction(stores, 'readwrite');
  const book = await scopedTransaction(preflight, operation, () => readBook(preflight, link));
  await migrateLegacyStatistics(db, book, {
    assertCurrent: operation.assertCurrent,
    signal: operation.signal,
    validate: (current, owner) => assertBook(link, current, owner),
    validateCopy: (copy, owner) => assertBook({ ...link, bookId: copy.id }, copy, owner)
  });
  await active(link, operation);
  const read = db.transaction(stores, 'readwrite');
  const observed = await scopedTransaction(read, operation, () => snapshot(read, link, operation));
  const remote = await source.state(`book_${link.contentHash}`);
  await active(link, operation);
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
  await active(link, operation);
  // Ownership/content can change while the remote GET is in flight. Recheck
  // before sending any locally captured personal data to the server.
  const authorize = db.transaction(stores, 'readwrite');
  await scopedTransaction(authorize, operation, () => readBook(authorize, link));
  guard(link, operation);
  if (remote.value === null || !equal(remoteRecords, document.records))
    await source.write(
      `book_${link.contentHash}`,
      document as unknown as Record<string, unknown>,
      remote.revision
    );
  await active(link, operation);
  const tx = db.transaction(stores, 'readwrite');
  const lateConflicts = await scopedTransaction(tx, operation, async () => {
    const current = await snapshot(tx, link, operation);
    if (!equal(current.checkpoint, observed.checkpoint))
      throw new Error('Another tab completed a WebDAV sync. Refresh and retry.');
    const late = mergeRecords(observed.records, current.records, document.records);
    await apply(tx, link, current.records, late.merged, current.book.title, operation);
    const checkpoint: ExternalSyncState = {
      id: stateId(link),
      bookId: link.bookId,
      sourceId: link.sourceId,
      root: link.root,
      accountId: link.davAccountId!,
      base: document.records,
      conflicts: late.conflicts
    };
    await tx.objectStore('readerExternalSync').put(checkpoint);
    guard(link, operation);
    return late.conflicts;
  });
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
}
export async function syncEnabledDavBooks() {
  if (readerIsOpen() || (typeof document !== 'undefined' && document.visibilityState === 'hidden'))
    return;
  const operation = captureLibraryOperation(currentUser()?.id ?? null);
  try {
    const links = await (await integrationDB()).getAll('books');
    for (const link of links) {
      // A batch must not switch accounts halfway through its saved link list.
      operation.assertCurrent();
      if (
        link.sourceId.startsWith('webdav-') &&
        link.syncEnabled &&
        link.davAccountId === operation.profileId &&
        get(davSyncStatus)[link.id]?.state !== 'conflict'
      )
        await syncDavBook(link.id);
    }
  } finally {
    operation.stop();
  }
}
