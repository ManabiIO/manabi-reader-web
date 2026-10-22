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

/** This store is in the books database so a future local apply/acknowledgement
 * can share its transaction. This module deliberately cannot acknowledge or
 * execute a transfer: decoded projections do not prove a lossless local mapping
 * or a qualified cloud writer. No network, scheduler, grants or credentials. */
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
type Phase = 'prepared' | 'review' | 'paused' | 'uncertain' | 'abandoned';
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
    if (existing.some((row) => row.accountId === scope.accountId && row.phase !== 'abandoned'))
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
  const value = object(input, ['operationId', 'createdAt', 'phase', 'evidence'], ['attempt']);
  if (
    !uuid(value.operationId) ||
    !date(value.createdAt) ||
    !['prepared', 'review', 'paused', 'uncertain', 'abandoned'].includes(String(value.phase))
  )
    fail();
  let attempt: Attempt | undefined;
  if (value.attempt !== undefined) {
    const pending = object(value.attempt, ['id', 'startedAt']);
    if (!uuid(pending.id) || !date(pending.startedAt) || value.phase !== 'uncertain') fail();
    attempt = { id: pending.id, startedAt: pending.startedAt };
  } else if (value.phase === 'uncertain') fail();
  return {
    operationId: value.operationId,
    createdAt: value.createdAt,
    phase: value.phase as Phase,
    evidence: await verifyEvidence(value.evidence, check, signal),
    ...(attempt ? { attempt } : {})
  };
}
export async function exportReaderBridgeRecovery(
  db: IDBPDatabase<BooksDb>,
  scope: ReaderBridgeJournalScope
) {
  const check = guard(scope);
  const rows = await readReaderBridgeJournal(db, scope);
  const entries: PortableEntry[] = [];
  for (const row of rows) entries.push(await portable(row.entry, check, scope.signal));
  check();
  const document = {
    format: 'manabi-reader-bridge-recovery',
    version: 1,
    accountId: scope.accountId,
    entries
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
  const document = object(JSON.parse(json), ['format', 'version', 'accountId', 'entries']);
  if (
    document.format !== 'manabi-reader-bridge-recovery' ||
    document.version !== 1 ||
    document.accountId !== scope.accountId ||
    !Array.isArray(document.entries) ||
    document.entries.length > READER_BRIDGE_JOURNAL_LIMITS.entries
  )
    fail();
  const restored = new Map<string, ReaderBridgeJournalRecord>();
  for (const value of document.entries) {
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
  return transaction(db, scope, async (tx, stillCurrent) => {
    const additions: ReaderBridgeJournalRecord[] = [];
    for (const row of restored.values()) {
      const existing = await tx.store.get(row.id);
      if (existing) {
        if (
          existing.accountId !== scope.accountId ||
          existing.phase !== 'restored' ||
          canonical(existing.entry) !== canonical(row.entry)
        )
          fail('stale');
      } else additions.push(row);
    }
    await capacity(tx, scope.accountId, additions);
    for (const row of additions) {
      stillCurrent();
      await tx.store.add(row);
    }
    return additions.length;
  });
}
