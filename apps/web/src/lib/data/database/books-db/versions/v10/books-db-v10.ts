/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { SearchResource } from '$lib/library/content-search';
import type BooksDbV9 from '../v9/books-db-v9';

/** Local acknowledgement and the applied reader state share one transaction. */
export interface ExternalSyncState {
  id: string;
  bookId: number;
  sourceId: string;
  root: string;
  accountId: string | null;
  base: Record<string, unknown>;
  conflicts: string[];
}
/** Original import evidence is retained even when a source location cannot be proved. */
export interface ReaderImportRecord {
  id: string;
  bookId: number;
  bookKey: string;
  accountId: string | null;
  part: 'savedBookmarks' | 'highlights' | 'notes';
  source: Record<string, unknown>;
  sourceCanonical: string;
  annotationId?: string;
  appliedAnnotation?: string;
  status: 'anchored' | 'book-note' | 'unresolved';
  reason?: string;
  label: string;
  body: string;
  quote: string;
  importedBody: string;
  importedLabel: string;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
}
export default interface BooksDbV10 extends BooksDbV9 {
  readerSearchProjection: {
    key: number;
    value: { bookId: number; source: string; digest?: string; resources: SearchResource[] };
  };
  readerExternalSync: { key: string; value: ExternalSyncState };
  readerImportRecord: {
    key: string;
    value: ReaderImportRecord;
    indexes: { bookKey: string };
  };
}
