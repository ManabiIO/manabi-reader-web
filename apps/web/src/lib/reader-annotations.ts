/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database } from '$lib/data/store';
import { get } from 'svelte/store';
import { account, currentUser } from '$lib/manabi/client';
import type {
  ReaderAnnotation,
  ReaderAnnotationMutation
} from '$lib/data/database/books-db/versions/v7/books-db-v7';

export type AnnotationDraft = Pick<ReaderAnnotation, 'bookKey' | 'kind' | 'targets'> &
  Partial<Pick<ReaderAnnotation, 'id' | 'body' | 'label' | 'color' | 'decoration'>>;

const maxBodyLength = 64 * 1024;
const maxLabelLength = 512;
const maxImportBytes = 16 * 1024 * 1024;
const maxImportRecords = 10_000;
const portableId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertCurrentAccount(accountId: string | null) {
  if ((currentUser()?.id ?? null) !== accountId) throw new Error('The account changed.');
}

async function visibleAnnotations(records: ReaderAnnotation[]): Promise<ReaderAnnotation[]> {
  if (get(account).status === 'loading') return [];
  const accountId = currentUser()?.id ?? null;
  if (!accountId) return records;
  const db = await database.db;
  const owners = await Promise.all(
    records.map((record) => db.get('readerAnnotationScope', record.id))
  );
  assertCurrentAccount(accountId);
  return records.filter((_, index) => !owners[index] || owners[index]?.accountId === accountId);
}

async function bookAccount(bookKey: string): Promise<string | null> {
  if (!bookKey.startsWith('content:')) return null;
  const db = await database.db;
  const owners = new Set<string>();
  for (const book of await db.getAll('data')) {
    if (`content:${book.contentHash?.toLowerCase()}` !== bookKey) continue;
    const scope = await db.get('readerBookScope', book.id);
    if (scope) owners.add(scope.accountId);
  }
  return owners.size === 1 ? [...owners][0] : null;
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
  for (const target of value.targets) {
    if (
      !isRecord(target) ||
      target.version !== 1 ||
      target.bookKey !== value.bookKey ||
      !isRecord(target.resource) ||
      !boundedString(target.resource.href, 2048) ||
      !target.resource.href ||
      !boundedString(target.resource.sectionId, 256) ||
      !Number.isSafeInteger(target.resource.spineIndex) ||
      Number(target.resource.spineIndex) < 0 ||
      !Number.isSafeInteger(target.projectionVersion) ||
      Number(target.projectionVersion) < 1 ||
      !boundedString(target.resourceDigest, 128) ||
      !Number.isSafeInteger(target.start) ||
      Number(target.start) < 0 ||
      !Number.isSafeInteger(target.end) ||
      Number(target.end) < Number(target.start) ||
      !boundedString(target.quote, maxBodyLength) ||
      !boundedString(target.prefix, 256) ||
      !boundedString(target.suffix, 256)
    )
      throw new Error('The archive contains an invalid reading location.');
  }
  const annotation = value as unknown as ReaderAnnotation;
  validate(annotation);
  if (new TextEncoder().encode(JSON.stringify(annotation)).byteLength > 320 * 1024)
    throw new Error('An annotation exceeds the account sync size limit.');
  return {
    id: annotation.id,
    bookKey: annotation.bookKey,
    kind: annotation.kind,
    targets: annotation.targets.map((target) => ({
      version: 1,
      bookKey: target.bookKey,
      resource: {
        href: target.resource.href,
        spineIndex: target.resource.spineIndex,
        sectionId: target.resource.sectionId
      },
      projectionVersion: target.projectionVersion,
      resourceDigest: target.resourceDigest,
      start: target.start,
      end: target.end,
      quote: target.quote,
      prefix: target.prefix,
      suffix: target.suffix
    })),
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
  accountId: string | null = currentUser()?.id ?? null
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
  const boundAccounts = await Promise.all(
    incoming.map((annotation) => bookAccount(annotation.bookKey))
  );
  const db = await database.db;
  const tx = db.transaction(
    ['readerAnnotation', 'readerAnnotationOutbox', 'readerConflict', 'readerAnnotationScope'],
    'readwrite'
  );
  const result = { imported: 0, alreadyPresent: 0, conflicts: 0 };
  try {
    for (const [index, annotation] of incoming.entries()) {
      assertCurrentAccount(accountId);
      const boundAccount = accountId ?? boundAccounts[index];
      const existing = await tx.objectStore('readerAnnotation').get(annotation.id);
      const owner = existing
        ? await tx.objectStore('readerAnnotationScope').get(annotation.id)
        : undefined;
      if (accountId && owner && owner.accountId !== accountId)
        throw new Error('This annotation belongs to another account.');
      if (existing) {
        if (
          !existing.deletedAt &&
          JSON.stringify(validateImportedAnnotation(existing)) === JSON.stringify(annotation)
        )
          result.alreadyPresent += 1;
        else {
          // A repeated import updates the same reviewable conflict, not a new copy.
          await tx.objectStore('readerConflict').put({
            id: `import:${annotation.id}`,
            bookKey: annotation.bookKey,
            local: existing,
            remote: annotation
          });
          result.conflicts += 1;
        }
        continue;
      }
      await tx.objectStore('readerAnnotation').put(annotation);
      if (boundAccount)
        await tx
          .objectStore('readerAnnotationScope')
          .put({ annotationId: annotation.id, accountId: boundAccount });
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
      }
      result.imported += 1;
    }
    await tx.done;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* The transaction may already have settled. */
    }
    await tx.done.catch(() => undefined);
    throw error;
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
  accountId: string | null = currentUser()?.id ?? null
): Promise<void> {
  assertCurrentAccount(accountId);
  if (!id.startsWith('import:')) throw new Error('Invalid archive conflict.');
  const db = await database.db;
  const tx = db.transaction(
    ['readerAnnotation', 'readerAnnotationOutbox', 'readerConflict', 'readerAnnotationScope'],
    'readwrite'
  );
  const conflict = await tx.objectStore('readerConflict').get(id);
  if (!conflict) return;
  const existingOwner = await tx.objectStore('readerAnnotationScope').get(conflict.local.id);
  if (accountId && existingOwner && existingOwner.accountId !== accountId)
    throw new Error('This annotation belongs to another account.');
  const current = await tx.objectStore('readerAnnotation').get(conflict.local.id);
  if (
    !current ||
    current.revision !== conflict.local.revision ||
    current.modifiedAt !== conflict.local.modifiedAt
  )
    throw new Error(
      'The local note changed. Import the archive again to review the latest version.'
    );
  if (choice === 'restore-archive') {
    const value: ReaderAnnotation = {
      ...conflict.remote,
      revision: current.revision + 1,
      modifiedAt: new Date().toISOString(),
      deletedAt: undefined
    };
    await tx.objectStore('readerAnnotation').put(value);
    const owner = await tx.objectStore('readerAnnotationScope').get(value.id);
    if (accountId && !owner)
      await tx.objectStore('readerAnnotationScope').put({ annotationId: value.id, accountId });
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
    }
  }
  await tx.objectStore('readerConflict').delete(id);
  await tx.done;
}

function validate(draft: AnnotationDraft) {
  if (!/^(content:[a-f0-9]{64}|local:[0-9a-f-]{36})$/.test(draft.bookKey))
    throw new Error('A verified book identity is required.');
  if (!['bookmark', 'highlight', 'note'].includes(draft.kind))
    throw new Error('Invalid annotation type.');
  if (!draft.targets.length || draft.targets.length > 32)
    throw new Error('An annotation needs one to 32 source targets.');
  if (draft.kind !== 'bookmark' && draft.targets.every((target) => target.start === target.end))
    throw new Error('Select text before adding a highlight or note.');
  if ((draft.body?.length ?? 0) > maxBodyLength || (draft.label?.length ?? 0) > maxLabelLength)
    throw new Error('The annotation is too large.');
}

/** Local write and optional account-bound mutation are one IndexedDB transaction. */
export async function saveReaderAnnotation(
  draft: AnnotationDraft,
  accountId: string | null = currentUser()?.id ?? null
): Promise<ReaderAnnotation> {
  assertCurrentAccount(accountId);
  validate(draft);
  const db = await database.db;
  const savedOwner = draft.id
    ? (await db.get('readerAnnotationScope', draft.id))?.accountId
    : undefined;
  if (accountId && savedOwner && savedOwner !== accountId)
    throw new Error('This annotation belongs to another account.');
  const boundAccount = savedOwner ?? accountId ?? (await bookAccount(draft.bookKey));
  assertCurrentAccount(accountId);
  const tx = db.transaction(
    ['readerAnnotation', 'readerAnnotationOutbox', 'readerAnnotationScope'],
    'readwrite'
  );
  const id = draft.id ?? crypto.randomUUID();
  const previous = await tx.objectStore('readerAnnotation').get(id);
  const owner = await tx.objectStore('readerAnnotationScope').get(id);
  assertCurrentAccount(accountId);
  if (accountId && owner && owner.accountId !== accountId)
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
  await tx.objectStore('readerAnnotation').put(value);
  if (boundAccount && !owner)
    await tx
      .objectStore('readerAnnotationScope')
      .put({ annotationId: id, accountId: boundAccount });
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
  }
  await tx.done;
  return value;
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
  accountId: string | null = currentUser()?.id ?? null
) {
  assertCurrentAccount(accountId);
  const db = await database.db;
  const tx = db.transaction(
    ['readerAnnotation', 'readerAnnotationOutbox', 'readerAnnotationScope'],
    'readwrite'
  );
  const current = await tx.objectStore('readerAnnotation').get(id);
  if (!current || current.deletedAt) return;
  const owner = await tx.objectStore('readerAnnotationScope').get(id);
  assertCurrentAccount(accountId);
  if (accountId && owner && owner.accountId !== accountId)
    throw new Error('This annotation belongs to another account.');
  const boundAccount = owner?.accountId ?? accountId;
  const modifiedAt = new Date().toISOString();
  const value = {
    ...current,
    revision: current.revision + 1,
    modifiedAt,
    deletedAt: modifiedAt
  };
  await tx.objectStore('readerAnnotation').put(value);
  if (boundAccount && !owner)
    await tx
      .objectStore('readerAnnotationScope')
      .put({ annotationId: id, accountId: boundAccount });
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
  }
  await tx.done;
}
