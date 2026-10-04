/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** DOM owner only: native receives bounded DTOs, never database handles. */
import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type BooksDb from '$lib/data/database/books-db/versions/books-db';
import type {
  BooksDbContentStatistic,
  BooksDbStatistic
} from '$lib/data/database/books-db/versions/books-db';
import { commitTransaction } from '$lib/data/database/books-db/commit-transaction.mjs';
import { contentHashPrimaryKeys } from '$lib/data/database/books-db/content-hash-index';
import {
  contentStatisticKey,
  statisticRange,
  type StatisticIdentityPlan,
  type StatisticsMigrationGuard
} from '$lib/data/database/books-db/reader-statistics';
import type { NativeStatisticsAction } from './native-contract';

export interface NativeStatisticsProof {
  plan: StatisticIdentityPlan;
  /** Original database values, including zero-time completion/start records. */
  rows: BooksDbContentStatistic[];
  legacyRows: BooksDbStatistic[];
}
const changed = () => new Error('This reading history changed. Refresh before trying again.');
/** Compare every stored field, including completion payloads and sync metadata. */
function equivalent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && equivalent(a[key], b[key]))
  );
}

const statisticsStores = [
  'data',
  'readerBookScope',
  'readerLocalIdentity',
  'readerStatisticMigration',
  'readerStatistic',
  'statistic',
  'lastModified'
] as const;
type StatisticsTransaction = IDBPTransaction<BooksDb, typeof statisticsStores, IDBTransactionMode>;
async function validateIdentity(
  tx: StatisticsTransaction,
  id: number,
  plan: StatisticIdentityPlan,
  guard: StatisticsMigrationGuard
) {
  const book = await tx.objectStore('data').get(id);
  const owner = await tx.objectStore('readerBookScope').get(id);
  guard.validate(book, owner);
  if (!book || book.title !== plan.title) throw changed();
  const local = await tx.objectStore('readerLocalIdentity').get(id);
  guard.validateIdentity?.(book, local);
  const key = contentStatisticKey(book) ?? (local ? `local:${local.uuid}` : undefined);
  const keys = new Set(key ? [key] : []);
  if (local) keys.add(`local:${local.uuid}`);
  if (
    key !== plan.bookKey ||
    keys.size !== plan.keys.length ||
    plan.keys.some((value) => !keys.has(value))
  )
    throw changed();
  const receipt = await tx.objectStore('readerStatisticMigration').get(book.title);
  const assigned =
    receipt?.state === 'assigned' ||
    (receipt?.state === 'identity-conflict' && receipt.legacyAssigned === true);
  const legacyTitle =
    assigned && receipt?.bookKey && keys.has(receipt.bookKey) ? book.title : undefined;
  const unresolved = receipt ? !assigned || !receipt.bookKey : false;
  if (unresolved !== plan.unresolvedLegacy || legacyTitle !== plan.legacyTitle) throw changed();
  if (contentStatisticKey(book)) {
    const copies = await contentHashPrimaryKeys(
      tx.objectStore('data').index('contentHash'),
      book.contentHash!,
      guard.assertCurrent,
      guard.signal
    );
    for (const copyId of copies) {
      const copy = await tx.objectStore('data').get(copyId);
      if (!copy) throw changed();
      guard.validateCopy?.(copy, await tx.objectStore('readerBookScope').get(copyId));
    }
  }
  guard.assertCurrent();
  guard.signal.throwIfAborted();
  return { keys, receipt };
}
/** Materialize proof rows under the same read lock as every ownership claimant. */
export async function readNativeStatisticsProof(
  db: IDBPDatabase<BooksDb>,
  bookId: number,
  plan: StatisticIdentityPlan,
  guard: StatisticsMigrationGuard,
  maxRows?: number
): Promise<NativeStatisticsProof> {
  guard.assertCurrent();
  guard.signal.throwIfAborted();
  const tx = db.transaction(statisticsStores, 'readonly');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  guard.signal.addEventListener('abort', abort, { once: true });
  try {
    return await commitTransaction(tx, async () => {
      const { keys } = await validateIdentity(tx, bookId, plan, guard);
      const rows: BooksDbContentStatistic[] = [];
      for (const key of keys) {
        rows.push(
          ...(await tx
            .objectStore('readerStatistic')
            .getAll(statisticRange(key), maxRows === undefined ? undefined : maxRows + 1))
        );
        if (maxRows !== undefined && rows.length > maxRows)
          throw new Error('Too much history for one snapshot.');
      }
      const legacyRows = plan.legacyTitle
        ? await tx
            .objectStore('statistic')
            .getAll(
              statisticRange(plan.legacyTitle),
              maxRows === undefined ? undefined : maxRows + 1
            )
        : [];
      if (maxRows !== undefined && legacyRows.length > maxRows)
        throw new Error('Too much legacy history for one snapshot.');
      guard.assertCurrent();
      guard.signal.throwIfAborted();
      return { plan, rows, legacyRows };
    });
  } finally {
    guard.signal.removeEventListener('abort', abort);
  }
}

/** A continuation never reruns migration. Compare its immutable source proof under
 * one read lock; a replacement, new claimant, or changed row retires the transfer. */
export async function verifyNativeStatisticsProofs(
  db: IDBPDatabase<BooksDb>,
  proofs: ReadonlyMap<number, NativeStatisticsProof>,
  guard: StatisticsMigrationGuard,
  includeRows = true
): Promise<void> {
  guard.assertCurrent();
  guard.signal.throwIfAborted();
  const tx = db.transaction(statisticsStores, 'readonly');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  guard.signal.addEventListener('abort', abort, { once: true });
  try {
    await commitTransaction(tx, async () => {
      const checkedKeys = new Set<string>(),
        checkedTitles = new Set<string>();
      for (const [id, proof] of proofs) {
        const { keys } = await validateIdentity(tx, id, proof.plan, guard);
        if (!includeRows) continue;
        for (const key of keys) {
          if (checkedKeys.has(key)) continue;
          checkedKeys.add(key);
          const current = await tx.objectStore('readerStatistic').getAll(statisticRange(key));
          if (
            !equivalent(
              current,
              proof.rows.filter((row) => row.bookKey === key)
            )
          )
            throw changed();
        }
        if (proof.plan.legacyTitle && !checkedTitles.has(proof.plan.legacyTitle)) {
          checkedTitles.add(proof.plan.legacyTitle);
          const current = await tx
            .objectStore('statistic')
            .getAll(statisticRange(proof.plan.legacyTitle));
          if (!equivalent(current, proof.legacyRows)) throw changed();
        }
      }
      guard.assertCurrent();
      guard.signal.throwIfAborted();
    });
  } finally {
    guard.signal.removeEventListener('abort', abort);
  }
}

/** Multi-book changes are atomic. Ownership, identity, migration receipts and
 * optimistic row preconditions are checked under the very same write lock. */
export async function mutateNativeStatistics(
  db: IDBPDatabase<BooksDb>,
  proofs: ReadonlyMap<number, NativeStatisticsProof>,
  input: NativeStatisticsAction,
  guard: StatisticsMigrationGuard,
  selectedKeys?: ReadonlySet<string>
): Promise<void> {
  const ids = input.type === 'delete-range' ? input.bookIds : [input.bookId];
  guard.assertCurrent();
  guard.signal.throwIfAborted();
  const tx = db.transaction(statisticsStores, 'readwrite');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  guard.signal.addEventListener('abort', abort, { once: true });
  try {
    await commitTransaction(tx, async () => {
      const targets = new Map<
        string,
        {
          plan: StatisticIdentityPlan;
          rows: BooksDbContentStatistic[];
          legacyRows: BooksDbStatistic[];
        }
      >();
      for (const id of ids) {
        guard.assertCurrent();
        guard.signal.throwIfAborted();
        const proof = proofs.get(id);
        if (!proof || proof.plan.unresolvedLegacy) throw changed();
        const plan = proof.plan;
        const { keys, receipt } = await validateIdentity(tx, id, plan, guard);
        for (const rowKey of keys) {
          if (selectedKeys && !selectedKeys.has(rowKey)) continue;
          if (input.type === 'delete-day' && rowKey !== input.bookKey) continue;
          targets.set(rowKey, {
            plan:
              (input.type === 'delete-day' || selectedKeys !== undefined) &&
              receipt?.bookKey !== rowKey
                ? { ...plan, legacyTitle: undefined }
                : plan,
            rows: proof.rows.filter((row) => row.bookKey === rowKey),
            legacyRows: proof.legacyRows
          });
        }
        if (
          input.type === 'delete-day' &&
          !proof.rows.some((row) => row.bookKey === input.bookKey && row.dateKey === input.date)
        )
          throw changed();
      }
      const content = tx.objectStore('readerStatistic');
      const modified = tx.objectStore('lastModified');
      const now = Date.now();
      if (input.type === 'save-day') {
        const target = targets.get(input.bookKey),
          proof = proofs.get(input.bookId)!;
        if (!target || input.title !== proof.plan.title) throw changed();
        const existing = await content.get([input.bookKey, input.date]);
        if (input.mode === 'create') {
          if (input.bookKey !== proof.plan.bookKey) throw changed();
          for (const key of proof.plan.keys) {
            if (await content.get([key, input.date]))
              throw new Error('This day already has history. Refresh and edit its existing entry.');
          }
        } else {
          const original = target.rows.find((row) => row.dateKey === input.date);
          if (!existing || !original || !equivalent(existing, original)) throw changed();
        }
        const speed = input.time ? Math.ceil((input.characters * 3600) / input.time) : 0;
        const value: BooksDbContentStatistic = {
          ...existing,
          title: input.title,
          bookKey: input.bookKey,
          dateKey: input.date,
          readingTime: input.time,
          charactersRead: input.characters,
          lastReadingSpeed: speed,
          minReadingSpeed:
            existing?.minReadingSpeed && !input.resetMinMax
              ? Math.min(existing.minReadingSpeed, speed)
              : speed,
          altMinReadingSpeed:
            input.characters || input.resetMinMax
              ? existing?.altMinReadingSpeed && !input.resetMinMax
                ? Math.min(existing.altMinReadingSpeed, speed)
                : speed
              : (existing?.altMinReadingSpeed ?? 0),
          maxReadingSpeed: input.resetMinMax
            ? speed
            : Math.max(existing?.maxReadingSpeed ?? 0, speed),
          lastStatisticModified: Math.max(now, (existing?.lastStatisticModified ?? 0) + 1)
        };
        await content.put(value);
        await modified.put({
          title: input.bookKey,
          dataType: 'statistic',
          lastModifiedValue: value.lastStatisticModified
        });
      } else {
        const start =
          input.type === 'delete-day'
            ? input.date
            : input.type === 'delete-range'
              ? input.startDate
              : '';
        const end =
          input.type === 'delete-day'
            ? input.date
            : input.type === 'delete-range'
              ? input.endDate
              : '';
        const inRange = (row: { dateKey: string }) =>
          input.type === 'delete-book-history' || (row.dateKey >= start && row.dateKey <= end);
        const legacyTitles = new Set<string>();
        // Validate every selected range before any delete request.
        for (const [key, target] of targets) {
          const range =
            input.type === 'delete-book-history'
              ? statisticRange(key)
              : IDBKeyRange.bound([key, start], [key, end]);
          const current = await content.getAll(range);
          const original = target.rows.filter(inRange);
          if (!equivalent(current, original)) throw changed();
          if (target.plan.legacyTitle && !legacyTitles.has(target.plan.legacyTitle)) {
            const title = target.plan.legacyTitle;
            const legacyRange =
              input.type === 'delete-book-history'
                ? statisticRange(title)
                : IDBKeyRange.bound([title, start], [title, end]);
            const legacy = await tx.objectStore('statistic').getAll(legacyRange);
            if (!equivalent(legacy, target.legacyRows.filter(inRange))) throw changed();
            legacyTitles.add(title);
          }
        }
        for (const [key] of targets) {
          const range =
            input.type === 'delete-book-history'
              ? statisticRange(key)
              : IDBKeyRange.bound([key, start], [key, end]);
          await content.delete(range);
          await modified.put({ title: key, dataType: 'statistic', lastModifiedValue: now });
        }
        for (const title of legacyTitles) {
          const range =
            input.type === 'delete-book-history'
              ? statisticRange(title)
              : IDBKeyRange.bound([title, start], [title, end]);
          await tx.objectStore('statistic').delete(range);
          await modified.put({ title, dataType: 'statistic', lastModifiedValue: now });
        }
      }
      // An abort after the final request must still roll back the entire change.
      guard.assertCurrent();
      guard.signal.throwIfAborted();
    });
  } finally {
    guard.signal.removeEventListener('abort', abort);
  }
}
