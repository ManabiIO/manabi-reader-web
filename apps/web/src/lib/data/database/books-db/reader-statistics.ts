/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase } from 'idb';
import type BooksDb from './versions/books-db';
import { commitTransaction } from './commit-transaction.mjs';
import type {
  BooksDbBookData,
  BooksDbContentStatistic,
  BooksDbStatistic
} from './versions/books-db';

type StatisticBook = Pick<BooksDbBookData, 'id' | 'title' | 'contentHash'>;

const digest = /^[a-f0-9]{64}$/i;

export function contentStatisticKey(book: StatisticBook): string | undefined {
  return digest.test(book.contentHash ?? '')
    ? `content:${book.contentHash!.toLowerCase()}`
    : undefined;
}

export function statisticRange(bookKey: string): IDBKeyRange {
  return IDBKeyRange.bound([bookKey], [bookKey, []]);
}

/** Keep a delayed tracker snapshot from undoing a later Complete Book write. */
export function preserveCompletedStatistic(
  existing: BooksDbContentStatistic | undefined,
  incoming: BooksDbContentStatistic,
  movesCompletion: boolean
): BooksDbContentStatistic {
  // This also prevents a captured old completion flag from reappearing after
  // the user moved the finish date to another day.
  if (existing && existing.lastStatisticModified > incoming.lastStatisticModified) return existing;
  if (!existing?.completedBook || incoming.completedBook || movesCompletion) return incoming;
  if (existing.lastStatisticModified >= incoming.lastStatisticModified) return existing;
  return {
    ...incoming,
    completedBook: 1,
    completedData: existing.completedData
  };
}

function sameDay(left: BooksDbStatistic, right: BooksDbStatistic): boolean {
  const sameValue = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) || Array.isArray(b))
      return (
        Array.isArray(a) &&
        Array.isArray(b) &&
        a.length === b.length &&
        a.every((value, index) => sameValue(value, b[index]))
      );
    const aa = a as Record<string, unknown>,
      bb = b as Record<string, unknown>;
    return (
      Object.keys(aa).length === Object.keys(bb).length &&
      Object.keys(aa).every((key) => Object.hasOwn(bb, key) && sameValue(aa[key], bb[key]))
    );
  };
  const fields = new Set([...Object.keys(left), ...Object.keys(right)]);
  fields.delete('title');
  fields.delete('bookKey');
  return [...fields].every((field) =>
    sameValue(
      (left as unknown as Record<string, unknown>)[field],
      (right as unknown as Record<string, unknown>)[field]
    )
  );
}

/** Optional authority retained by a caller across asynchronous sync preparation.
 * Validation runs against live records inside the migration transaction. */
export interface StatisticsMigrationGuard {
  assertCurrent(): void;
  signal: AbortSignal;
  validate(
    book: BooksDb['data']['value'] | undefined,
    owner: BooksDb['readerBookScope']['value'] | undefined
  ): void;
  validateCopy?(
    book: BooksDb['data']['value'],
    owner: BooksDb['readerBookScope']['value'] | undefined
  ): void;
}

/**
 * Assign an inherited title-keyed row only when every currently known copy
 * under that title has the same verified content identity. Once a title was
 * ambiguous, removing one copy cannot retroactively prove ownership.
 */
export async function migrateLegacyStatistics(
  db: IDBPDatabase<BooksDb>,
  book: StatisticBook,
  guard?: StatisticsMigrationGuard
): Promise<string> {
  book = { id: book.id, title: book.title, contentHash: book.contentHash };
  guard?.assertCurrent();
  guard?.signal.throwIfAborted();
  const tx = db.transaction(
    [
      'data',
      'statistic',
      'readerStatistic',
      'readerStatisticMigration',
      'readerLocalIdentity',
      ...(guard ? (['readerBookScope'] as const) : [])
    ],
    'readwrite'
  );
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  guard?.signal.addEventListener('abort', abort, { once: true });
  try {
    return await commitTransaction(tx, async () => {
      guard?.assertCurrent();
      if (guard) {
        const current = await tx.objectStore('data').get(book.id);
        const owner = await tx.objectStore('readerBookScope').get(book.id);
        guard.assertCurrent();
        guard.validate(current, owner);
        if (!current) throw new Error('The statistics book no longer exists.');
        // Use the current title too, not a pre-network/pre-lock snapshot.
        book = current;
        if (guard.validateCopy) {
          const contentKey = contentStatisticKey(book);
          for (
            let cursor = await tx.objectStore('data').openCursor();
            cursor;
            cursor = await cursor.continue()
          ) {
            if (!contentKey || contentStatisticKey(cursor.value) !== contentKey) continue;
            const copyOwner = await tx.objectStore('readerBookScope').get(cursor.value.id);
            guard.assertCurrent();
            guard.validateCopy(cursor.value, copyOwner);
          }
        }
      }
      const migrate = async () => {
        const identity = tx.objectStore('readerLocalIdentity');
        const keyFor = async (copy: StatisticBook) => {
          const contentKey = contentStatisticKey(copy);
          if (contentKey) return contentKey;
          let local = await identity.get(copy.id);
          if (!local) {
            local = { bookId: copy.id, uuid: crypto.randomUUID() };
            await identity.put(local);
          }
          return `local:${local.uuid}`;
        };
        const bookKey = await keyFor(book);
        const migration = tx.objectStore('readerStatisticMigration');
        const priorLocal = contentStatisticKey(book) ? await identity.get(book.id) : undefined;
        if (priorLocal) {
          const localKey = `local:${priorLocal.uuid}`;
          const content = tx.objectStore('readerStatistic');
          const localRows = await content.getAll(statisticRange(localKey));
          const existing = await Promise.all(
            localRows.map((row) => content.get([bookKey, row.dateKey]))
          );
          if (localRows.some((row, index) => existing[index] && !sameDay(row, existing[index]!))) {
            const previous = await migration.get(book.title);
            await migration.put({
              title: book.title,
              state: 'identity-conflict',
              bookKey: localKey,
              legacyAssigned:
                previous?.state === 'assigned' ||
                (previous?.state === 'identity-conflict' && previous.legacyAssigned === true)
            });
            return bookKey;
          }
          for (const row of localRows) {
            if (!(await content.get([bookKey, row.dateKey])))
              await content.put({ ...row, bookKey });
            await content.delete([localKey, row.dateKey]);
          }
          const receipt = await migration.get(book.title);
          if (receipt?.state === 'assigned' && receipt.bookKey === localKey)
            await migration.put({ title: book.title, state: 'assigned', bookKey });
        }
        if (!(await migration.get(book.title))) {
          const legacy = await tx
            .objectStore('statistic')
            .getAll(IDBKeyRange.bound([book.title], [book.title, []]));
          if (legacy.length) {
            const copies = await tx.objectStore('data').index('title').getAll(book.title);
            const identities = new Set(await Promise.all(copies.map(keyFor)));
            if (identities.size !== 1 || !identities.has(bookKey)) {
              await migration.put({ title: book.title, state: 'ambiguous' });
            } else {
              const content = tx.objectStore('readerStatistic');
              // A renamed copy can have a second legacy title with the same day.
              // Do not hide either title's history if their values disagree.
              const existing = await Promise.all(
                legacy.map((row) => content.get([bookKey, row.dateKey]))
              );
              if (legacy.some((row, index) => existing[index] && !sameDay(row, existing[index]!))) {
                await migration.put({ title: book.title, state: 'ambiguous' });
                return bookKey;
              }
              for (const row of legacy) {
                const existing = await content.get([bookKey, row.dateKey]);
                if (!existing)
                  await content.put({ ...row, bookKey } satisfies BooksDbContentStatistic);
              }
              await migration.put({ title: book.title, state: 'assigned', bookKey });
            }
          }
        }
        return bookKey;
      };
      const result = await migrate();
      guard?.assertCurrent();
      guard?.signal.throwIfAborted();
      return result;
    });
  } finally {
    guard?.signal.removeEventListener('abort', abort);
  }
}

/** Legacy rows with an assignment receipt are represented by readerStatistic. */
export async function visibleStatistics(db: IDBPDatabase<BooksDb>): Promise<BooksDbStatistic[]> {
  const [content, legacy, migrations] = await Promise.all([
    db.getAllFromIndex('readerStatistic', 'dateKey'),
    db.getAllFromIndex('statistic', 'dateKey'),
    db.getAll('readerStatisticMigration')
  ]);
  const assigned = new Set(
    migrations
      .filter(
        (entry) =>
          entry.state === 'assigned' ||
          (entry.state === 'identity-conflict' && entry.legacyAssigned)
      )
      .map((entry) => entry.title)
  );
  return [...content, ...legacy.filter((row) => !assigned.has(row.title))];
}

export interface StatisticIdentityPlan {
  title: string;
  bookKey: string;
  keys: string[];
  legacyTitle?: string;
  unresolvedLegacy: boolean;
}

function statisticLegacyAssignment(
  receipt: BooksDb['readerStatisticMigration']['value'] | undefined,
  title: string,
  keys: ReadonlySet<string>
): { legacyTitle?: string; unresolvedLegacy: boolean } {
  if (!receipt) return { unresolvedLegacy: false };
  if (receipt.state === 'ambiguous') return { unresolvedLegacy: true };
  if (!receipt.bookKey || !keys.has(receipt.bookKey)) return { unresolvedLegacy: true };
  if (receipt.state === 'assigned') return { legacyTitle: title, unresolvedLegacy: false };
  return receipt.legacyAssigned === true
    ? { legacyTitle: title, unresolvedLegacy: false }
    : { unresolvedLegacy: true };
}

/** Resolve every statistics identity owned by one browser book for selection or deletion.
 * The primary key follows the current verified content identity. A retained
 * pre-hash local key may still hold conflicting rows and therefore belongs to
 * the same selected book. Title-only legacy rows are never guessed when their
 * migration receipt remains ambiguous.
 */
export async function statisticIdentityPlan(
  db: IDBPDatabase<BooksDb>,
  bookId: number,
  guard?: StatisticsMigrationGuard
): Promise<StatisticIdentityPlan> {
  guard?.assertCurrent();
  guard?.signal.throwIfAborted();
  if (!Number.isSafeInteger(bookId) || bookId <= 0)
    throw new Error('The selected statistics book is invalid.');
  const book = await db.get('data', bookId);
  guard?.assertCurrent();
  guard?.signal.throwIfAborted();
  if (!book) throw new Error('The selected statistics book no longer exists.');
  const snapshot = { id: book.id, title: book.title, contentHash: book.contentHash };
  const migrationGuard = guard
    ? {
        ...guard,
        validate(current: BooksDb['data']['value'] | undefined, owner: BooksDb['readerBookScope']['value'] | undefined) {
          guard.validate(current, owner);
          if (
            current &&
            (current.title !== snapshot.title || current.contentHash !== snapshot.contentHash)
          )
            throw new Error(
              'The selected statistics book changed. Refresh the Library and try again.'
            );
        }
      }
    : undefined;
  const bookKey = await migrateLegacyStatistics(db, snapshot, migrationGuard);
  const [current, local, receipt, owner] = await Promise.all([
    db.get('data', bookId),
    db.get('readerLocalIdentity', bookId),
    db.get('readerStatisticMigration', snapshot.title),
    guard ? db.get('readerBookScope', bookId) : Promise.resolve(undefined)
  ]);
  guard?.assertCurrent();
  guard?.signal.throwIfAborted();
  guard?.validate(current, owner);
  if (
    !current ||
    current.title !== snapshot.title ||
    current.contentHash !== snapshot.contentHash
  )
    throw new Error('The selected statistics book changed. Refresh the Library and try again.');
  const keys = new Set([bookKey]);
  if (local) keys.add(`local:${local.uuid}`);
  const legacy = statisticLegacyAssignment(receipt, snapshot.title, keys);
  return {
    title: snapshot.title,
    bookKey,
    keys: [...keys],
    ...legacy
  };
}

/** Delete exactly the histories represented by a previously resolved plan.
 * Revalidate both persistent ownership and identity in the same transaction as
 * the delete so a stale Library selection cannot erase another account/history.
 */
export async function deleteStatisticsForIdentityPlan(
  db: IDBPDatabase<BooksDb>,
  bookId: number,
  expected: StatisticIdentityPlan,
  guard?: StatisticsMigrationGuard
): Promise<void> {
  guard?.assertCurrent();
  guard?.signal.throwIfAborted();
  if (!Number.isSafeInteger(bookId) || bookId <= 0)
    throw new Error('The selected statistics book is invalid.');
  if (expected.unresolvedLegacy)
    throw new Error(
      `Older statistics for “${expected.title}” cannot be safely assigned to this copy.`
    );
  const stores = [
    'data',
    'statistic',
    'readerStatistic',
    'readerStatisticMigration',
    'readerLocalIdentity',
    'lastModified',
    ...(guard ? (['readerBookScope'] as const) : [])
  ] as const;
  const tx = db.transaction(stores, 'readwrite');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  guard?.signal.addEventListener('abort', abort, { once: true });
  try {
    await commitTransaction(tx, async () => {
      guard?.assertCurrent();
      guard?.signal.throwIfAborted();
      const book = await tx.objectStore('data').get(bookId);
      const owner = guard ? await tx.objectStore('readerBookScope').get(bookId) : undefined;
      guard?.assertCurrent();
      guard?.validate(book, owner);
      if (
        !book ||
        book.title !== expected.title
      )
        throw new Error('The selected statistics book changed. Refresh the Library and try again.');

      const local = await tx.objectStore('readerLocalIdentity').get(bookId);
      const bookKey = contentStatisticKey(book) ?? (local ? `local:${local.uuid}` : undefined);
      if (!bookKey || bookKey !== expected.bookKey)
        throw new Error('The selected statistics identity changed. Refresh the Library and try again.');
      const keys = new Set([bookKey]);
      if (local) keys.add(`local:${local.uuid}`);
      const expectedKeys = new Set(expected.keys);
      if (
        keys.size !== expectedKeys.size ||
        [...keys].some((key) => !expectedKeys.has(key))
      )
        throw new Error('The selected statistics identity changed. Refresh the Library and try again.');

      const receipt = await tx.objectStore('readerStatisticMigration').get(book.title);
      const legacy = statisticLegacyAssignment(receipt, book.title, keys);
      if (
        legacy.unresolvedLegacy ||
        legacy.legacyTitle !== expected.legacyTitle
      )
        throw new Error('The selected statistics history changed. Refresh the Library and try again.');

      if (guard?.validateCopy) {
        const contentKey = contentStatisticKey(book);
        if (contentKey) {
          for (
            let cursor = await tx.objectStore('data').openCursor();
            cursor;
            cursor = await cursor.continue()
          ) {
            if (contentStatisticKey(cursor.value) !== contentKey) continue;
            const copyOwner = await tx.objectStore('readerBookScope').get(cursor.value.id);
            guard.assertCurrent();
            guard.validateCopy(cursor.value, copyOwner);
          }
        }
      }

      const modifiedAt = Date.now();
      const lastModified = tx.objectStore('lastModified');
      const content = tx.objectStore('readerStatistic');
      for (const key of keys) {
        guard?.assertCurrent();
        guard?.signal.throwIfAborted();
        const range = statisticRange(key);
        if ((await content.getKey(range)) === undefined) continue;
        await content.delete(range);
        await lastModified.put({
          title: key,
          dataType: 'statistic',
          lastModifiedValue: modifiedAt
        });
      }
      if (legacy.legacyTitle) {
        const title = legacy.legacyTitle;
        const range = IDBKeyRange.bound([title], [title, []]);
        const legacyStore = tx.objectStore('statistic');
        if ((await legacyStore.getKey(range)) !== undefined) {
          await legacyStore.delete(range);
          await lastModified.put({
            title,
            dataType: 'statistic',
            lastModifiedValue: modifiedAt
          });
        }
      }
      guard?.assertCurrent();
      guard?.signal.throwIfAborted();
    });
  } finally {
    guard?.signal.removeEventListener('abort', abort);
  }
}

/** A TTU statistics ZIP has only title keys, so it cannot represent this case. */
export function titlesWithMultipleStatisticIdentities(
  rows: readonly (BooksDbStatistic | BooksDbContentStatistic)[]
): string[] {
  const identities = new Map<string, Set<string>>();
  for (const row of rows) {
    const keys = identities.get(row.title) ?? new Set<string>();
    keys.add('bookKey' in row && row.bookKey ? row.bookKey : `legacy:${row.title}`);
    identities.set(row.title, keys);
  }
  return [...identities].filter(([, keys]) => keys.size > 1).map(([title]) => title);
}

/** Lossless recovery snapshot. This is deliberately separate from TTU's title-keyed ZIP. */
export async function readStatisticsRecoverySnapshot(db: IDBPDatabase<BooksDb>) {
  const tx = db.transaction(
    ['data', 'statistic', 'readerStatistic', 'readerStatisticMigration', 'readerLocalIdentity'],
    'readonly'
  );
  const [books, legacyRows, contentRows, migrationReceipts, localIdentities] = await Promise.all([
    tx.objectStore('data').getAll(),
    tx.objectStore('statistic').getAll(),
    tx.objectStore('readerStatistic').getAll(),
    tx.objectStore('readerStatisticMigration').getAll(),
    tx.objectStore('readerLocalIdentity').getAll()
  ]);
  await tx.done;
  return {
    format: 'manabi-reader-statistics-recovery',
    version: 1,
    exportedAt: new Date().toISOString(),
    books: books.map(({ id, title, contentHash }) => ({ id, title, contentHash })),
    contentRows,
    legacyRows,
    migrationReceipts,
    localIdentities
  };
}
