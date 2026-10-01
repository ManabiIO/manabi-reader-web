/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database } from '$lib/data/store';
import { get } from 'svelte/store';
import { account, localProfileUser } from '$lib/manabi/client';
import type {
  ReaderAnnotation,
  ReaderAnnotationMutation
} from '$lib/data/database/books-db/versions/v7/books-db-v7';
import { snapshotReaderLocator } from '$lib/reader-location';
import { readIndexedBookMetadata } from '$lib/data/database/books-db/content-hash-index';
import { commitTransaction } from '$lib/data/database/books-db/commit-transaction.mjs';
import { captureLibraryOperation } from '$lib/manabi/operation-scope';

export type AnnotationDraft = Pick<ReaderAnnotation, 'bookKey' | 'kind' | 'targets'> &
  Partial<Pick<ReaderAnnotation, 'id' | 'body' | 'label' | 'color' | 'decoration'>>;

const maxBodyLength = 64 * 1024;
const maxLabelLength = 512;
const maxImportBytes = 16 * 1024 * 1024;
const maxImportRecords = 10_000;
const portableId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertCurrentAccount(accountId: string | null) {
  if ((localProfileUser()?.id ?? null) !== accountId) throw new Error('The account changed.');
}

function annotationOperation(accountId: string | null) {
  const scope = captureLibraryOperation();
  const assertCurrent = () => {
    scope.assertCurrent();
    if (scope.profileId !== accountId) throw new Error('The account changed.');
  };
  try {
    assertCurrent();
    return { ...scope, assertCurrent };
  } catch (error) {
    scope.stop();
    throw error;
  }
}

function bindTransactionLifetime(transaction: { abort(): void }, signal: AbortSignal): () => void {
  const abort = () => {
    try {
      transaction.abort();
    } catch {
      /* The transaction may already have settled. */
    }
  };
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

async function commitAnnotationTransaction<T>(
  transaction: { abort(): void; done: Promise<unknown> },
  operation: ReturnType<typeof annotationOperation>,
  work: () => Promise<T>
): Promise<T> {
  const unbind = bindTransactionLifetime(transaction, operation.signal);
  try {
    const result = await commitTransaction(transaction, async () => {
      const value = await work();
      operation.assertCurrent();
      return value;
    });
    operation.assertCurrent();
    return result;
  } finally {
    unbind();
  }
}

async function visibleAnnotations(records: ReaderAnnotation[]): Promise<ReaderAnnotation[]> {
  if (get(account).status === 'loading') return [];
  const accountId = localProfileUser()?.id ?? null;
  const db = await database.db;
  const owners = await Promise.all(
    records.map((record) => db.get('readerAnnotationScope', record.id))
  );
  const bookOwners = await bookAccounts(
    records.filter((_, index) => !owners[index]).map((record) => record.bookKey)
  );
  const effectiveOwners = records.map((record, index) =>
    owners[index] ? owners[index].accountId : bookOwners.get(record.bookKey)
  );
  assertCurrentAccount(accountId);
  return records.filter(
    (_, index) =>
      effectiveOwners[index] !== undefined &&
      (!effectiveOwners[index] || effectiveOwners[index] === accountId)
  );
}

interface BookScopeStore {
  getAll(): Promise<{ bookId: number; accountId: string }[]>;
}

/** Undefined means copies belong to multiple accounts, so access is ambiguous.
 * Resolve all requested content keys from one compact index inventory.
 */
async function bookAccountsFromStores(
  bookKeys: readonly string[],
  books: Parameters<typeof readIndexedBookMetadata>[0],
  scopes: BookScopeStore
): Promise<Map<string, string | null | undefined>> {
  const requested = [...new Set(bookKeys)];
  const result = new Map<string, string | null | undefined>();
  const content = new Set(requested.filter((key) => key.startsWith('content:')));
  for (const key of requested) if (!content.has(key)) result.set(key, null);
  if (!content.size) return result;

  const [metadata, scopeRows] = await Promise.all([
    readIndexedBookMetadata(books),
    scopes.getAll()
  ]);
  const scopeByBook = new Map(scopeRows.map((scope) => [scope.bookId, scope.accountId]));
  const owners = new Map<string, Set<string>>();
  const invalid = new Set<string>();
  for (const book of metadata) {
    const key = `content:${book.contentHash}`;
    if (!content.has(key)) continue;
    if (book.invalidOwner) {
      invalid.add(key);
      continue;
    }
    const values = owners.get(key) ?? new Set<string>();
    const scope = scopeByBook.get(book.id);
    if (scope) values.add(scope);
    if (book.libraryOwner) values.add(book.libraryOwner);
    owners.set(key, values);
  }
  for (const key of content) {
    if (invalid.has(key)) {
      result.set(key, undefined);
      continue;
    }
    const values = owners.get(key) ?? new Set<string>();
    result.set(key, values.size === 1 ? [...values][0] : values.size === 0 ? null : undefined);
  }
  return result;
}

async function bookAccountFromStores(
  bookKey: string,
  books: Parameters<typeof readIndexedBookMetadata>[0],
  scopes: BookScopeStore
): Promise<string | null | undefined> {
  return (await bookAccountsFromStores([bookKey], books, scopes)).get(bookKey);
}

async function bookAccounts(
  bookKeys: readonly string[]
): Promise<Map<string, string | null | undefined>> {
  const db = await database.db;
  const tx = db.transaction(['data', 'readerBookScope']);
  return commitTransaction(tx, () =>
    bookAccountsFromStores(bookKeys, tx.objectStore('data'), tx.objectStore('readerBookScope'))
  );
}

export interface ReaderAnnotationArchive {
  format: 'manabi-reader-annotations';
  version: 1;
  annotations: ReaderAnnotation[];
}

export interface AnnotationImportResult {
  imported: number;
  alreadyPresent: number;
  conflicts: number;
}

export interface AnnotationImportConflict {
  id: string;
  bookKey: string;
  local: ReaderAnnotation;
  remote: ReaderAnnotation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

export function validateImportedAnnotation(value: unknown): ReaderAnnotation {
  if (
    !isRecord(value) ||
    !boundedString(value.id, 128) ||
    !value.id ||
    Object.keys(value).some(
      (key) =>
        ![
          'id',
          'bookKey',
          'kind',
          'targets',
          'body',
          'label',
          'color',
          'decoration',
          'createdAt',
          'modifiedAt',
          'revision',
          'deletedAt'
        ].includes(key)
    ) ||
    !boundedString(value.bookKey, 80) ||
    !/^(content:[a-f0-9]{64}|local:[0-9a-f-]{36})$/.test(value.bookKey) ||
    !['bookmark', 'highlight', 'note'].includes(String(value.kind)) ||
    !Array.isArray(value.targets) ||
    !value.targets.length ||
    value.targets.length > 32 ||
    !boundedString(value.createdAt, 64) ||
    !boundedString(value.modifiedAt, 64) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    (value.body !== undefined && !boundedString(value.body, maxBodyLength)) ||
    (value.label !== undefined && !boundedString(value.label, maxLabelLength)) ||
    (value.color !== undefined &&
      !['yellow', 'blue', 'green', 'pink', 'purple'].includes(String(value.color))) ||
    (value.decoration !== undefined &&
      !['highlight', 'underline'].includes(String(value.decoration))) ||
    value.deletedAt !== undefined
  )
    throw new Error('The archive contains an invalid annotation.');
  const bookKey = value.bookKey;
  const targets = value.targets.map((target) => {
    if (
      !isRecord(target) ||
      !boundedString(target.resourceDigest, 128) ||
      !boundedString(target.quote, maxBodyLength) ||
      !boundedString(target.prefix, 256) ||
      !boundedString(target.suffix, 256) ||
      !isRecord(target.resource) ||
      !boundedString(target.resource.href, 2048) ||
      !boundedString(target.resource.sectionId, 256)
    )
      throw new Error('The archive contains an invalid reading location.');
    const snapshot = snapshotReaderLocator(target, bookKey);
    if (!snapshot) throw new Error('The archive contains an invalid reading location.');
    return snapshot;
  });
  const annotation = value as unknown as ReaderAnnotation;
  validate(annotation);
  if (new TextEncoder().encode(JSON.stringify(annotation)).byteLength > 320 * 1024)
    throw new Error('An annotation exceeds the account sync size limit.');
  return {
    id: annotation.id,
    bookKey: annotation.bookKey,
    kind: annotation.kind,
    targets,
    body: annotation.body,
    label: annotation.label,
    color: annotation.color,
    decoration: annotation.decoration,
    createdAt: annotation.createdAt,
    modifiedAt: annotation.modifiedAt,
    revision: annotation.revision
  };
}

/** Portable JSON contains only annotation entities, never local sync envelopes. */
export async function exportReaderAnnotations(): Promise<string> {
  const db = await database.db;
  const annotations = await visibleAnnotations(
    (await db.getAll('readerAnnotation')).filter((value) => !value.deletedAt)
  );
  const archive: ReaderAnnotationArchive = {
    format: 'manabi-reader-annotations',
    version: 1,
    annotations
  };
  return JSON.stringify(archive, null, 2);
}

/** Validate the entire file before writing; conflicting IDs preserve the local copy. */
export async function importReaderAnnotations(
  json: string,
  accountId: string | null = localProfileUser()?.id ?? null
): Promise<AnnotationImportResult> {
  assertCurrentAccount(accountId);
  if (new TextEncoder().encode(json).byteLength > maxImportBytes)
    throw new Error('The annotation archive is too large.');
  const parsed: unknown = JSON.parse(json);
  if (
    !isRecord(parsed) ||
    parsed.format !== 'manabi-reader-annotations' ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.annotations) ||
    parsed.annotations.length > maxImportRecords
  )
    throw new Error('This is not a supported annotation archive.');
  const incoming = parsed.annotations.map(validateImportedAnnotation);
  if (new Set(incoming.map((value) => value.id)).size !== incoming.length)
    throw new Error('The archive contains duplicate annotation IDs.');

  const operation = annotationOperation(accountId);
  try {
    const db = await database.db;
    operation.assertCurrent();
    const tx = db.transaction(
      [
        'data',
        'readerBookScope',
        'readerAnnotation',
        'readerAnnotationOutbox',
        'readerConflict',
        'readerAnnotationScope'
      ],
      'readwrite'
    );
    const result = { imported: 0, alreadyPresent: 0, conflicts: 0 };
    return await commitAnnotationTransaction(tx, operation, async () => {
      const ownerByBook = await bookAccountsFromStores(
        incoming.map((annotation) => annotation.bookKey),
        tx.objectStore('data'),
        tx.objectStore('readerBookScope')
      );
      operation.assertCurrent();
      for (const annotation of incoming) {
        operation.assertCurrent();
        const bookOwner = ownerByBook.get(annotation.bookKey);
        if (bookOwner === undefined)
          throw new Error('This annotation has ambiguous account ownership.');
        if (bookOwner && bookOwner !== accountId)
          throw new Error('This annotation belongs to another account.');
        const existing = await tx.objectStore('readerAnnotation').get(annotation.id);
        const owner = existing
          ? await tx.objectStore('readerAnnotationScope').get(annotation.id)
          : undefined;
        operation.assertCurrent();
        if (owner && owner.accountId !== accountId)
          throw new Error('This annotation belongs to another account.');
        const boundAccount = owner?.accountId ?? bookOwner ?? accountId;
        if (boundAccount && boundAccount !== accountId)
          throw new Error('This annotation belongs to another account.');
        if (existing) {
          if (existing.bookKey !== annotation.bookKey)
            throw new Error('An annotation ID cannot refer to another book.');
          if (
            !existing.deletedAt &&
            JSON.stringify(validateImportedAnnotation(existing)) === JSON.stringify(annotation)
          )
            result.alreadyPresent += 1;
          else {
            await tx.objectStore('readerConflict').put({
              id: `import:${annotation.id}`,
              bookKey: annotation.bookKey,
              local: existing,
              remote: annotation
            });
            operation.assertCurrent();
            result.conflicts += 1;
          }
          continue;
        }
        await tx.objectStore('readerAnnotation').put(annotation);
        operation.assertCurrent();
        if (boundAccount)
          await tx
            .objectStore('readerAnnotationScope')
            .put({ annotationId: annotation.id, accountId: boundAccount });
        operation.assertCurrent();
        if (
          boundAccount &&
          annotation.bookKey.startsWith('content:') &&
          portableId.test(annotation.id)
        ) {
          const mutation: ReaderAnnotationMutation = {
            id: crypto.randomUUID(),
            accountId: boundAccount,
            bookKey: annotation.bookKey,
            annotationId: annotation.id,
            baseRevision: 0,
            localRevision: annotation.revision,
            value: annotation,
            createdAt: new Date().toISOString()
          };
          await tx.objectStore('readerAnnotationOutbox').put(mutation);
          operation.assertCurrent();
        }
        result.imported += 1;
      }
      return result;
    });
  } finally {
    operation.stop();
  }
}

export async function listAnnotationImportConflicts(
  bookKey: string
): Promise<AnnotationImportConflict[]> {
  const db = await database.db;
  const conflicts = await db.getAllFromIndex('readerConflict', 'bookKey', bookKey);
  const imported = conflicts.filter((value) => value.id.startsWith('import:'));
  const visible = await visibleAnnotations(imported.map((value) => value.local));
  const ids = new Set(visible.map((value) => value.id));
  return imported.filter((value) => ids.has(value.local.id));
}

export async function resolveAnnotationImportConflict(
  id: string,
  choice: 'keep-local' | 'restore-archive',
  accountId: string | null = localProfileUser()?.id ?? null
): Promise<void> {
  assertCurrentAccount(accountId);
  if (!id.startsWith('import:')) throw new Error('Invalid archive conflict.');
  const operation = annotationOperation(accountId);
  try {
    const db = await database.db;
    operation.assertCurrent();
    const tx = db.transaction(
      [
        'data',
        'readerBookScope',
        'readerAnnotation',
        'readerAnnotationOutbox',
        'readerConflict',
        'readerAnnotationScope'
      ],
      'readwrite'
    );
    await commitAnnotationTransaction(tx, operation, async () => {
      const conflict = await tx.objectStore('readerConflict').get(id);
      operation.assertCurrent();
      if (!conflict) return;
      if (id !== `import:${conflict.local.id}`) throw new Error('Invalid archive conflict.');
      const [existingOwner, current] = await Promise.all([
        tx.objectStore('readerAnnotationScope').get(conflict.local.id),
        tx.objectStore('readerAnnotation').get(conflict.local.id)
      ]);
      operation.assertCurrent();
      if (existingOwner && existingOwner.accountId !== accountId)
        throw new Error('This annotation belongs to another account.');
      if (current) {
        const bookOwner = await bookAccountFromStores(
          current.bookKey,
          tx.objectStore('data'),
          tx.objectStore('readerBookScope')
        );
        operation.assertCurrent();
        if (bookOwner === undefined)
          throw new Error('This annotation has ambiguous account ownership.');
        if (bookOwner && bookOwner !== accountId)
          throw new Error('This annotation belongs to another account.');
      }
      if (
        !current ||
        current.revision !== conflict.local.revision ||
        current.modifiedAt !== conflict.local.modifiedAt
      )
        throw new Error(
          'The local note changed. Import the archive again to review the latest version.'
        );

      if (choice === 'restore-archive') {
        const remote = validateImportedAnnotation(conflict.remote);
        if (
          conflict.local.bookKey !== current.bookKey ||
          remote.id !== current.id ||
          remote.bookKey !== current.bookKey
        )
          throw new Error('An annotation cannot move to another book.');
        const value: ReaderAnnotation = {
          ...remote,
          revision: current.revision + 1,
          modifiedAt: new Date().toISOString(),
          deletedAt: undefined
        };
        await tx.objectStore('readerAnnotation').put(value);
        operation.assertCurrent();
        const owner = await tx.objectStore('readerAnnotationScope').get(value.id);
        operation.assertCurrent();
        if (accountId && !owner)
          await tx.objectStore('readerAnnotationScope').put({ annotationId: value.id, accountId });
        operation.assertCurrent();
        if (
          accountId &&
          (!owner || owner.accountId === accountId) &&
          value.bookKey.startsWith('content:') &&
          portableId.test(value.id)
        ) {
          await tx.objectStore('readerAnnotationOutbox').put({
            id: crypto.randomUUID(),
            accountId,
            bookKey: value.bookKey,
            annotationId: value.id,
            baseRevision: current.revision,
            localRevision: value.revision,
            value,
            createdAt: value.modifiedAt
          });
          operation.assertCurrent();
        }
      }
      await tx.objectStore('readerConflict').delete(id);
      operation.assertCurrent();
    });
  } finally {
    operation.stop();
  }
}

function snapshotDraft(draft: AnnotationDraft): AnnotationDraft {
  if (!draft || typeof draft !== 'object') throw new Error('Invalid annotation.');
  const bookKey = draft.bookKey;
  if (typeof bookKey !== 'string') throw new Error('A verified book identity is required.');
  const targets = Array.isArray(draft.targets)
    ? draft.targets.map((target) => {
        const snapshot = snapshotReaderLocator(target, bookKey);
        if (!snapshot) throw new Error('The annotation contains an invalid reading location.');
        return snapshot;
      })
    : [];
  return {
    bookKey,
    kind: draft.kind,
    targets,
    ...(draft.id === undefined ? {} : { id: draft.id }),
    ...(draft.body === undefined ? {} : { body: draft.body }),
    ...(draft.label === undefined ? {} : { label: draft.label }),
    ...(draft.color === undefined ? {} : { color: draft.color }),
    ...(draft.decoration === undefined ? {} : { decoration: draft.decoration })
  };
}

function validate(draft: AnnotationDraft) {
  if (!/^(content:[a-f0-9]{64}|local:[0-9a-f-]{36})$/.test(draft.bookKey))
    throw new Error('A verified book identity is required.');
  if (!['bookmark', 'highlight', 'note'].includes(draft.kind))
    throw new Error('Invalid annotation type.');
  if (!draft.targets.length || draft.targets.length > 32)
    throw new Error('An annotation needs one to 32 source targets.');
  if (draft.targets.some((target) => target.bookKey !== draft.bookKey))
    throw new Error('An annotation target belongs to another book.');
  if (draft.kind !== 'bookmark' && draft.targets.every((target) => target.start === target.end))
    throw new Error('Select text before adding a highlight or note.');
  if (draft.id !== undefined && (!boundedString(draft.id, 128) || !draft.id))
    throw new Error('Invalid annotation ID.');
  if (draft.body !== undefined && !boundedString(draft.body, maxBodyLength))
    throw new Error('The annotation is too large.');
  if (draft.label !== undefined && !boundedString(draft.label, maxLabelLength))
    throw new Error('The annotation is too large.');
  if (
    draft.color !== undefined &&
    !['yellow', 'blue', 'green', 'pink', 'purple'].includes(draft.color)
  )
    throw new Error('Invalid annotation color.');
  if (draft.decoration !== undefined && !['highlight', 'underline'].includes(draft.decoration))
    throw new Error('Invalid annotation decoration.');
}

/** Local write and optional account-bound mutation are one IndexedDB transaction. */
export async function saveReaderAnnotation(
  draft: AnnotationDraft,
  accountId: string | null = localProfileUser()?.id ?? null
): Promise<ReaderAnnotation> {
  draft = snapshotDraft(draft);
  assertCurrentAccount(accountId);
  validate(draft);
  const operation = annotationOperation(accountId);
  try {
    const db = await database.db;
    operation.assertCurrent();
    const tx = db.transaction(
      [
        'data',
        'readerBookScope',
        'readerAnnotation',
        'readerAnnotationOutbox',
        'readerAnnotationScope'
      ],
      'readwrite'
    );
    return await commitAnnotationTransaction(tx, operation, async () => {
      const id = draft.id ?? crypto.randomUUID();
      const [previous, owner, bookOwner] = await Promise.all([
        tx.objectStore('readerAnnotation').get(id),
        tx.objectStore('readerAnnotationScope').get(id),
        bookAccountFromStores(
          draft.bookKey,
          tx.objectStore('data'),
          tx.objectStore('readerBookScope')
        )
      ]);
      operation.assertCurrent();
      if (owner && owner.accountId !== accountId)
        throw new Error('This annotation belongs to another account.');
      if (bookOwner === undefined)
        throw new Error('This annotation has ambiguous account ownership.');
      if (bookOwner && bookOwner !== accountId)
        throw new Error('This annotation belongs to another account.');
      const boundAccount = owner?.accountId ?? bookOwner ?? accountId;
      if (boundAccount && boundAccount !== accountId)
        throw new Error('This annotation belongs to another account.');
      if (previous && previous.bookKey !== draft.bookKey)
        throw new Error('An annotation cannot move to another book.');

      const modifiedAt = new Date().toISOString();
      const value: ReaderAnnotation = {
        ...previous,
        ...draft,
        id,
        createdAt: previous?.createdAt ?? modifiedAt,
        modifiedAt,
        revision: (previous?.revision ?? 0) + 1,
        deletedAt: undefined
      };
      if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 320 * 1024)
        throw new Error('The annotation is too large to sync.');

      operation.assertCurrent();
      await tx.objectStore('readerAnnotation').put(value);
      operation.assertCurrent();
      if (boundAccount && !owner)
        await tx
          .objectStore('readerAnnotationScope')
          .put({ annotationId: id, accountId: boundAccount });
      operation.assertCurrent();
      if (
        boundAccount &&
        (!owner || owner.accountId === boundAccount) &&
        value.bookKey.startsWith('content:') &&
        portableId.test(value.id)
      ) {
        const mutation: ReaderAnnotationMutation = {
          id: crypto.randomUUID(),
          accountId: boundAccount,
          bookKey: value.bookKey,
          annotationId: id,
          baseRevision: previous?.revision ?? 0,
          localRevision: value.revision,
          value,
          createdAt: modifiedAt
        };
        await tx.objectStore('readerAnnotationOutbox').put(mutation);
        operation.assertCurrent();
      }
      return value;
    });
  } finally {
    operation.stop();
  }
}

export async function listReaderAnnotations(bookKey: string): Promise<ReaderAnnotation[]> {
  const db = await database.db;
  const records = await db.getAllFromIndex('readerAnnotation', 'bookKey', bookKey);
  return (await visibleAnnotations(records.filter((record) => !record.deletedAt))).sort((a, b) => {
    const firstA = a.targets[0];
    const firstB = b.targets[0];
    return (
      firstA.resource.spineIndex - firstB.resource.spineIndex ||
      firstA.start - firstB.start ||
      a.createdAt.localeCompare(b.createdAt)
    );
  });
}

export async function removeReaderAnnotation(
  id: string,
  accountId: string | null = localProfileUser()?.id ?? null
) {
  assertCurrentAccount(accountId);
  const operation = annotationOperation(accountId);
  try {
    const db = await database.db;
    operation.assertCurrent();
    const tx = db.transaction(
      [
        'data',
        'readerBookScope',
        'readerAnnotation',
        'readerAnnotationOutbox',
        'readerAnnotationScope'
      ],
      'readwrite'
    );
    await commitAnnotationTransaction(tx, operation, async () => {
      const current = await tx.objectStore('readerAnnotation').get(id);
      operation.assertCurrent();
      if (!current || current.deletedAt) return;
      const [owner, bookOwner] = await Promise.all([
        tx.objectStore('readerAnnotationScope').get(id),
        bookAccountFromStores(
          current.bookKey,
          tx.objectStore('data'),
          tx.objectStore('readerBookScope')
        )
      ]);
      operation.assertCurrent();
      if (owner && owner.accountId !== accountId)
        throw new Error('This annotation belongs to another account.');
      if (bookOwner === undefined)
        throw new Error('This annotation has ambiguous account ownership.');
      if (bookOwner && bookOwner !== accountId)
        throw new Error('This annotation belongs to another account.');
      const boundAccount = owner?.accountId ?? bookOwner ?? accountId;
      if (boundAccount && boundAccount !== accountId)
        throw new Error('This annotation belongs to another account.');

      const modifiedAt = new Date().toISOString();
      const value = {
        ...current,
        revision: current.revision + 1,
        modifiedAt,
        deletedAt: modifiedAt
      };
      await tx.objectStore('readerAnnotation').put(value);
      operation.assertCurrent();
      if (boundAccount && !owner)
        await tx
          .objectStore('readerAnnotationScope')
          .put({ annotationId: id, accountId: boundAccount });
      operation.assertCurrent();
      if (
        boundAccount &&
        (!owner || owner.accountId === boundAccount) &&
        value.bookKey.startsWith('content:') &&
        portableId.test(value.id)
      ) {
        await tx.objectStore('readerAnnotationOutbox').put({
          id: crypto.randomUUID(),
          accountId: boundAccount,
          bookKey: value.bookKey,
          annotationId: id,
          baseRevision: current.revision,
          localRevision: value.revision,
          value,
          createdAt: modifiedAt
        });
        operation.assertCurrent();
      }
    });
  } finally {
    operation.stop();
  }
}
