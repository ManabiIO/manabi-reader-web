/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database } from '$lib/data/store';
import { currentUser } from './client';
import { canonical, MigrationConflict } from './ttu-migration-format';
import type { ReaderImportRecord } from '$lib/data/database/books-db/versions/v10/books-db-v10';
export function validateImportRecord(value: unknown): ReaderImportRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid imported notebook record.');
  const v = value as ReaderImportRecord;
  if (
    !/^[a-f0-9-]{36}$/.test(v.id) ||
    !/^(content:[a-f0-9]{64}|local:[a-f0-9-]{36})$/.test(v.bookKey) ||
    !['savedBookmarks', 'highlights', 'notes'].includes(v.part) ||
    !['anchored', 'book-note', 'unresolved'].includes(v.status) ||
    !v.source ||
    typeof v.source !== 'object' ||
    Array.isArray(v.source) ||
    [v.label, v.importedLabel].some((s) => typeof s !== 'string' || s.length > 512) ||
    [v.body, v.importedBody, v.quote].some((s) => typeof s !== 'string' || s.length > 65536) ||
    [v.createdAt, v.modifiedAt, ...(v.deletedAt ? [v.deletedAt] : [])].some(
      (s) => typeof s !== 'string' || s.length > 64 || !Number.isFinite(Date.parse(s))
    ) ||
    (v.reason !== undefined && (typeof v.reason !== 'string' || v.reason.length > 1024)) ||
    (v.annotationId !== undefined && v.annotationId !== v.id) ||
    (v.appliedAnnotation !== undefined &&
      (typeof v.appliedAnnotation !== 'string' || v.appliedAnnotation.length > 320 * 1024)) ||
    new TextEncoder().encode(JSON.stringify(value)).byteLength > 512 * 1024 ||
    v.sourceCanonical !== canonical(v.source)
  )
    throw new Error('Invalid or oversized imported notebook record.');
  // Deliberately do not return unknown top-level fields from user-controlled archives.
  return {
    id: v.id,
    bookId: v.bookId,
    bookKey: v.bookKey,
    accountId: v.accountId,
    part: v.part,
    source: v.source,
    sourceCanonical: v.sourceCanonical,
    annotationId: v.annotationId,
    appliedAnnotation: v.appliedAnnotation,
    status: v.status,
    reason: v.reason,
    label: v.label,
    body: v.body,
    quote: v.quote,
    importedBody: v.importedBody,
    importedLabel: v.importedLabel,
    createdAt: v.createdAt,
    modifiedAt: v.modifiedAt,
    deletedAt: v.deletedAt
  };
}
function checkOwner(owner: string | null) {
  if ((currentUser()?.id ?? null) !== owner) throw new Error('Account changed.');
}
export async function listImportedNotes(bookKey: string) {
  const owner = currentUser()?.id ?? null;
  const rows = await (await database.db).getAllFromIndex('readerImportRecord', 'bookKey', bookKey);
  checkOwner(owner);
  return rows.filter((row) => row.accountId === null || row.accountId === owner);
}
export async function editImportedNote(
  expected: ReaderImportRecord,
  body: string,
  label: string,
  deleted = false
) {
  const owner = currentUser()?.id ?? null;
  if (body.length > 65536 || label.length > 512) throw new Error('The note is too large.');
  const db = await database.db;
  const tx = db.transaction('readerImportRecord', 'readwrite');
  try {
    const value = await tx.store.get(expected.id);
    checkOwner(owner);
    if (!value || (value.accountId !== null && value.accountId !== owner))
      throw new Error('The imported note is not available in this account.');
    if (canonical(value) !== canonical(expected))
      throw new MigrationConflict(
        'This imported note changed since it was opened. Copy your draft, then reload the latest notes before editing or removing it.'
      );
    if (value.status === 'anchored')
      throw new Error('Edit the linked saved passage instead of its original import evidence.');
    const modifiedAt = new Date().toISOString();
    await tx.store.put({
      ...value,
      body,
      label,
      modifiedAt,
      deletedAt: deleted ? modifiedAt : undefined
    });
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already committed or aborted. */
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
export async function exportImportedNotes(bookId: number, bookKey: string) {
  const owner = currentUser()?.id ?? null,
    db = await database.db;
  const book = (await db.get('data', bookId)) as
    | { contentHash?: string; manabiTtuImport?: { content: string } }
    | undefined;
  const records = await listImportedNotes(bookKey);
  checkOwner(owner);
  return JSON.stringify(
    {
      format: 'manabi-reader-imported-notes',
      version: 1,
      bookKey,
      fingerprint: book?.manabiTtuImport?.content,
      contentHash: book?.contentHash,
      records: records.map(({ bookId: _id, accountId: _scope, ...value }) => value)
    },
    null,
    2
  );
}
export async function restoreImportedNotes(
  json: string,
  bookId: number,
  bookKey: string,
  replace = false
) {
  if (new TextEncoder().encode(json).byteLength > 16 * 1024 * 1024)
    throw new Error('Imported notes archive exceeds 16 MiB.');
  const document = JSON.parse(json),
    owner = currentUser()?.id ?? null;
  if (
    !document ||
    document.format !== 'manabi-reader-imported-notes' ||
    document.version !== 1 ||
    !Array.isArray(document.records) ||
    document.records.length > 10000
  )
    throw new Error('Unsupported imported-notes archive.');
  const records = document.records.map(validateImportRecord) as ReaderImportRecord[];
  if (
    new Set(records.map((r) => r.id)).size !== records.length ||
    records.some((r) => r.bookKey !== document.bookKey)
  )
    throw new Error('Conflicting notebook identities in archive.');
  const db = await database.db;
  const tx = db.transaction(
    ['data', 'readerImportRecord', 'readerBookScope', 'readerAnnotation', 'readerAnnotationScope'],
    'readwrite'
  );
  let changed = 0;
  try {
    const book = (await tx.objectStore('data').get(bookId)) as
      | { contentHash?: string; manabiTtuImport?: { content: string } }
      | undefined;
    const scope = await tx.objectStore('readerBookScope').get(bookId);
    checkOwner(owner);
    if (!book || (scope && scope.accountId !== owner))
      throw new Error('Destination book is not available.');
    if (
      document.bookKey !== bookKey &&
      !(book.contentHash && book.contentHash === document.contentHash) &&
      !(book.manabiTtuImport?.content && book.manabiTtuImport.content === document.fingerprint)
    )
      throw new Error('This notebook belongs to a different book.');
    for (const row of records) {
      const current = await tx.objectStore('readerImportRecord').get(row.id);
      const value = { ...row, bookId, bookKey, accountId: owner };
      const annotation = value.annotationId
        ? await tx.objectStore('readerAnnotation').get(value.annotationId)
        : undefined;
      const annotationScope = value.annotationId
        ? await tx.objectStore('readerAnnotationScope').get(value.annotationId)
        : undefined;
      if (
        value.status === 'anchored' &&
        (!value.annotationId ||
          !annotation ||
          annotation.bookKey !== bookKey ||
          (annotationScope && annotationScope.accountId !== owner))
      ) {
        value.status = 'unresolved';
        value.reason =
          'The saved passage archive has not been restored. Original text is retained here.';
        value.annotationId = undefined;
        value.appliedAnnotation = undefined;
      }
      if (current) {
        if (
          current.bookKey !== bookKey ||
          (current.accountId !== null && current.accountId !== owner)
        )
          throw new Error('The notebook identity belongs to another book or account.');
        if (canonical({ ...current, accountId: owner }) === canonical(value)) continue;
        if (!replace)
          throw new MigrationConflict(
            'A notebook record differs on this device. Review before choosing Use archive.'
          );
      }
      await tx.objectStore('readerImportRecord').put(value);
      changed++;
    }
    checkOwner(owner);
    await tx.done;
    return changed;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already committed or aborted. */
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
