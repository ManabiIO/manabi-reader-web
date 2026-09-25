/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { get, writable } from 'svelte/store';
import { database } from '$lib/data/store';
import type {
  BooksDbBookData,
  BooksDbBookmarkData,
  BooksDbStatistic
} from '$lib/data/database/books-db/versions/books-db';
import type {
  PersonalConflict,
  PersonalKind,
  PersonalMutation
} from '$lib/data/database/books-db/versions/v8/books-db-v8';
import type {
  ReaderAnnotation,
  ReaderAnnotationMutation
} from '$lib/data/database/books-db/versions/v7/books-db-v7';
import { StorageDataType } from '$lib/data/storage/storage-types';
import { migrateLegacyStatistics } from '$lib/data/database/books-db/reader-statistics';
import { validCompletion } from '$lib/library/completion';
import { validateImportedAnnotation } from '$lib/reader-annotations';
import { isCompletedStatistics } from './completed-statistics.js';
import { account, currentUser, IntegrationError, request } from './client';
import { equal, exclusive } from './persistence';
import {
  matchesAcknowledgedFeed,
  mergePayload,
  mergeAnnotationPayload,
  wirePayload
} from './personal-merge';

type Payload = Record<string, unknown> | null;
interface RemoteRecord {
  kind: string;
  entity_id: string;
  book_key: string | null;
  revision: number;
  payload: Payload;
  deleted: boolean;
  sequence?: number;
}
interface Feed {
  items: RemoteRecord[];
  next_cursor: number;
  has_more: boolean;
}
type WireMutation = NonNullable<PersonalMutation['request']>;
const contentKey = /^content:[a-f0-9]{64}$/;
const annotationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayId = /\/day\/(\d{4}-\d{2}-\d{2})$/;
const fields = [
  'scrollX',
  'scrollY',
  'exploredCharCount',
  'lastBookmarkModified',
  'progress'
] as const;
const statFields = [
  'charactersRead',
  'readingTime',
  'minReadingSpeed',
  'altMinReadingSpeed',
  'lastReadingSpeed',
  'maxReadingSpeed',
  'lastStatisticModified',
  'completedBook',
  'completedData'
] as const;
export const personalSyncStatus = writable<{
  state: string;
  message: string;
  conflicts: PersonalConflict[];
}>({ state: 'idle', message: '', conflicts: [] });

function key(accountId: string, kind: PersonalKind, entityId: string) {
  return JSON.stringify([accountId, kind, entityId]);
}
function scoped(accountId: string) {
  if (currentUser()?.id !== accountId) throw new IntegrationError('account_changed', 409);
}
async function annotationOwner(annotationId: string, bookKey: string): Promise<string | undefined> {
  const db = await database.db;
  const scope = await db.get('readerAnnotationScope', annotationId);
  if (scope) return scope.accountId;
  const oldMutation = (await db.getAllFromIndex('readerAnnotationOutbox', 'bookKey', bookKey)).find(
    (entry) => entry.annotationId === annotationId && entry.accountId
  );
  if (oldMutation?.accountId) {
    await db.put('readerAnnotationScope', { annotationId, accountId: oldMutation.accountId });
    return oldMutation.accountId;
  }
  return undefined;
}
function payloadOf(value: Record<string, unknown>, keys: readonly string[]): Payload {
  const result: Record<string, unknown> = {};
  for (const field of keys) if (value[field] !== undefined) result[field] = value[field];
  return Object.keys(result).length ? wirePayload(result) : null;
}
function wire(
  id: string,
  kind: PersonalKind,
  entityId: string,
  bookKey: string,
  revision: number,
  value: Payload
): WireMutation {
  return {
    mutation_id: id,
    kind,
    entity_id: entityId,
    book_key: bookKey,
    base_revision: revision,
    operation: value === null ? 'delete' : 'put',
    payload: wirePayload(value)
  };
}
function supported(kind: string): kind is PersonalKind {
  return ['annotation', 'resume', 'completion', 'statistics'].includes(kind);
}
function validRemote(value: RemoteRecord): boolean {
  if (
    !value ||
    !['annotation', 'resume', 'completion', 'statistics'].includes(value.kind) ||
    typeof value.entity_id !== 'string' ||
    typeof value.book_key !== 'string' ||
    !contentKey.test(value.book_key) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.deleted !== 'boolean' ||
    (value.deleted
      ? value.payload !== null
      : !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload))
  )
    return false;
  if (value.deleted) return true;
  const payload = value.payload!;
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 320 * 1024) return false;
  if (value.kind === 'annotation') {
    if (!annotationId.test(value.entity_id)) return false;
    try {
      const annotation = validateImportedAnnotation(payload);
      return annotation.id === value.entity_id && annotation.bookKey === value.book_key;
    } catch {
      return false;
    }
  }
  if (value.kind === 'completion')
    return (
      value.entity_id === value.book_key &&
      validCompletion(payload.completion) &&
      Object.keys(payload).length === 1
    );
  if (value.kind === 'resume')
    return (
      value.entity_id === value.book_key &&
      Object.keys(payload).every((field) =>
        [...fields].includes(field as (typeof fields)[number])
      ) &&
      Object.entries(payload).every(([field, item]) =>
        field === 'progress'
          ? (typeof item === 'number' && Number.isFinite(item)) ||
            (typeof item === 'string' && /^\d+(?:\.\d+)?%?$/.test(item))
          : typeof item === 'number' && Number.isFinite(item)
      )
    );
  return (
    dayId.test(value.entity_id) &&
    value.entity_id.startsWith(`${value.book_key}/day/`) &&
    Object.keys(payload).every((field) =>
      [...statFields].includes(field as (typeof statFields)[number])
    ) &&
    statFields
      .filter((field) => !['completedBook', 'completedData'].includes(field))
      .every((field) => typeof payload[field] === 'number' && Number.isFinite(payload[field])) &&
    (payload.completedBook === undefined || payload.completedBook === 1) &&
    (payload.completedData === undefined ||
      isCompletedStatistics(payload.completedData, dayId.exec(value.entity_id)![1]))
  );
}
async function publish(
  accountId: string,
  state = 'synced',
  message = 'Personal reading data synced.'
) {
  if (currentUser()?.id !== accountId) return;
  const db = await database.db;
  const conflicts = await db.getAllFromIndex('readerPersonalConflict', 'accountId', accountId);
  const ambiguous = (await db.getAll('readerStatisticMigration')).filter(
    (entry) => entry.state !== 'assigned'
  ).length;
  const pending =
    (await db.getAllFromIndex('readerPersonalOutbox', 'accountId', accountId)).length +
    (await db.getAllFromIndex('readerAnnotationOutbox', 'accountId', accountId)).length;
  if (currentUser()?.id !== accountId) return;
  personalSyncStatus.set({
    state: conflicts.length
      ? 'conflict'
      : state === 'synced' && pending
        ? 'pending'
        : state === 'synced' && ambiguous
          ? 'legacy_statistics'
          : state,
    message: conflicts.length
      ? `${conflicts.length} reading sync conflict(s) need review.`
      : state === 'synced' && pending
        ? `${pending} local change(s) are queued for sync.`
        : state === 'synced' && ambiguous
          ? `${ambiguous} older same-title statistics record(s) remain on this device because their book could not be identified.`
          : message,
    conflicts
  });
}

async function localBooks(accountId: string): Promise<Map<string, BooksDbBookData[]>> {
  const db = await database.db;
  const map = new Map<string, BooksDbBookData[]>();
  const allBooks = await db.getAll('data');
  for (const book of allBooks) {
    if (!book.contentHash || !/^[a-f0-9]{64}$/i.test(book.contentHash)) continue;
    await migrateLegacyStatistics(db, book);
    scoped(accountId);
    const scopeTx = db.transaction('readerBookScope', 'readwrite');
    const owner = await scopeTx.store.get(book.id);
    if (!owner) await scopeTx.store.put({ bookId: book.id, accountId });
    await scopeTx.done;
    if (owner && owner.accountId !== accountId) continue;
    const bookKey = `content:${book.contentHash.toLowerCase()}`;
    map.set(bookKey, [...(map.get(bookKey) ?? []), book]);
  }
  return map;
}
async function readLocal(
  kind: PersonalKind,
  entityId: string,
  bookKey: string,
  books: Map<string, BooksDbBookData[]>
): Promise<Payload> {
  const db = await database.db;
  if (kind === 'annotation') {
    const annotation = await db.get('readerAnnotation', entityId);
    return annotation && !annotation.deletedAt
      ? wirePayload(annotation as unknown as Record<string, unknown>)
      : null;
  }
  const copies = books.get(bookKey) ?? [];
  if (!copies.length) return null;
  if (kind === 'statistics') {
    const day = dayId.exec(entityId)?.[1];
    if (!day) return null;
    const statistic = await db.get('readerStatistic', [bookKey, day]);
    return statistic
      ? payloadOf(statistic as unknown as Record<string, unknown>, statFields)
      : null;
  }
  const bookmarks = (await Promise.all(copies.map((book) => db.get('bookmark', book.id)))).filter(
    (value): value is BooksDbBookmarkData => !!value
  );
  return bookmarkPayload(bookmarks, kind);
}
function bookmarkPayload(bookmarks: BooksDbBookmarkData[], kind: PersonalKind): Payload {
  const bookmark = bookmarks.sort((a, b) =>
    kind === 'completion'
      ? (b.completion?.modifiedAt ?? 0) - (a.completion?.modifiedAt ?? 0)
      : b.lastBookmarkModified - a.lastBookmarkModified
  )[0];
  if (!bookmark) return null;
  return kind === 'completion'
    ? bookmark.completion
      ? { completion: bookmark.completion }
      : null
    : payloadOf(bookmark as unknown as Record<string, unknown>, fields);
}

async function applyLocal(
  kind: PersonalKind,
  entityId: string,
  bookKey: string,
  payload: Payload,
  books: Map<string, BooksDbBookData[]>,
  accountId: string,
  expected: Payload
) {
  scoped(accountId);
  const db = await database.db;
  if (kind === 'annotation') {
    const tx = db.transaction('readerAnnotation', 'readwrite');
    const before = await tx.store.get(entityId);
    const current =
      before && !before.deletedAt
        ? wirePayload(before as unknown as Record<string, unknown>)
        : null;
    if (!equal(current, expected)) {
      await tx.done;
      throw new IntegrationError('conflict', 409);
    }
    scoped(accountId);
    if (payload) await tx.store.put(payload as unknown as ReaderAnnotation);
    else if (before)
      await tx.store.put({
        ...before,
        deletedAt: new Date().toISOString(),
        revision: before.revision + 1
      });
    await tx.done;
    return;
  }
  const copies = books.get(bookKey) ?? [];
  if (!copies.length) return;
  if (kind === 'statistics') {
    const day = dayId.exec(entityId)?.[1];
    if (!day) return;
    const tx = db.transaction(['readerStatistic', 'lastModified'], 'readwrite');
    const before = await tx.objectStore('readerStatistic').get([bookKey, day]);
    const current = before
      ? payloadOf(before as unknown as Record<string, unknown>, statFields)
      : null;
    if (!equal(current, expected)) {
      await tx.done;
      throw new IntegrationError('conflict', 409);
    }
    scoped(accountId);
    if (payload)
      await tx.objectStore('readerStatistic').put({
        ...payload,
        bookKey,
        title: copies[0].title,
        dateKey: day
      } as BooksDbStatistic & { bookKey: string });
    else await tx.objectStore('readerStatistic').delete([bookKey, day]);
    await tx.objectStore('lastModified').put({
      title: bookKey,
      dataType: StorageDataType.STATISTICS,
      lastModifiedValue: Date.now()
    });
    await tx.done;
    database.dataListChanged$.next(undefined);
    return;
  }
  const tx = db.transaction('bookmark', 'readwrite');
  const observed = (await Promise.all(copies.map((book) => tx.store.get(book.id)))).filter(
    (value): value is BooksDbBookmarkData => !!value
  );
  if (!equal(bookmarkPayload(observed, kind), expected)) {
    await tx.done;
    throw new IntegrationError('conflict', 409);
  }
  scoped(accountId);
  for (const book of copies) {
    const old = await tx.store.get(book.id);
    const next: BooksDbBookmarkData = {
      ...(old ?? { dataId: book.id, progress: undefined, lastBookmarkModified: 0 }),
      dataId: book.id
    };
    if (kind === 'completion') {
      if (payload?.completion)
        next.completion = payload.completion as BooksDbBookmarkData['completion'];
      else delete next.completion;
    } else {
      for (const field of fields) delete (next as unknown as Record<string, unknown>)[field];
      Object.assign(next, payload ?? {});
    }
    await tx.store.put(next);
  }
  await tx.done;
  database.bookmarksChanged$.next();
}

async function acceptRemote(
  accountId: string,
  item: RemoteRecord,
  books: Map<string, BooksDbBookData[]>,
  cursor: number,
  generation?: string,
  absent = false,
  preserveMissing = false
) {
  if (
    !(absent && item.revision === 0 && item.deleted && item.payload === null
      ? validRemote({ ...item, revision: 1 })
      : validRemote(item)) ||
    !item.book_key ||
    !supported(item.kind)
  )
    throw new IntegrationError('invalid_response');
  scoped(accountId);
  const db = await database.db;
  const id = key(accountId, item.kind, item.entity_id);
  const baseline = await db.get('readerPersonalRecord', id);
  // A 412 response may have supplied a newer record before its feed rows arrive.
  // Older rows advance the cursor without rolling the local baseline backward.
  if (baseline && baseline.generation === generation && item.revision <= baseline.revision) {
    scoped(accountId);
    await db.put('readerSyncState', {
      ...(await db.get('readerSyncState', accountId)),
      accountId,
      cursor: String(cursor),
      modifiedAt: new Date().toISOString()
    });
    return;
  }
  const owner =
    item.kind === 'annotation' ? await annotationOwner(item.entity_id, item.book_key) : undefined;
  const foreign = owner && owner !== accountId;
  const local = foreign ? null : await readLocal(item.kind, item.entity_id, item.book_key, books);
  const remote = item.deleted ? null : item.payload;
  const readingPending =
    item.kind === 'annotation'
      ? []
      : (await db.getAllFromIndex('readerPersonalOutbox', 'accountId', accountId)).filter(
          (entry) => entry.kind === item.kind && entry.entityId === item.entity_id
        );
  const annotationPending =
    item.kind === 'annotation'
      ? (await db.getAllFromIndex('readerAnnotationOutbox', 'accountId', accountId)).filter(
          (entry) => entry.annotationId === item.entity_id
        )
      : [];
  const matchingReading = readingPending.find((entry) =>
    matchesAcknowledgedFeed(entry.request, item)
  );
  const matchingAnnotation = annotationPending.find((entry) =>
    matchesAcknowledgedFeed(entry.request, item)
  );
  const acknowledged = !!matchingReading || !!matchingAnnotation;
  const localTombstone =
    item.kind === 'annotation' &&
    !foreign &&
    !!(await db.get('readerAnnotation', item.entity_id))?.deletedAt;
  const result =
    absent && preserveMissing && local !== null
      ? { value: local, fields: ['remote_missing'] }
      : acknowledged
        ? { value: local, fields: [] as string[] }
        : localTombstone && remote
          ? { value: local, fields: ['deleted'] }
          : item.kind === 'annotation'
            ? mergeAnnotationPayload(
                baseline?.payload ?? null,
                local,
                remote,
                new Date().toISOString()
              )
            : mergePayload(baseline?.payload ?? null, local, remote);
  const conflict: PersonalConflict | undefined = result.fields.length
    ? {
        id,
        accountId,
        kind: item.kind,
        entityId: item.entity_id,
        bookKey: item.book_key,
        local,
        remote,
        remoteRevision: item.revision,
        fields: result.fields
      }
    : undefined;
  // Never apply a remote annotation over a pending local edit. Merge only after its
  // exact local revision is checked during the subsequent flush.
  if (!foreign && !conflict && !equal(local, result.value))
    await applyLocal(
      item.kind,
      item.entity_id,
      item.book_key,
      result.value,
      books,
      accountId,
      local
    );
  scoped(accountId);
  const tx = db.transaction(
    [
      'readerPersonalRecord',
      'readerPersonalConflict',
      'readerSyncState',
      'readerAnnotationScope',
      'readerPersonalOutbox',
      'readerAnnotationOutbox'
    ],
    'readwrite'
  );
  if (item.kind === 'annotation' && !owner && !foreign)
    await tx.objectStore('readerAnnotationScope').put({ annotationId: item.entity_id, accountId });
  await tx.objectStore('readerPersonalRecord').put({
    id,
    accountId,
    kind: item.kind,
    entityId: item.entity_id,
    bookKey: item.book_key,
    revision: item.revision,
    generation,
    payload: remote,
    deleted: item.deleted
  });
  if (conflict) await tx.objectStore('readerPersonalConflict').put(conflict);
  if (matchingReading) await tx.objectStore('readerPersonalOutbox').delete(matchingReading.id);
  if (matchingAnnotation)
    await tx.objectStore('readerAnnotationOutbox').delete(matchingAnnotation.id);
  await tx.objectStore('readerSyncState').put({
    ...(await tx.objectStore('readerSyncState').get(accountId)),
    accountId,
    cursor: String(cursor),
    modifiedAt: new Date().toISOString()
  });
  await tx.done;
}

type SyncEpoch = { generation: string; incarnation: string };
type SnapshotPage = SyncEpoch & {
  items: (RemoteRecord & { snapshot_id: number })[];
  high_water: number;
  has_more: boolean;
  next_cursor: string | null;
};
const uuidText = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function validEpoch(value: Partial<SyncEpoch>): value is SyncEpoch {
  return (
    typeof value.generation === 'string' &&
    uuidText.test(value.generation) &&
    typeof value.incarnation === 'string' &&
    uuidText.test(value.incarnation)
  );
}

async function recoverSnapshot(accountId: string, books: Map<string, BooksDbBookData[]>) {
  const db = await database.db;
  const previous = await db.get('readerSyncState', accountId);
  scoped(accountId);
  await db.put('readerSyncState', {
    ...previous,
    accountId,
    cursor: previous?.cursor ?? '0',
    resyncing: true,
    modifiedAt: new Date().toISOString()
  });
  let token = '',
    after = 0,
    highWater: number | undefined,
    epoch: SyncEpoch | undefined;
  // Current state is quota-bounded on the server. Pages are applied incrementally
  // rather than retaining every note body in memory. No upload is allowed until
  // the complete snapshot and the feed after its high-water mark are applied.
  for (let pages = 0; ; pages += 1) {
    if (pages >= 25000) throw new IntegrationError('invalid_response');
    scoped(accountId);
    const page = await request<SnapshotPage>(
      `personal/snapshot/?limit=100${token ? `&cursor=${encodeURIComponent(token)}` : ''}`,
      { userId: accountId }
    );
    if (
      !validEpoch(page) ||
      !Array.isArray(page.items) ||
      !Number.isSafeInteger(page.high_water) ||
      page.high_water < 0 ||
      typeof page.has_more !== 'boolean' ||
      (page.has_more &&
        (typeof page.next_cursor !== 'string' ||
          !page.next_cursor ||
          page.next_cursor.length > 2048 ||
          page.next_cursor === token)) ||
      (!page.has_more && page.next_cursor !== null) ||
      (epoch && (epoch.generation !== page.generation || epoch.incarnation !== page.incarnation)) ||
      (highWater !== undefined && highWater !== page.high_water)
    )
      throw new IntegrationError('invalid_response');
    if (previous?.incarnation && previous.incarnation !== page.incarnation)
      throw new IntegrationError('invalid_cursor'); // Account clock loss is not compaction.
    epoch = { generation: page.generation, incarnation: page.incarnation };
    highWater = page.high_water;
    for (const item of page.items) {
      if (!Number.isSafeInteger(item.snapshot_id) || item.snapshot_id <= after)
        throw new IntegrationError('invalid_response');
      if (supported(item.kind))
        await acceptRemote(accountId, item, books, Number(previous?.cursor ?? 0), epoch.generation);
      after = item.snapshot_id;
    }
    if (page.has_more && !page.items.length) throw new IntegrationError('invalid_response');
    if (!page.has_more) break;
    token = page.next_cursor!;
  }
  // A missing old baseline represents a compacted tombstone. Never silently
  // erase legacy data when this client has not yet learned a stable incarnation.
  for (const base of await db.getAllFromIndex('readerPersonalRecord', 'accountId', accountId)) {
    if (base.generation === epoch!.generation) continue;
    await acceptRemote(
      accountId,
      {
        kind: base.kind,
        entity_id: base.entityId,
        book_key: base.bookKey,
        revision: 0,
        payload: null,
        deleted: true
      },
      books,
      Number(previous?.cursor ?? 0),
      epoch!.generation,
      true,
      !previous?.incarnation
    );
  }
  scoped(accountId);
  const tx = db.transaction(
    ['readerPersonalOutbox', 'readerAnnotationOutbox', 'readerSyncState'],
    'readwrite'
  );
  // The actual local reading/annotation rows (including local tombstones) remain
  // authoritative intent. Obsolete immutable requests must never simply acquire
  // a new epoch: restaging uses the newly reconciled baseline and a new UUID.
  for (const storeName of ['readerPersonalOutbox', 'readerAnnotationOutbox'] as const) {
    const store = tx.objectStore(storeName);
    for (const entry of await store.index('accountId').getAll(accountId)) {
      if (entry.request?.sync?.generation !== epoch!.generation) await store.delete(entry.id);
    }
  }
  await tx.objectStore('readerSyncState').put({
    accountId,
    cursor: String(highWater),
    ...epoch!,
    resyncing: false,
    modifiedAt: new Date().toISOString()
  });
  await tx.done;
}

async function bootstrap(accountId: string, books: Map<string, BooksDbBookData[]>) {
  const db = await database.db;
  let state = await db.get('readerSyncState', accountId);
  let recovered = false;
  if (state?.resyncing) {
    await recoverSnapshot(accountId, books);
    state = await db.get('readerSyncState', accountId);
    recovered = true;
  }
  let cursor = Number(state?.cursor ?? '0');
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new IntegrationError('invalid_cursor');
  for (;;) {
    scoped(accountId);
    const epoch = state && validEpoch(state) ? state : undefined;
    const scope = epoch ? `&generation=${epoch.generation}&incarnation=${epoch.incarnation}` : '';
    let feed: Feed & Partial<SyncEpoch> & { maximum_page_bytes?: number };
    try {
      // Old servers did not have a byte budget; keep their small count limit.
      feed = await request(`personal/changes/?cursor=${cursor}&limit=3${scope}`, {
        userId: accountId
      });
    } catch (error) {
      if (!recovered && error instanceof IntegrationError && error.code === 'resync_required') {
        await recoverSnapshot(accountId, books);
        state = await db.get('readerSyncState', accountId);
        cursor = Number(state!.cursor);
        recovered = true;
        continue;
      }
      throw error;
    }
    if (
      !Array.isArray(feed.items) ||
      !Number.isSafeInteger(feed.next_cursor) ||
      feed.next_cursor < cursor ||
      typeof feed.has_more !== 'boolean' ||
      ((feed.generation !== undefined || feed.incarnation !== undefined) && !validEpoch(feed))
    )
      throw new IntegrationError('invalid_response');
    if (epoch && (feed.incarnation !== epoch.incarnation || feed.generation !== epoch.generation))
      throw new IntegrationError('invalid_cursor');
    for (const item of feed.items) {
      if (
        !Number.isSafeInteger(item.sequence) ||
        item.sequence! <= cursor ||
        item.sequence! > feed.next_cursor
      )
        throw new IntegrationError('invalid_response');
      if (supported(item.kind))
        await acceptRemote(accountId, item, books, item.sequence!, feed.generation);
      cursor = item.sequence!;
    }
    if (!feed.items.length && feed.has_more) throw new IntegrationError('invalid_response');
    scoped(accountId);
    state = {
      ...(await db.get('readerSyncState', accountId)),
      accountId,
      cursor: String(cursor),
      ...(validEpoch(feed) ? { generation: feed.generation, incarnation: feed.incarnation } : {}),
      modifiedAt: new Date().toISOString()
    };
    await db.put('readerSyncState', state);
    if (!feed.has_more) break;
  }
}

async function stageReading(accountId: string, books: Map<string, BooksDbBookData[]>) {
  const db = await database.db;
  for (const bookKey of books.keys()) {
    const stats = await db.getAll('readerStatistic', IDBKeyRange.bound([bookKey], [bookKey, []]));
    const known = (await db.getAllFromIndex('readerPersonalRecord', 'bookKey', bookKey)).filter(
      (record) => record.accountId === accountId && record.kind === 'statistics'
    );
    const entities: { kind: PersonalKind; entityId: string }[] = [
      { kind: 'resume', entityId: bookKey },
      { kind: 'completion', entityId: bookKey },
      ...Array.from(
        new Set([
          ...stats.map((stat) => `${bookKey}/day/${stat.dateKey}`),
          ...known.map((record) => record.entityId)
        ])
      ).map((entityId) => ({ kind: 'statistics' as const, entityId }))
    ];
    for (const entity of entities) {
      const id = key(accountId, entity.kind, entity.entityId);
      const base = await db.get('readerPersonalRecord', id);
      const local = await readLocal(entity.kind, entity.entityId, bookKey, books);
      if (equal(local, base?.payload ?? null) || (!local && !base)) continue;
      const tx = db.transaction(['readerPersonalOutbox', 'readerPersonalConflict'], 'readwrite');
      if (!(await tx.objectStore('readerPersonalConflict').get(id))) {
        const pending = (
          await tx.objectStore('readerPersonalOutbox').index('accountId').getAll(accountId)
        ).find((value) => value.kind === entity.kind && value.entityId === entity.entityId);
        if (!pending || !equal(pending.localValue, local)) {
          const mutation: PersonalMutation = {
            id: crypto.randomUUID(),
            accountId,
            kind: entity.kind as PersonalMutation['kind'],
            entityId: entity.entityId,
            bookKey,
            baseRevision: base?.revision ?? 0,
            localValue: local
          };
          await tx.objectStore('readerPersonalOutbox').put(mutation);
        }
      }
      await tx.done;
    }
  }
}

async function hydrateReading(accountId: string, books: Map<string, BooksDbBookData[]>) {
  const db = await database.db;
  const pending = await db.getAllFromIndex('readerPersonalOutbox', 'accountId', accountId);
  const unhydrated = new Set<string>();
  for (const [bookKey, copies] of books) {
    const scopes = await Promise.all(copies.map((book) => db.get('readerBookScope', book.id)));
    if (scopes.every((scope) => !scope?.hydrated)) unhydrated.add(bookKey);
  }
  for (const record of await db.getAllFromIndex('readerPersonalRecord', 'accountId', accountId)) {
    if (
      record.kind === 'annotation' ||
      !unhydrated.has(record.bookKey) ||
      !record.payload ||
      pending.some((entry) => entry.kind === record.kind && entry.entityId === record.entityId)
    )
      continue;
    const local = await readLocal(record.kind, record.entityId, record.bookKey, books);
    if (local === null)
      await applyLocal(
        record.kind,
        record.entityId,
        record.bookKey,
        record.payload,
        books,
        accountId,
        local
      );
  }
  scoped(accountId);
  const tx = db.transaction('readerBookScope', 'readwrite');
  for (const copies of books.values())
    for (const book of copies) {
      const scope = await tx.store.get(book.id);
      if (scope?.accountId === accountId && !scope.hydrated)
        await tx.store.put({ ...scope, hydrated: true });
    }
  await tx.done;
}

async function bindMutation(accountId: string, mutation: WireMutation): Promise<WireMutation> {
  const db = await database.db;
  const state = await db.get('readerSyncState', accountId);
  return state && validEpoch(state)
    ? { ...mutation, sync: { generation: state.generation, incarnation: state.incarnation } }
    : mutation;
}

async function sendMutation(accountId: string, mutation: WireMutation): Promise<RemoteRecord> {
  const { sync, ...value } = mutation;
  const reply = await request<{
    accepted: boolean;
    mutation_id: string;
    record: RemoteRecord;
    generation?: string;
    incarnation?: string;
  }>('personal/mutations/', { method: 'POST', value, userId: accountId, syncEpoch: sync });
  if (
    !reply.accepted ||
    reply.mutation_id !== mutation.mutation_id ||
    !validRemote(reply.record) ||
    (sync && (reply.generation !== sync.generation || reply.incarnation !== sync.incarnation))
  )
    throw new IntegrationError('invalid_response');
  return reply.record;
}

async function flushReading(accountId: string, books: Map<string, BooksDbBookData[]>) {
  const db = await database.db;
  const outbox = await db.getAllFromIndex('readerPersonalOutbox', 'accountId', accountId);
  for (const pending of outbox) {
    scoped(accountId);
    if (await db.get('readerPersonalConflict', key(accountId, pending.kind, pending.entityId)))
      continue;
    const current = await db.get('readerPersonalOutbox', pending.id);
    if (!current) continue;
    const baseline = await db.get(
      'readerPersonalRecord',
      key(accountId, current.kind, current.entityId)
    );
    const prepared =
      current.request ??
      (await bindMutation(
        accountId,
        wire(
          current.id,
          current.kind,
          current.entityId,
          current.bookKey,
          baseline?.revision ?? 0,
          current.localValue
        )
      ));
    if (!current.request) await db.put('readerPersonalOutbox', { ...current, request: prepared });
    let accepted: RemoteRecord;
    try {
      accepted = await sendMutation(accountId, prepared);
    } catch (error) {
      if (
        error instanceof IntegrationError &&
        error.code === 'revision_conflict' &&
        error.current &&
        validRemote(error.current as RemoteRecord)
      ) {
        await acceptRemote(
          accountId,
          error.current as RemoteRecord,
          books,
          Number((await db.get('readerSyncState', accountId))?.cursor ?? 0),
          prepared.sync?.generation
        );
        // The exact request is no longer valid; a fresh mutation needs a new ID.
        const latest = await db.get('readerPersonalOutbox', current.id);
        if (latest?.request?.mutation_id === prepared.mutation_id)
          await db.delete('readerPersonalOutbox', current.id);
        continue;
      }
      throw error;
    }
    scoped(accountId);
    const tx = db.transaction(['readerPersonalOutbox', 'readerPersonalRecord'], 'readwrite');
    const latest = await tx.objectStore('readerPersonalOutbox').get(current.id);
    if (latest?.request?.mutation_id === prepared.mutation_id)
      await tx.objectStore('readerPersonalOutbox').delete(current.id);
    await tx.objectStore('readerPersonalRecord').put({
      id: key(accountId, current.kind, current.entityId),
      accountId,
      kind: current.kind,
      entityId: current.entityId,
      bookKey: current.bookKey,
      revision: accepted.revision,
      generation: prepared.sync?.generation,
      payload: accepted.deleted ? null : accepted.payload,
      deleted: accepted.deleted
    });
    await tx.done;
    // A later local edit remains in IndexedDB and is staged on the next pass.
  }
}

async function stageAnnotations(accountId: string) {
  const db = await database.db;
  const pending = await db.getAllFromIndex('readerAnnotationOutbox', 'accountId', accountId);
  const pendingIds = new Set(pending.map((value) => value.annotationId));
  for (const annotation of await db.getAll('readerAnnotation')) {
    if (
      !contentKey.test(annotation.bookKey) ||
      !annotationId.test(annotation.id) ||
      pendingIds.has(annotation.id)
    )
      continue;
    const owner = await annotationOwner(annotation.id, annotation.bookKey);
    if (owner && owner !== accountId) continue;
    if (!owner) await db.put('readerAnnotationScope', { annotationId: annotation.id, accountId });
    const base = await db.get('readerPersonalRecord', key(accountId, 'annotation', annotation.id));
    const value = annotation.deletedAt
      ? null
      : wirePayload(annotation as unknown as Record<string, unknown>);
    if (equal(value, base?.payload ?? null)) continue;
    if (await db.get('readerPersonalConflict', key(accountId, 'annotation', annotation.id)))
      continue;
    await db.put('readerAnnotationOutbox', {
      id: crypto.randomUUID(),
      accountId,
      bookKey: annotation.bookKey,
      annotationId: annotation.id,
      baseRevision: base?.revision ?? 0,
      localRevision: annotation.revision,
      value: annotation,
      createdAt: new Date().toISOString()
    });
  }
}

async function flushAnnotations(accountId: string, books: Map<string, BooksDbBookData[]>) {
  const db = await database.db;
  for (const pending of await db.getAllFromIndex(
    'readerAnnotationOutbox',
    'accountId',
    accountId
  )) {
    scoped(accountId);
    if (!contentKey.test(pending.bookKey) || !annotationId.test(pending.annotationId)) continue;
    const id = key(accountId, 'annotation', pending.annotationId);
    if (await db.get('readerPersonalConflict', id)) continue;
    const current = (await db.get('readerAnnotationOutbox', pending.id)) as
      | (ReaderAnnotationMutation & { request?: WireMutation })
      | undefined;
    if (!current || current.accountId !== accountId) continue;
    const latestAnnotation = await db.get('readerAnnotation', current.annotationId);
    if (!current.request && latestAnnotation?.revision !== current.localRevision) {
      await db.delete('readerAnnotationOutbox', current.id);
      continue;
    }
    const baseline = await db.get('readerPersonalRecord', id);
    const prepared = current.request ?? {
      ...(await bindMutation(
        accountId,
        wire(
          current.id,
          'annotation',
          current.annotationId,
          current.bookKey,
          baseline?.revision ?? 0,
          current.value.deletedAt ? null : (current.value as unknown as Payload)
        )
      )),
      kind: 'annotation' as const
    };
    if (!current.request) await db.put('readerAnnotationOutbox', { ...current, request: prepared });
    let accepted: RemoteRecord;
    try {
      accepted = await sendMutation(accountId, prepared);
    } catch (error) {
      if (
        error instanceof IntegrationError &&
        error.code === 'revision_conflict' &&
        error.current &&
        validRemote(error.current as RemoteRecord)
      ) {
        await acceptRemote(
          accountId,
          error.current as RemoteRecord,
          books,
          Number((await db.get('readerSyncState', accountId))?.cursor ?? 0),
          prepared.sync?.generation
        );
        const latest = await db.get('readerAnnotationOutbox', current.id);
        if (latest && (latest as typeof current).request?.mutation_id === prepared.mutation_id)
          await db.delete('readerAnnotationOutbox', current.id);
        continue;
      }
      throw error;
    }
    scoped(accountId);
    const tx = db.transaction(['readerAnnotationOutbox', 'readerPersonalRecord'], 'readwrite');
    const latest = await tx.objectStore('readerAnnotationOutbox').get(current.id);
    if (latest && (latest as typeof current).request?.mutation_id === prepared.mutation_id)
      await tx.objectStore('readerAnnotationOutbox').delete(current.id);
    await tx.objectStore('readerPersonalRecord').put({
      id,
      accountId,
      kind: 'annotation',
      entityId: current.annotationId,
      bookKey: current.bookKey,
      revision: accepted.revision,
      generation: prepared.sync?.generation,
      payload: accepted.deleted ? null : accepted.payload,
      deleted: accepted.deleted
    });
    await tx.done;
  }
}

export async function syncPersonalState() {
  const accountId = currentUser()?.id;
  if (!accountId) return;
  await exclusive('personal-sync', async () => {
    try {
      scoped(accountId);
      personalSyncStatus.set({
        state: 'syncing',
        message: 'Syncing personal reading data…',
        conflicts: get(personalSyncStatus).conflicts
      });
      const books = await localBooks(accountId);
      await bootstrap(accountId, books); // Sign-in never uploads until every remote page was applied.
      await hydrateReading(accountId, books);
      await stageReading(accountId, books);
      await stageAnnotations(accountId);
      await flushReading(accountId, books);
      await flushAnnotations(accountId, books);
      await stageReading(accountId, books);
      await stageAnnotations(accountId);
      await publish(accountId);
    } catch (error) {
      if (currentUser()?.id !== accountId) return;
      await publish(
        accountId,
        error instanceof IntegrationError ? error.code : 'unavailable',
        error instanceof IntegrationError && error.code === 'invalid_cursor'
          ? 'Account reading history changed unexpectedly. Local reading data is safe; contact support before syncing again.'
          : error instanceof IntegrationError && error.code === 'storage_full'
            ? 'Account personal-data storage is full. Local edits are saved; delete synced data to free space before retrying.'
            : error instanceof Error
              ? error.message
              : 'Sync unavailable; local changes are saved.'
      );
    }
  });
}

export async function resolvePersonalConflict(id: string, choice: 'local' | 'remote') {
  const accountId = currentUser()?.id;
  if (!accountId) throw new IntegrationError('sign_in_required');
  await exclusive('personal-sync', async () => {
    const db = await database.db;
    const conflict = await db.get('readerPersonalConflict', id);
    if (!conflict || conflict.accountId !== accountId) throw new IntegrationError('not_found');
    const books = await localBooks(accountId);
    const latestLocal = await readLocal(conflict.kind, conflict.entityId, conflict.bookKey, books);
    if (!equal(latestLocal, conflict.local)) {
      scoped(accountId);
      await db.put('readerPersonalConflict', { ...conflict, local: latestLocal });
      await publish(accountId);
      throw new IntegrationError('conflict', 409);
    }
    if (choice === 'remote')
      await applyLocal(
        conflict.kind,
        conflict.entityId,
        conflict.bookKey,
        conflict.remote,
        books,
        accountId,
        latestLocal
      );
    scoped(accountId);
    const tx = db.transaction(
      ['readerPersonalConflict', 'readerPersonalOutbox', 'readerAnnotationOutbox'],
      'readwrite'
    );
    await tx.objectStore('readerPersonalConflict').delete(id);
    for (const entry of await tx
      .objectStore('readerPersonalOutbox')
      .index('accountId')
      .getAll(accountId))
      if (entry.kind === conflict.kind && entry.entityId === conflict.entityId)
        await tx.objectStore('readerPersonalOutbox').delete(entry.id);
    for (const entry of await tx
      .objectStore('readerAnnotationOutbox')
      .index('accountId')
      .getAll(accountId))
      if (conflict.kind === 'annotation' && entry.annotationId === conflict.entityId)
        await tx.objectStore('readerAnnotationOutbox').delete(entry.id);
    await tx.done;
    if (choice === 'local') {
      if (conflict.kind === 'annotation') {
        const annotation = await db.get('readerAnnotation', conflict.entityId);
        if (annotation)
          await db.put('readerAnnotationOutbox', {
            id: crypto.randomUUID(),
            accountId,
            bookKey: conflict.bookKey,
            annotationId: conflict.entityId,
            baseRevision: conflict.remoteRevision,
            localRevision: annotation.revision,
            value: annotation,
            createdAt: new Date().toISOString()
          });
      }
    }
  });
  await syncPersonalState();
}

export function startPersonalSync() {
  let stopped = false;
  let lastAccountId: string | null = null;
  let running = false,
    rerun = false;
  const run = () => {
    if (stopped || !currentUser()) return;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    void syncPersonalState()
      .catch(() => undefined)
      .finally(() => {
        running = false;
        if (rerun) {
          rerun = false;
          run();
        }
      });
  };
  const timer = setInterval(run, 30_000);
  const unsubscribe = account.subscribe(() => {
    const accountId = currentUser()?.id ?? null;
    if (accountId !== lastAccountId) {
      personalSyncStatus.set({
        state: 'idle',
        message: accountId
          ? 'Checking personal reading data…'
          : 'Sign in to sync personal reading data.',
        conflicts: []
      });
      lastAccountId = accountId;
    }
    if (accountId) run();
  });
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', run);
  run();
  return () => {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', run);
  };
}
