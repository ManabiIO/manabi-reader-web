/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type BooksDb from '../data/database/books-db/versions/books-db';
import { commitTransaction } from '../data/database/books-db/commit-transaction.mjs';
import { contentHashPrimaryKeys } from '../data/database/books-db/content-hash-index';
import { contentStatisticKey, statisticRange } from '../data/database/books-db/reader-statistics';
import { canonical } from './ttu-migration-format';
import {
  projectReaderBridgeFiles,
  type ReaderBridgeFile,
  type ReaderBridgeProjection
} from './reader-bridge-projection';
import { planReaderBridge, type ReaderBridgeInput } from './reader-bridge-plan';
import {
  captureReaderBridgeLocalBook,
  sameReaderBridgeStoredValue,
  type ReaderBridgeLocalScope
} from './reader-bridge-local-book';
import {
  READER_BRIDGE_RECEIVE_STORES,
  prepareReaderBridgeJournal,
  acceptReaderBridgeReceive,
  type ReaderBridgeJournalEvidence,
  type ReaderBridgeReceiveDecision,
  type ReaderBridgeLocalTarget
} from './reader-bridge-journal';

type Tx = IDBPTransaction<BooksDb, typeof READER_BRIDGE_RECEIVE_STORES, 'readonly' | 'readwrite'>;
type VerifiedBook = ReturnType<typeof captureReaderBridgeLocalBook>;
export class ReaderBridgeLocalStateError extends Error {
  constructor(
    public readonly code: 'changed' | 'statistics-review' | 'unsupported-mapping' | 'pending-sync'
  ) {
    super(
      {
        changed: 'Reading data changed on this device. Review the current copies again.',
        'statistics-review':
          'Older or shared reading history needs review before this book can receive Drive changes.',
        'unsupported-mapping':
          'This reading data uses information that cannot be applied safely yet. Import and export remain available.',
        'pending-sync': 'This book already has sync work or a conflict to review.'
      }[code]
    );
  }
}
function fail(code: ReaderBridgeLocalStateError['code']): never {
  throw new ReaderBridgeLocalStateError(code);
}
const uuid = (value: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

async function readState(
  tx: Tx,
  verified: VerifiedBook,
  proposedIdentity: string,
  scope: ReaderBridgeLocalScope
) {
  const check = () => {
    scope.signal?.throwIfAborted();
    scope.assertCurrent();
    verified.assertCurrent();
  };
  check();
  const id = verified.snapshot.book.id;
  const [book, owner, resume, identity] = await Promise.all([
    tx.objectStore('data').get(id),
    tx.objectStore('readerBookScope').get(id),
    tx.objectStore('bookmark').get(id),
    tx.objectStore('readerLocalIdentity').get(id)
  ]);
  check();
  if (
    !book ||
    !scope.profileId ||
    !sameReaderBridgeStoredValue({ book, owner, resume }, verified.snapshot)
  )
    fail('changed');
  if (identity && (!uuid(identity.uuid) || identity.bookId !== id)) fail('statistics-review');
  const localIdentity = identity?.uuid ?? proposedIdentity;
  const identities = await tx.objectStore('readerLocalIdentity').getAll();
  if (identities.some((row) => row.bookId !== id && row.uuid === localIdentity))
    fail('statistics-review');
  const contentKey = contentStatisticKey(book);
  const key = contentKey ?? `local:${localIdentity}`;
  const contentCopies = contentKey
    ? await contentHashPrimaryKeys(
        tx.objectStore('data').index('contentHash'),
        book.contentHash!,
        check,
        scope.signal
      )
    : [id];
  // Shared totals affect every copy under this key. Do not infer ownership or
  // byte identity from another book's claimed hash.
  if (contentCopies.length !== 1 || contentCopies[0] !== id) fail('statistics-review');
  const [rows, legacy, migration, priorLocal, pending, conflicts] = await Promise.all([
    tx.objectStore('readerStatistic').getAll(statisticRange(key), 20001),
    tx.objectStore('statistic').getAll(IDBKeyRange.bound([book.title], [book.title, []]), 20001),
    tx.objectStore('readerStatisticMigration').get(book.title),
    contentKey && identity
      ? tx.objectStore('readerStatistic').getAll(statisticRange(`local:${identity.uuid}`), 1)
      : Promise.resolve([]),
    tx.objectStore('readerPersonalOutbox').index('bookKey').getAll(key),
    tx.objectStore('readerPersonalConflict').index('bookKey').getAll(key)
  ]);
  check();
  if (pending.length || conflicts.length) fail('pending-sync');
  if (
    priorLocal.length ||
    (migration && (migration.state !== 'assigned' || migration.bookKey !== key))
  )
    fail('statistics-review');
  const titleCopies = await tx.objectStore('data').index('title').getAllKeys(book.title);
  const adoptLegacy = !migration && legacy.length > 0;
  if (adoptLegacy && (titleCopies.length !== 1 || titleCopies[0] !== id)) fail('statistics-review');
  const selected = [...rows, ...(adoptLegacy ? legacy : [])];
  if (
    selected.length > 19999 ||
    new Set(selected.map((row) => row.dateKey)).size !== selected.length
  )
    fail('statistics-review');
  check();
  return {
    book,
    owner,
    resume,
    identity,
    localIdentity,
    key,
    rows,
    legacy,
    migration,
    titleCopies,
    contentCopies,
    adoptLegacy,
    selected
  };
}
type State = Awaited<ReturnType<typeof readState>>;

/** This explicit local serialization is only comparison/recovery evidence. It
 * is not a qualified writer for the reader's cloud files. Unknown local fields
 * go through the strict decoder rather than being silently projected away. */
function localFiles(
  state: State,
  profile: ReaderBridgeInput['local']['profile'],
  sourceTitle: string
) {
  const version = profile.split('-').slice(1).join('_');
  const files: ReaderBridgeFile[] = [];
  if (state.resume)
    files.push({
      name: `progress_${version}_${state.resume.lastBookmarkModified}_${state.resume.progress || 0}.json`,
      body: JSON.stringify(state.resume)
    });
  if (state.selected.length)
    files.push({
      name: `statistics_${version}_0_${Array(12).fill('0').join('_')}_na.json`,
      body: JSON.stringify(
        state.selected.map((row) => {
          const { bookKey: _key, ...value } = row as BooksDb['readerStatistic']['value'];
          return { ...value, title: sourceTitle };
        })
      )
    });
  return files;
}

function assertMapping(projection: ReaderBridgeProjection) {
  for (const [key, value] of Object.entries(projection.values)) {
    const allowed =
      key === 'resume'
        ? [
            'scrollX',
            'scrollY',
            'exploredCharCount',
            'progress',
            'completion',
            'lastBookmarkModified'
          ]
        : [
            'dateKey',
            'charactersRead',
            'readingTime',
            'minReadingSpeed',
            'altMinReadingSpeed',
            'lastReadingSpeed',
            'maxReadingSpeed',
            'lastStatisticModified',
            'completedBook',
            'completedData'
          ];
    if (Object.keys(value).some((field) => !allowed.includes(field))) fail('unsupported-mapping');
  }
}
export interface ReaderBridgeLocalReview {
  bookId: number;
  title: string;
  local: ReaderBridgeProjection;
  remote: ReaderBridgeProjection;
  plan: ReturnType<typeof planReaderBridge>;
}
interface Prepared {
  db: IDBPDatabase<BooksDb>;
  scope: ReaderBridgeLocalScope;
  verified: VerifiedBook;
  state: State;
  target: ReaderBridgeLocalTarget;
  evidence: ReaderBridgeJournalEvidence;
  operationId: string;
}
const preparedReviews = new WeakMap<ReaderBridgeLocalReview, Prepared>();

/** Prepare only: no identity creation, legacy migration, journal or other writes. */
export async function reviewReaderBridgeLocalChanges(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeLocalScope,
  comparison: object,
  remoteInput: ReaderBridgeProjection,
  source: { title: string; characters: number }
): Promise<ReaderBridgeLocalReview> {
  const verified = captureReaderBridgeLocalBook(comparison);
  const check = () => {
    scope.signal?.throwIfAborted();
    scope.assertCurrent();
    verified.assertCurrent();
  };
  check();
  const book = { ...source };
  const input = structuredClone(remoteInput);
  const remote = await projectReaderBridgeFiles(
    input.snapshot,
    book,
    input.originals,
    scope.signal
  );
  if (
    canonical(remote.snapshot) !== canonical(input.snapshot) ||
    remote.snapshot.fingerprint !== verified.fingerprint ||
    book.characters !== verified.snapshot.book.characters
  )
    fail('changed');
  assertMapping(remote);
  const proposedIdentity = crypto.randomUUID();
  const read = async () => {
    const tx = db.transaction(READER_BRIDGE_RECEIVE_STORES, 'readonly');
    return commitTransaction(tx, async () => {
      const state = await readState(tx, verified, proposedIdentity, scope);
      const rows = (
        await tx.objectStore('readerBridgeJournal').index('binding').getAll(remote.snapshot.binding)
      ).filter((row) => row.accountId === scope.profileId);
      if (rows.some((row) => !['accepted', 'superseded', 'abandoned'].includes(row.phase)))
        fail('pending-sync');
      const accepted = rows.filter((row) => row.phase === 'accepted');
      if (accepted.length > 1) fail('pending-sync');
      const prior = accepted[0];
      if (prior) {
        const target = prior.entry.acceptance?.target;
        if (
          !target ||
          target.bookId !== state.book.id ||
          target.localIdentity !== state.localIdentity ||
          target.statisticsKey !== state.key
        )
          fail('changed');
      }
      check();
      return { state, prior };
    });
  };
  const { state, prior } = await read();
  let local: ReaderBridgeProjection;
  try {
    local = await projectReaderBridgeFiles(
      { ...remote.snapshot, revision: crypto.randomUUID() },
      book,
      localFiles(state, remote.snapshot.profile, book.title),
      scope.signal
    );
    assertMapping(local);
  } catch (error) {
    check();
    if (error instanceof ReaderBridgeLocalStateError) throw error;
    fail('unsupported-mapping');
  }
  const after = await read();
  check();
  if (!sameReaderBridgeStoredValue({ state, prior }, after)) fail('changed');
  const baseline = prior?.entry.acceptance?.baseline;
  const evidence: ReaderBridgeJournalEvidence = {
    book,
    direction: 'receive',
    local: { snapshot: local.snapshot, originals: local.originals },
    remote: { snapshot: remote.snapshot, originals: remote.originals },
    ...(baseline ? { baseline } : {})
  };
  const plan = planReaderBridge({
    local: local.snapshot,
    remote: { state: 'available', snapshot: remote.snapshot },
    direction: 'receive',
    baseline
  });
  const result = Object.freeze({
    bookId: state.book.id,
    title: state.book.title,
    local,
    remote,
    plan: Object.freeze({
      ...plan,
      pull: Object.freeze(plan.pull),
      push: Object.freeze(plan.push),
      acknowledge: Object.freeze(plan.acknowledge),
      pending: Object.freeze(plan.pending),
      conflicts: Object.freeze(plan.conflicts)
    }) as unknown as typeof plan
  });
  preparedReviews.set(result, {
    db,
    scope,
    verified,
    state,
    target: {
      bookId: state.book.id,
      title: state.book.title,
      localIdentity: state.localIdentity,
      statisticsKey: state.key
    },
    evidence,
    operationId: crypto.randomUUID()
  });
  return result;
}

/** Called only under an exclusive reader-lifetime lease after refreshing the
 * remote observation. The persisted intent survives a lost result. All local
 * writes, legacy assignment and acceptance commit or roll back together. */
export async function receiveReaderBridgeLocalChanges(
  review: ReaderBridgeLocalReview,
  decision: ReaderBridgeReceiveDecision,
  assertRemoteCurrent: () => Promise<void>,
  signal?: AbortSignal
) {
  const prepared = preparedReviews.get(review);
  if (!prepared) fail('changed');
  const { db, scope, verified, state, target, evidence, operationId } = prepared;
  const check = () => {
    signal?.throwIfAborted();
    scope.signal?.throwIfAborted();
    scope.assertCurrent();
    verified.assertCurrent();
  };
  check();
  if (!scope.profileId) fail('changed');
  const journalScope = {
    accountId: scope.profileId,
    signal:
      signal && scope.signal ? AbortSignal.any([signal, scope.signal]) : (signal ?? scope.signal),
    assertCurrent: check
  };
  await assertRemoteCurrent();
  check();
  const pending = await prepareReaderBridgeJournal(db, journalScope, operationId, evidence);
  check();
  if (['accepted', 'superseded'].includes(pending.phase)) {
    if (
      canonical(pending.entry.acceptance?.target) !== canonical(target) ||
      pending.entry.acceptance?.decision !== decision
    )
      fail('changed');
    return pending; // Lost response: report the durable receipt, never replay it.
  }
  await assertRemoteCurrent();
  check();
  return acceptReaderBridgeReceive(
    db,
    journalScope,
    pending.id,
    pending.revision,
    target,
    decision,
    async (tx, keys, assertCurrent) => {
      const current = await readState(tx, verified, target.localIdentity, scope);
      if (!sameReaderBridgeStoredValue(current, state)) fail('changed');
      assertCurrent();
      const time = Math.max(
        Date.now(),
        Number(state.resume?.lastBookmarkModified ?? 0) + 1,
        ...state.selected.map((row) => row.lastStatisticModified + 1)
      );
      if (!Number.isSafeInteger(time) || time > 8640000000000000) fail('unsupported-mapping');
      if (!state.identity)
        await tx
          .objectStore('readerLocalIdentity')
          .put({ bookId: target.bookId, uuid: target.localIdentity });
      if (!state.owner)
        await tx
          .objectStore('readerBookScope')
          .put({ bookId: target.bookId, accountId: journalScope.accountId });
      if (state.adoptLegacy) {
        for (const row of state.legacy) {
          await tx.objectStore('readerStatistic').put({ ...row, bookKey: target.statisticsKey });
          assertCurrent();
        }
        await tx
          .objectStore('readerStatisticMigration')
          .put({ title: target.title, state: 'assigned', bookKey: target.statisticsKey });
      }
      for (const key of keys) {
        assertCurrent();
        const value = structuredClone(review.remote.values[key]);
        if (!value) fail('changed');
        if (key === 'resume') {
          await tx.objectStore('bookmark').put({
            ...value,
            dataId: target.bookId,
            lastBookmarkModified: time,
            ...(value.completion
              ? { completion: { ...(value.completion as object), modifiedAt: time } }
              : {})
          } as BooksDb['bookmark']['value']);
        } else {
          await tx.objectStore('readerStatistic').put({
            ...value,
            title: target.title,
            bookKey: target.statisticsKey,
            lastStatisticModified: time
          } as BooksDb['readerStatistic']['value']);
        }
      }
      if (state.adoptLegacy || keys.some((key) => key.startsWith('statistics/')))
        await tx
          .objectStore('lastModified')
          .put({ title: target.statisticsKey, dataType: 'statistic', lastModifiedValue: time });
      assertCurrent();
    }
  );
}
