/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { bookmark, statistics, canonical } from '../manabi/ttu-migration-format';
import { validateImportedAnnotation } from '../reader-annotations';
import { validateImportRecord } from '../manabi/imported-notes';
import type { ReaderAnnotation } from '../data/database/books-db/versions/v7/books-db-v7';
export interface DavDocument {
  format: 'manabi-reader-webdav';
  version: 1;
  bookKey: string;
  records: Record<string, unknown>;
}
export const wireCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function validateDavDocument(value: unknown, bookKey: string): DavDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid WebDAV reading-data document.');
  const v = value as DavDocument;
  if (
    v.format !== 'manabi-reader-webdav' ||
    v.version !== 1 ||
    v.bookKey !== bookKey ||
    !/^content:[a-f0-9]{64}$/.test(bookKey) ||
    !v.records ||
    typeof v.records !== 'object' ||
    Array.isArray(v.records) ||
    Object.keys(v).some((key) => !['format', 'version', 'bookKey', 'records'].includes(key)) ||
    Object.keys(v.records).length > 20000 ||
    new TextEncoder().encode(JSON.stringify(v)).byteLength > 4 * 1024 * 1024
  )
    throw new Error('Unsupported, oversized or wrong-book WebDAV reading data.');
  const records: Record<string, unknown> = Object.create(null);
  for (const [key, raw] of Object.entries(v.records)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid WebDAV reading-data record.');
    const row = raw as Record<string, unknown>;
    if (key === 'resume') {
      const parsed = bookmark(row, Number(row.lastBookmarkModified));
      if (canonical(row) !== canonical(parsed))
        throw new Error('Unexpected fields in WebDAV resume data.');
      records[key] = parsed;
    } else if (key.startsWith('statistics/')) {
      const parsed = statistics([{ ...row, title: bookKey }], bookKey)[0];
      if (key !== `statistics/${parsed.dateKey}` || canonical(row) !== canonical(parsed))
        throw new Error('Invalid WebDAV statistics identity.');
      records[key] = parsed;
    } else if (key.startsWith('annotation/')) {
      const { deletedAt, ...live } = row;
      const annotation = validateImportedAnnotation(live);
      if (
        key !== `annotation/${annotation.id}` ||
        annotation.bookKey !== bookKey ||
        (deletedAt !== undefined &&
          (typeof deletedAt !== 'string' ||
            deletedAt.length > 64 ||
            !Number.isFinite(Date.parse(deletedAt))))
      )
        throw new Error('Invalid WebDAV annotation identity.');
      // Browser revision numbers are local concurrency tokens, not portable content.
      records[key] = {
        ...annotation,
        revision: 1,
        ...(deletedAt ? { deletedAt } : {})
      } as ReaderAnnotation;
    } else if (key.startsWith('import/')) {
      const note = validateImportRecord({ ...row, bookId: 0, accountId: null });
      if (
        key !== `import/${note.id}` ||
        note.bookKey !== bookKey ||
        Object.hasOwn(row, 'accountId') ||
        Object.hasOwn(row, 'bookId')
      )
        throw new Error('Invalid WebDAV imported-note identity.');
      const { bookId: _book, accountId: _account, ...portable } = note;
      records[key] = portable;
    } else throw new Error('Unknown WebDAV reading-data type. No data was changed.');
  }
  return wireCopy({ format: v.format, version: 1, bookKey, records });
}
export const documentFor = (bookKey: string, records: Record<string, unknown>) =>
  validateDavDocument({ format: 'manabi-reader-webdav', version: 1, bookKey, records }, bookKey);
