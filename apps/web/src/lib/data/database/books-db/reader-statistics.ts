/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase } from 'idb';
import type BooksDb from './versions/books-db';
import type {
  BooksDbBookData,
  BooksDbContentStatistic,
  BooksDbStatistic
} from './versions/books-db';

const digest = /^[a-f0-9]{64}$/i;

export function contentStatisticKey(book: BooksDbBookData): string | undefined {
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

/**
 * Assign an inherited title-keyed row only when every currently known copy
 * under that title has the same verified content identity. Once a title was
 * ambiguous, removing one copy cannot retroactively prove ownership.
 */
export async function migrateLegacyStatistics(
  db: IDBPDatabase<BooksDb>,
  book: BooksDbBookData
): Promise<string> {
  const tx = db.transaction(
    ['data', 'statistic', 'readerStatistic', 'readerStatisticMigration', 'readerLocalIdentity'],
    'readwrite'
  );
  const identity = tx.objectStore('readerLocalIdentity');
  const keyFor = async (copy: BooksDbBookData) => {
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
    const existing = await Promise.all(localRows.map((row) => content.get([bookKey, row.dateKey])));
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
      await tx.done;
      return bookKey;
    }
    for (const row of localRows) {
      if (!(await content.get([bookKey, row.dateKey]))) await content.put({ ...row, bookKey });
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
          await tx.done;
          return bookKey;
        }
        for (const row of legacy) {
          const existing = await content.get([bookKey, row.dateKey]);
          if (!existing) await content.put({ ...row, bookKey } satisfies BooksDbContentStatistic);
        }
        await migration.put({ title: book.title, state: 'assigned', bookKey });
      }
    }
  }
  await tx.done;
  return bookKey;
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
