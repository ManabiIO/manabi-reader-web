/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { database } from '$lib/data/store';
import { currentUser } from './client';
import { exclusive } from './persistence';
import { canonical, MigrationConflict, record } from './ttu-migration-format';
import {
  studyEntries,
  locateStudy,
  studyComparable,
  validImportedStudy,
  type ImportedStudy,
  type ImportedStudyEntry,
  type StudyKind
} from './yatsu-study-format';
import { projectPublication } from '$lib/reader-location';
import type { ReaderAnnotation } from '$lib/data/database/books-db/versions/v7/books-db-v7';

function assertOwner(owner: string | null) {
  if ((currentUser()?.id ?? null) !== owner) throw new Error('The account changed.');
}
export async function readImportedStudy(bookId: number): Promise<ImportedStudy | undefined> {
  const owner = currentUser()?.id ?? null;
  const db = await database.db;
  const tx = db.transaction(['data', 'readerBookScope']);
  const book = await tx.objectStore('data').get(bookId);
  const scope = await tx.objectStore('readerBookScope').get(bookId);
  await tx.done;
  assertOwner(owner);
  if (scope && scope.accountId !== owner) throw new Error('This book belongs to another account.');
  return validImportedStudy(book?.manabiImportedStudy) ? book.manabiImportedStudy : undefined;
}
function validEdits(value: Partial<ImportedStudyEntry>, kind: StudyKind) {
  for (const [key, item] of Object.entries(value)) {
    if (['title', 'note', ...(kind === 'notes' ? ['text'] : [])].includes(key)) {
      if (typeof item !== 'string' || item.length > (key === 'title' ? 4096 : 65_536))
        throw new Error('The imported note is too long.');
    } else if (key === 'color') {
      if (!['yellow', 'blue', 'green', 'pink', 'purple'].includes(String(item)))
        throw new Error('Invalid highlight color.');
    } else if (key !== 'deleted' || typeof item !== 'boolean')
      throw new Error('Unsupported imported-note change.');
  }
}
export async function editImportedStudy(
  bookId: number,
  id: string,
  expected: string,
  changes: Partial<ImportedStudyEntry>
): Promise<ImportedStudy> {
  const owner = currentUser()?.id ?? null;
  return exclusive('import-library-book', async () => {
    const db = await database.db;
    const tx = db.transaction(['data', 'readerBookScope'], 'readwrite');
    try {
      const book = await tx.objectStore('data').get(bookId);
      const scope = await tx.objectStore('readerBookScope').get(bookId);
      assertOwner(owner);
      if (scope && scope.accountId !== owner)
        throw new Error('This book belongs to another account.');
      if (!validImportedStudy(book?.manabiImportedStudy))
        throw new Error('Imported notes are unavailable.');
      const study = book.manabiImportedStudy;
      const entry = study.entries.find((entry) => entry.id === id);
      if (!entry || studyComparable(entry) !== expected)
        throw new Error('This note changed in another tab. Reopen the panel before editing.');
      validEdits(changes, entry.kind);
      Object.assign(entry, changes, { modifiedAt: Date.now() });
      await tx.objectStore('data').put({ ...book, manabiImportedStudy: study });
      assertOwner(owner);
      await tx.done;
      return study;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* completed */
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
  });
}
export function importedHighlights(study?: ImportedStudy): ReaderAnnotation[] {
  return (study?.entries ?? [])
    .filter((entry) => !entry.deleted && entry.kind === 'highlights' && entry.locator)
    .map((entry) => ({
      id: `yatsu:${entry.id}`,
      bookKey: entry.locator!.bookKey,
      kind: 'highlight',
      targets: [entry.locator!],
      body: entry.note,
      label: entry.title,
      color: entry.color,
      createdAt: new Date(entry.createdAt).toISOString(),
      modifiedAt: new Date(entry.modifiedAt).toISOString(),
      revision: 1
    }));
}
export function exportImportedStudy(study: ImportedStudy): string {
  return JSON.stringify({ format: 'manabi-yatsu-study', version: 1, study }, null, 2);
}
export async function restoreImportedStudy(
  bookId: number,
  text: string,
  replace = false
): Promise<ImportedStudy> {
  if (new TextEncoder().encode(text).length > 32 * 1024 * 1024)
    throw new Error('The imported-note archive is too large.');
  const envelope = record(JSON.parse(text), 'imported-note archive');
  if (
    envelope.format !== 'manabi-yatsu-study' ||
    envelope.version !== 1 ||
    !validImportedStudy(envelope.study)
  )
    throw new Error('Unsupported imported-note archive.');
  const incoming = envelope.study;
  const current = await readImportedStudy(bookId);
  if (
    !current ||
    current.fingerprint !== incoming.fingerprint ||
    current.sourceTitle !== incoming.sourceTitle
  )
    throw new Error('This archive belongs to another book or edition.');
  const owner = currentUser()?.id ?? null;
  const db = await database.db;
  const book = await db.get('data', bookId);
  if (!book || book.elementHtml.length > 32 * 1024 * 1024)
    throw new Error('Book content is unavailable.');
  const witness = canonical(current);
  const template = document.createElement('template');
  template.innerHTML = book.elementHtml;
  const resources = projectPublication(template.content, book.publicationManifest);
  const prepared: ImportedStudyEntry[] = [];
  const ids = new Set<string>();
  const identity = await db.get('readerLocalIdentity', bookId);
  const bookKey = book.contentHash
    ? `content:${book.contentHash.toLowerCase()}`
    : identity
      ? `local:${identity.uuid}`
      : undefined;
  if (!bookKey) throw new Error('The local book identity is unavailable.');
  for (const value of incoming.entries) {
    if (!['savedBookmarks', 'highlights', 'notes'].includes(value.kind))
      throw new Error('Invalid imported-note kind.');
    const [source] = await studyEntries(
      [value.source],
      value.kind,
      incoming.sourceTitle,
      value.createdAt
    );
    if (source.id !== value.id || ids.has(source.id))
      throw new Error('Invalid or duplicate imported-note identity.');
    ids.add(source.id);
    const edits: Partial<ImportedStudyEntry> = {
      title: value.title,
      note: value.note,
      color: value.color,
      ...(value.kind === 'notes' ? { text: value.text } : {}),
      ...(value.deleted !== undefined ? { deleted: value.deleted } : {})
    };
    validEdits(edits, value.kind);
    if (
      !Number.isFinite(value.modifiedAt) ||
      value.modifiedAt < 0 ||
      !Number.isFinite(new Date(value.modifiedAt).getTime())
    )
      throw new Error('Invalid note modification date.');
    const entry = await locateStudy(
      { ...source, ...edits, modifiedAt: value.modifiedAt },
      resources
    );
    if (entry.locator) entry.locator.bookKey = bookKey;
    prepared.push(entry);
  }
  return exclusive('import-library-book', async () => {
    const tx = db.transaction(['data', 'readerBookScope'], 'readwrite');
    try {
      const fresh = await tx.objectStore('data').get(bookId);
      const scope = await tx.objectStore('readerBookScope').get(bookId);
      assertOwner(owner);
      if (scope && scope.accountId !== owner)
        throw new Error('This book belongs to another account.');
      if (
        !fresh ||
        fresh.elementHtml !== book.elementHtml ||
        canonical(fresh.manabiImportedStudy) !== witness
      )
        throw new Error('The book or its notes changed. Retry the restore.');
      const study = structuredClone(current);
      for (const entry of prepared) {
        const index = study.entries.findIndex((item) => item.id === entry.id);
        if (
          index >= 0 &&
          studyComparable(study.entries[index]) !== studyComparable(entry) &&
          !replace
        )
          throw new MigrationConflict(
            'The archive differs from current imported notes. Review it, then explicitly allow replacement to restore.'
          );
        if (index < 0) study.entries.push(entry);
        else study.entries[index] = entry;
      }
      if (study.entries.length > 10_000 || JSON.stringify(study).length > 32 * 1024 * 1024)
        throw new Error('The combined imported-note archive is too large.');
      await tx.objectStore('data').put({ ...fresh, manabiImportedStudy: study });
      await tx.done;
      return study;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* completed */
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
  });
}
