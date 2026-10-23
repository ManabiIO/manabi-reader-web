/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type BooksDb from '../data/database/books-db/versions/books-db';
import { commitTransaction } from '../data/database/books-db/commit-transaction.mjs';
import { canonical } from './ttu-migration-format.ts';
import {
  validateReaderBridgeConnectionRecord,
  verifyReaderBridgeConnectionDescriptor,
  assertReaderBridgeConnectionCapacity,
  connectionDigest,
  READER_BRIDGE_CONNECTION_LIMITS,
  type ReaderBridgeConnectionRecord
} from './reader-bridge-connection-model';

import {
  planReaderBridge,
  validReaderBridgeSnapshot,
  type ReaderBridgeInput,
  type ReaderBridgePlan,
  type ReaderBridgeSnapshot
} from './reader-bridge-plan.ts';
import {
  projectReaderBridgeFiles,
  type ReaderBridgeFile,
  type ReaderBridgeProjection
} from './reader-bridge-projection.ts';

/** The receive adapter applies local data in the same transaction as acceptance.
 * No network, scheduler, grants or outgoing writer live in this module. */
export const READER_BRIDGE_JOURNAL_LIMITS = Object.freeze({
  entries: 64,
  entryBytes: 24 * 1024 * 1024,
  // Leave room for the portable envelope so a full journal remains exportable.
  accountBytes: 60 * 1024 * 1024,
  backupBytes: 64 * 1024 * 1024
});
export interface ReaderBridgeJournalScope {
  accountId: string;
  signal?: AbortSignal;
  assertCurrent(): void;
}
interface EvidenceProjection {
  snapshot: ReaderBridgeSnapshot;
  originals: readonly Readonly<ReaderBridgeFile>[];
}
export interface ReaderBridgeJournalEvidence {
  book: { title: string; characters: number };
  direction: ReaderBridgeInput['direction'];
  local: EvidenceProjection;
  remote: EvidenceProjection;
  baseline?: ReaderBridgeInput['baseline'];
}
type Phase =
  | 'prepared'
  | 'review'
  | 'paused'
  | 'uncertain'
  | 'abandoned'
  | 'accepted'
  | 'superseded';
export interface ReaderBridgeLocalTarget {
  bookId: number;
  localIdentity: string;
  statisticsKey: string;
  title: string;
}
export type ReaderBridgeReceiveDecision = 'incoming' | 'use-drive';
interface Acceptance {
  acceptedAt: string;
  target: ReaderBridgeLocalTarget;
  decision: ReaderBridgeReceiveDecision;
  applied: string[];
  baseline: NonNullable<ReaderBridgeInput['baseline']>;
}
interface Attempt {
  id: string;
  startedAt: string;
}
interface PortableEntry {
  operationId: string;
  createdAt: string;
  phase: Phase;
  evidence: ReaderBridgeJournalEvidence;
  attempt?: Attempt;
  acceptance?: Acceptance;
}
export interface ReaderBridgeJournalRecord {
  id: string;
  version: 1;
  accountId: string;
  binding: string;
  /** Random CAS revision avoids ABA after restore or a repeated operation ID. */
  revision: string;
  phase: Phase | 'restored';
  entry: PortableEntry;
  plan: ReaderBridgePlan;
  bytes: number;
}
export class ReaderBridgeJournalError extends Error {
  constructor(public readonly code: 'invalid' | 'stale' | 'pending' | 'capacity' | 'recovery') {
    super(
      {
        invalid: 'The sync recovery data could not be verified.',
        stale: 'The saved sync operation changed. Review the current copy.',
        pending: 'This book already has a pending sync operation to review.',
        capacity: 'Sync recovery storage is full. Export and review it before continuing.',
        recovery: 'This operation needs recovery before another upload can be attempted.'
      }[code]
    );
  }
}
function fail(code: ReaderBridgeJournalError['code'] = 'invalid'): never {
  throw new ReaderBridgeJournalError(code);
}
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const date = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function object(
  value: unknown,
  required: string[],
  optional: string[] = []
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    fail();
  return value as Record<string, unknown>;
}
function snapshot(value: unknown): ReaderBridgeSnapshot {
  object(value, ['binding', 'generation', 'profile', 'fingerprint', 'revision', 'records']);
  if (!validReaderBridgeSnapshot(value as ReaderBridgeSnapshot)) fail();
  return value as ReaderBridgeSnapshot;
}
function sameBook(left: ReaderBridgeSnapshot, right: ReaderBridgeSnapshot) {
  return ['binding', 'generation', 'profile', 'fingerprint'].every(
    (key) => left[key as keyof ReaderBridgeSnapshot] === right[key as keyof ReaderBridgeSnapshot]
  );
}
function guard(scope: ReaderBridgeJournalScope) {
  const owner = scope.accountId;
  if (typeof owner !== 'string' || !owner || owner.length > 512) fail();
  return () => {
    scope.signal?.throwIfAborted();
    if (scope.accountId !== owner) fail('stale');
    scope.assertCurrent();
  };
}
type Tx = IDBPTransaction<BooksDb, ['readerBridgeJournal'], 'readwrite'>;
async function transaction<T>(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeJournalScope,
  work: (tx: Tx, check: () => void) => Promise<T>
) {
  const check = guard(scope);
  check();
  const tx = db.transaction('readerBridgeJournal', 'readwrite');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  scope.signal?.addEventListener('abort', abort, { once: true });
  try {
    return await commitTransaction(tx, async () => {
      check();
      const value = await work(tx, check);
      check();
      return value;
    });
  } finally {
    scope.signal?.removeEventListener('abort', abort);
  }
}

/** Re-decode exact originals. Neither stored digests nor caller-supplied values
 * are accepted as proof that the originals describe those semantic records. */
async function verifyEvidence(input: unknown, check: () => void, signal?: AbortSignal) {
  check();
  const value = object(input, ['book', 'direction', 'local', 'remote'], ['baseline']);
  const book = object(value.book, ['title', 'characters']) as ReaderBridgeJournalEvidence['book'];
  if (!['receive', 'both'].includes(String(value.direction))) fail();
  const projections: ReaderBridgeProjection[] = [];
  for (const part of ['local', 'remote'] as const) {
    const wire = object(value[part], ['snapshot', 'originals']);
    const identity = snapshot(wire.snapshot);
    if (!Array.isArray(wire.originals)) fail();
    for (const file of wire.originals) object(file, ['name', 'body']);
    const projection = await projectReaderBridgeFiles(identity, book, wire.originals, signal);
    check();
    if (canonical(projection.snapshot) !== canonical(identity)) fail();
    projections.push(projection);
  }
  const [local, remote] = projections;
  if (!sameBook(local.snapshot, remote.snapshot)) fail();
  let baseline: ReaderBridgeInput['baseline'];
  if (value.baseline !== undefined) {
    const pair = object(value.baseline, ['local', 'remote']);
    baseline = { local: snapshot(pair.local), remote: snapshot(pair.remote) };
    if (
      !sameBook(local.snapshot, baseline.local) ||
      !sameBook(local.snapshot, baseline.remote) ||
      canonical(baseline.local.records) !== canonical(baseline.remote.records)
    )
      fail();
  }
  const evidence: ReaderBridgeJournalEvidence = {
    book: { title: book.title, characters: book.characters },
    direction: value.direction as ReaderBridgeInput['direction'],
    local: { snapshot: local.snapshot, originals: local.originals },
    remote: { snapshot: remote.snapshot, originals: remote.originals },
    ...(baseline ? { baseline } : {})
  };
  return evidence;
}
function plan(
  evidence: ReaderBridgeJournalEvidence,
  writeCapability?: ReaderBridgeInput['writeCapability']
) {
  return planReaderBridge({
    local: evidence.local.snapshot,
    remote: { state: 'available', snapshot: evidence.remote.snapshot },
    baseline: evidence.baseline,
    direction: evidence.direction,
    writeCapability
  });
}
function record(
  accountId: string,
  entry: PortableEntry,
  result: ReaderBridgePlan,
  id = entry.operationId,
  phase: ReaderBridgeJournalRecord['phase'] = entry.phase
): ReaderBridgeJournalRecord {
  const value = {
    id,
    version: 1 as const,
    accountId,
    binding: entry.evidence.local.snapshot.binding,
    revision: crypto.randomUUID(),
    phase,
    entry,
    plan: result,
    bytes: bytes(entry)
  };
  if (value.bytes > READER_BRIDGE_JOURNAL_LIMITS.entryBytes) fail('capacity');
  return value;
}
async function capacity(
  tx: Tx,
  accountId: string,
  additions: ReaderBridgeJournalRecord[],
  replacing?: string
) {
  const current = (await tx.store.index('accountId').getAll(accountId)).filter(
    (row) => row.id !== replacing
  );
  if (
    current.length + additions.length > READER_BRIDGE_JOURNAL_LIMITS.entries ||
    [...current, ...additions].reduce((total, row) => total + bytes(row.entry), 0) >
      READER_BRIDGE_JOURNAL_LIMITS.accountBytes
  )
    fail('capacity');
}

/** A restored completed decision is inactive evidence, not a competing job or
 * an active baseline. Restored unfinished/uncertain work still requires review. */
export function readerBridgeJournalNeedsReview(row: ReaderBridgeJournalRecord): boolean {
  const settled = ['abandoned', 'accepted', 'superseded'];
  return (
    !settled.includes(row.phase) && !(row.phase === 'restored' && settled.includes(row.entry.phase))
  );
}

/** Call before scheduling work. Retry the same operationId after a lost local
 * result; a changed draft cannot reuse it. Concurrent tabs serialize in IDB. */
export async function prepareReaderBridgeJournal(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeJournalScope,
  operationId: string,
  input: ReaderBridgeJournalEvidence,
  writeCapability?: ReaderBridgeInput['writeCapability']
) {
  if (
    !uuid(operationId) ||
    (writeCapability !== undefined && writeCapability !== 'conditional-recoverable')
  )
    fail();
  const check = guard(scope);
  check();
  const captured = structuredClone(input);
  if (bytes(captured) > READER_BRIDGE_JOURNAL_LIMITS.entryBytes) fail('capacity');
  const evidence = await verifyEvidence(captured, check, scope.signal);
  const result = plan(evidence, writeCapability);
  const phase = result.state === 'ready' ? 'prepared' : result.state;
  const next = record(
    scope.accountId,
    { operationId, createdAt: new Date().toISOString(), phase, evidence },
    result
  );
  return transaction(db, scope, async (tx) => {
    const previous = await tx.store.get(operationId);
    if (previous) {
      if (
        previous.accountId !== scope.accountId ||
        canonical(previous.entry.evidence) !== canonical(evidence)
      )
        fail('stale');
      return previous; // In particular, an uncertain attempt is never prepared again.
    }
    const existing = await tx.store.index('binding').getAll(next.binding);
    if (
      existing.some(
        (row) => row.accountId === scope.accountId && readerBridgeJournalNeedsReview(row)
      )
    )
      fail('pending');
    await capacity(tx, scope.accountId, [next]);
    await tx.store.add(next);
    return next;
  });
}

async function current(tx: Tx, scope: ReaderBridgeJournalScope, id: string, revision: string) {
  const value = await tx.store.get(id);
  if (!value || value.accountId !== scope.accountId || value.revision !== revision) fail('stale');
  return value;
}
/** Commit uncertainty BEFORE issuing the upload. A crash even before transmission
 * requires inspection; after reload this operation cannot be blindly replayed.
 * Capability is a live adapter assertion, never read from storage or a backup. */
export async function markReaderBridgeAttempt(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeJournalScope,
  id: string,
  revision: string,
  writeCapability: ReaderBridgeInput['writeCapability']
) {
  if (writeCapability !== 'conditional-recoverable') fail('recovery');
  return transaction(db, scope, async (tx) => {
    const before = await current(tx, scope, id, revision);
    if (before.phase !== 'prepared' || before.plan.state !== 'ready' || !before.plan.push.length)
      fail('recovery');
    const entry: PortableEntry = {
      ...before.entry,
      phase: 'uncertain',
      attempt: { id: crypto.randomUUID(), startedAt: new Date().toISOString() }
    };
    const next = record(scope.accountId, entry, before.plan, before.id);
    await capacity(tx, scope.accountId, [next], before.id);
    await tx.store.put(next);
    return next;
  });
}

/** Superseded unsent plans remain exportable. Uploaded/possibly uploaded and
 * restored evidence cannot be dismissed through this operation. */
export async function abandonReaderBridgeDraft(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeJournalScope,
  id: string,
  revision: string
) {
  return transaction(db, scope, async (tx) => {
    const before = await current(tx, scope, id, revision);
    if (!['prepared', 'review', 'paused'].includes(before.phase) || before.entry.attempt)
      fail('recovery');
    const next = record(
      scope.accountId,
      { ...before.entry, phase: 'abandoned' },
      before.plan,
      before.id
    );
    await capacity(tx, scope.accountId, [next], before.id);
    await tx.store.put(next);
    return next;
  });
}

export async function readReaderBridgeJournal(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeJournalScope
) {
  const check = guard(scope);
  check();
  const rows = await db.getAllFromIndex('readerBridgeJournal', 'accountId', scope.accountId);
  check();
  return rows;
}

async function portable(
  input: unknown,
  check: () => void,
  signal?: AbortSignal
): Promise<PortableEntry> {
  const value = object(
    input,
    ['operationId', 'createdAt', 'phase', 'evidence'],
    ['attempt', 'acceptance']
  );
  if (
    !uuid(value.operationId) ||
    !date(value.createdAt) ||
    !['prepared', 'review', 'paused', 'uncertain', 'abandoned', 'accepted', 'superseded'].includes(
      String(value.phase)
    )
  )
    fail();
  let attempt: Attempt | undefined;
  if (value.attempt !== undefined) {
    const pending = object(value.attempt, ['id', 'startedAt']);
    if (!uuid(pending.id) || !date(pending.startedAt) || value.phase !== 'uncertain') fail();
    attempt = { id: pending.id, startedAt: pending.startedAt };
  } else if (value.phase === 'uncertain') fail();
  const evidence = await verifyEvidence(value.evidence, check, signal);
  let acceptance: Acceptance | undefined;
  if (['accepted', 'superseded'].includes(String(value.phase))) {
    const saved = object(value.acceptance, [
      'acceptedAt',
      'target',
      'decision',
      'applied',
      'baseline'
    ]);
    if (!date(saved.acceptedAt)) fail();
    acceptance = acceptedProjection(
      evidence,
      value.operationId,
      saved.target,
      saved.decision,
      saved.acceptedAt
    );
    if (canonical(saved) !== canonical(acceptance)) fail();
  } else if (value.acceptance !== undefined) fail();
  return {
    operationId: value.operationId,
    createdAt: value.createdAt,
    phase: value.phase as Phase,
    evidence,
    ...(attempt ? { attempt } : {}),
    ...(acceptance ? { acceptance } : {})
  };
}
export async function exportReaderBridgeRecovery(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeJournalScope
) {
  const check = guard(scope);
  check();
  const tx = db.transaction(['readerBridgeJournal', 'readerBridgeConnection'], 'readonly');
  const [rows, saved] = await commitTransaction(tx, () =>
    Promise.all([
      tx.objectStore('readerBridgeJournal').index('accountId').getAll(scope.accountId),
      tx
        .objectStore('readerBridgeConnection')
        .index('accountId')
        .getAll(scope.accountId, READER_BRIDGE_CONNECTION_LIMITS.records + 1)
    ])
  );
  check();
  const records = saved.map(validateReaderBridgeConnectionRecord);
  assertReaderBridgeConnectionCapacity(records);
  const connections = [];
  for (const row of records) {
    connections.push(await verifyReaderBridgeConnectionDescriptor(row.descriptor));
    check();
  }
  const entries: PortableEntry[] = [];
  for (const row of rows) entries.push(await portable(row.entry, check, scope.signal));
  check();
  const document = {
    format: 'manabi-reader-bridge-recovery',
    version: 3,
    accountId: scope.accountId,
    entries,
    connections
  };
  if (bytes(document) > READER_BRIDGE_JOURNAL_LIMITS.backupBytes) fail('capacity');
  return JSON.stringify(document);
}

/** An inert recovery import, never an active connection. Same-account only;
 * portable identity cannot silently select another account or local book.
 * Existing operations are not overwritten, and an identical import is a no-op. */
export async function restoreReaderBridgeRecovery(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeJournalScope,
  json: string
) {
  const check = guard(scope);
  check();
  if (
    typeof json !== 'string' ||
    json.length > READER_BRIDGE_JOURNAL_LIMITS.backupBytes ||
    new TextEncoder().encode(json).byteLength > READER_BRIDGE_JOURNAL_LIMITS.backupBytes
  )
    fail('capacity');
  const document = object(
    JSON.parse(json),
    ['format', 'version', 'accountId', 'entries'],
    ['connections']
  );
  if (
    document.format !== 'manabi-reader-bridge-recovery' ||
    ![1, 2, 3].includes(Number(document.version)) ||
    typeof document.version !== 'number' ||
    document.accountId !== scope.accountId ||
    !Array.isArray(document.entries) ||
    document.entries.length > READER_BRIDGE_JOURNAL_LIMITS.entries ||
    (document.version === 3
      ? !Array.isArray(document.connections) ||
        document.connections.length > READER_BRIDGE_CONNECTION_LIMITS.records
      : document.connections !== undefined)
  )
    fail();
  const restored = new Map<string, ReaderBridgeJournalRecord>();
  for (const value of document.entries) {
    if (document.version === 1 && value && typeof value === 'object' && 'acceptance' in value)
      fail();
    if (bytes(value) > READER_BRIDGE_JOURNAL_LIMITS.entryBytes) fail('capacity');
    const entry = await portable(value, check, scope.signal);
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(canonical([scope.accountId, entry]))
        )
      ),
      (byte) => byte.toString(16).padStart(2, '0')
    ).join('');
    check();
    const id = `recovery:${digest}`;
    restored.set(id, record(scope.accountId, entry, plan(entry.evidence), id, 'restored'));
  }
  const restoredConnections = new Map<string, ReaderBridgeConnectionRecord>();
  for (const input of (document.connections ?? []) as unknown[]) {
    const descriptor = await verifyReaderBridgeConnectionDescriptor(input);
    if (descriptor.accountId !== scope.accountId) fail();
    const id = `recovery:${await connectionDigest(descriptor)}`;
    check();
    restoredConnections.set(id, {
      id,
      version: 1,
      revision: crypto.randomUUID(),
      state: 'restored',
      accountId: scope.accountId,
      binding: descriptor.binding,
      bookId: descriptor.local.bookId,
      descriptor
    });
  }
  assertReaderBridgeConnectionCapacity([...restoredConnections.values()]);
  check();
  const tx = db.transaction(['readerBridgeJournal', 'readerBridgeConnection'], 'readwrite');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  scope.signal?.addEventListener('abort', abort, { once: true });
  try {
    return await commitTransaction(tx, async () => {
      check();
      const journal = tx.objectStore('readerBridgeJournal');
      const connections = tx.objectStore('readerBridgeConnection');
      const additions: ReaderBridgeJournalRecord[] = [];
      for (const row of restored.values()) {
        const existing = await journal.get(row.id);
        if (existing) {
          if (
            existing.accountId !== scope.accountId ||
            existing.phase !== 'restored' ||
            canonical(existing.entry) !== canonical(row.entry)
          )
            fail('stale');
        } else additions.push(row);
      }
      const current = await journal.index('accountId').getAll(scope.accountId);
      if (
        current.length + additions.length > READER_BRIDGE_JOURNAL_LIMITS.entries ||
        [...current, ...additions].reduce((total, row) => total + bytes(row.entry), 0) >
          READER_BRIDGE_JOURNAL_LIMITS.accountBytes
      )
        fail('capacity');
      const connectionAdditions: ReaderBridgeConnectionRecord[] = [];
      for (const row of restoredConnections.values()) {
        const existing = await connections.get(row.id);
        if (existing) {
          validateReaderBridgeConnectionRecord(existing);
          if (
            existing.accountId !== scope.accountId ||
            existing.state !== 'restored' ||
            canonical(existing.descriptor) !== canonical(row.descriptor)
          )
            fail('stale');
        } else connectionAdditions.push(row);
      }
      const currentConnections = (
        await connections
          .index('accountId')
          .getAll(scope.accountId, READER_BRIDGE_CONNECTION_LIMITS.records + 1)
      ).map(validateReaderBridgeConnectionRecord);
      assertReaderBridgeConnectionCapacity([...currentConnections, ...connectionAdditions]);
      for (const row of additions) {
        check();
        await journal.add(row);
        check();
      }
      for (const row of connectionAdditions) {
        check();
        await connections.add(row);
        check();
      }
      check();
      return additions.length + connectionAdditions.length;
    });
  } finally {
    scope.signal?.removeEventListener('abort', abort);
  }
}

export const READER_BRIDGE_RECEIVE_STORES = [
  'data',
  'bookmark',
  'readerBookScope',
  'readerLocalIdentity',
  'statistic',
  'readerStatistic',
  'readerStatisticMigration',
  'lastModified',
  'readerBridgeJournal',
  'readerPersonalOutbox',
  'readerPersonalConflict'
] as const;
export type ReaderBridgeReceiveTransaction = IDBPTransaction<
  BooksDb,
  typeof READER_BRIDGE_RECEIVE_STORES,
  'readwrite'
>;

function localTarget(value: unknown): ReaderBridgeLocalTarget {
  const v = object(value, ['bookId', 'localIdentity', 'statisticsKey', 'title']);
  if (
    !Number.isSafeInteger(v.bookId) ||
    Number(v.bookId) <= 0 ||
    !uuid(v.localIdentity) ||
    typeof v.statisticsKey !== 'string' ||
    !(
      v.statisticsKey === `local:${v.localIdentity}` ||
      /^content:[a-f0-9]{64}$/.test(v.statisticsKey)
    ) ||
    typeof v.title !== 'string' ||
    !v.title ||
    v.title.length > 4096
  )
    fail();
  return v as unknown as ReaderBridgeLocalTarget;
}

/** Only agreed records enter the baseline. Local-only pending values keep their
 * previous agreement, and missing rows are never accepted as deletions. */
function acceptedProjection(
  evidence: ReaderBridgeJournalEvidence,
  operationId: string,
  target: unknown,
  decision: unknown,
  acceptedAt: string
): Acceptance {
  if (evidence.direction !== 'receive' || !['incoming', 'use-drive'].includes(String(decision)))
    fail();
  const result = plan(evidence);
  if (
    result.state === 'paused' ||
    result.conflicts.some((item) => item.reason === 'removed') ||
    (result.state === 'review' && decision !== 'use-drive')
  )
    fail('recovery');
  const selected =
    decision === 'use-drive'
      ? Object.keys(evidence.remote.snapshot.records).sort()
      : [...result.acknowledge, ...result.pull].sort();
  const records = { ...evidence.baseline?.local.records };
  for (const key of selected) records[key] = evidence.remote.snapshot.records[key];
  return {
    acceptedAt,
    target: { ...localTarget(target) },
    decision: decision as ReaderBridgeReceiveDecision,
    applied: selected.filter(
      (key) => evidence.local.snapshot.records[key] !== evidence.remote.snapshot.records[key]
    ),
    baseline: {
      local: { ...evidence.local.snapshot, revision: `accepted:${operationId}`, records },
      remote: { ...evidence.remote.snapshot, records: { ...records } }
    }
  };
}

/** The callback may await only this transaction's IDB requests. It must recheck
 * current book bytes, ownership, local state and reader lifetime authority, then
 * apply exactly the supplied incoming keys. A request success is not a commit. */
export async function acceptReaderBridgeReceive(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeJournalScope,
  id: string,
  revision: string,
  targetInput: ReaderBridgeLocalTarget,
  decision: ReaderBridgeReceiveDecision,
  apply: (
    tx: ReaderBridgeReceiveTransaction,
    keys: readonly string[],
    check: () => void
  ) => Promise<void>
) {
  const check = guard(scope);
  check();
  const target = structuredClone(localTarget(targetInput));
  // Revalidate retained evidence before opening the write transaction.
  const observed = await db.get('readerBridgeJournal', id);
  check();
  if (
    !observed ||
    observed.accountId !== scope.accountId ||
    observed.revision !== revision ||
    !['prepared', 'review'].includes(observed.phase)
  )
    fail('stale');
  const entry = await portable(observed.entry, check, scope.signal);
  const acceptance = acceptedProjection(
    entry.evidence,
    entry.operationId,
    target,
    decision,
    new Date().toISOString()
  );
  const next = record(
    scope.accountId,
    { ...entry, phase: 'accepted', acceptance },
    plan(entry.evidence),
    id
  );
  check();
  const tx = db.transaction(READER_BRIDGE_RECEIVE_STORES, 'readwrite');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  scope.signal?.addEventListener('abort', abort, { once: true });
  try {
    return await commitTransaction(tx, async () => {
      check();
      const journal = tx.objectStore('readerBridgeJournal');
      const current = await journal.get(id);
      if (
        !current ||
        current.revision !== revision ||
        current.accountId !== scope.accountId ||
        canonical(current.entry) !== canonical(entry) ||
        current.phase !== entry.phase
      )
        fail('stale');
      const rows = await journal.index('accountId').getAll(scope.accountId);
      if (
        rows.some(
          (row) =>
            row.id !== id && row.binding === next.binding && readerBridgeJournalNeedsReview(row)
        )
      )
        fail('pending');
      const prior = rows.filter((row) => row.binding === next.binding && row.phase === 'accepted');
      if (prior.length > 1) fail('recovery');
      const previous = prior[0];
      if (previous) {
        const accepted = previous.entry.acceptance;
        if (
          !accepted ||
          canonical(accepted.baseline) !== canonical(entry.evidence.baseline) ||
          accepted.target.bookId !== target.bookId ||
          accepted.target.localIdentity !== target.localIdentity ||
          accepted.target.statisticsKey !== target.statisticsKey
        )
          fail('stale');
      } else if (entry.evidence.baseline) fail('stale');
      const updates = [
        next,
        ...prior.map((row) =>
          record(scope.accountId, { ...row.entry, phase: 'superseded' }, row.plan, row.id)
        )
      ];
      const all = [
        ...rows.filter((row) => !updates.some((update) => update.id === row.id)),
        ...updates
      ];
      if (
        all.length > READER_BRIDGE_JOURNAL_LIMITS.entries ||
        all.reduce((sum, row) => sum + bytes(row.entry), 0) >
          READER_BRIDGE_JOURNAL_LIMITS.accountBytes
      )
        fail('capacity');
      check();
      await apply(tx, acceptance.applied, check);
      check();
      for (const update of updates) {
        await journal.put(update);
        check();
      }
      return next;
    });
  } finally {
    scope.signal?.removeEventListener('abort', abort);
  }
}
