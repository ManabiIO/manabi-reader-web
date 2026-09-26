/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface PersonalSyncEpoch {
  generation: string;
  incarnation: string;
}

import type BooksDbV6 from '../v6/books-db-v6';
import type { PublicationManifest, ReaderLocator } from '$lib/reader-location';

export interface ReaderAnnotation {
  id: string;
  bookKey: string;
  kind: 'bookmark' | 'highlight' | 'note';
  targets: ReaderLocator[];
  body?: string;
  label?: string;
  color?: 'yellow' | 'blue' | 'green' | 'pink' | 'purple';
  decoration?: 'highlight' | 'underline';
  createdAt: string;
  modifiedAt: string;
  revision: number;
  deletedAt?: string;
}

export interface ReaderAnnotationMutation {
  id: string;
  accountId: string | null;
  bookKey: string;
  annotationId: string;
  baseRevision: number;
  localRevision: number;
  value: ReaderAnnotation;
  createdAt: string;
  request?: {
    sync?: PersonalSyncEpoch;
    mutation_id: string;
    kind: 'annotation';
    entity_id: string;
    book_key: string;
    base_revision: number;
    operation: 'put' | 'delete';
    payload: Record<string, unknown> | null;
  };
}

export default interface BooksDbV7 extends BooksDbV6 {
  readerLocalIdentity: {
    key: number;
    value: { bookId: number; uuid: string };
  };
  publication: {
    key: number;
    value: { bookId: number; manifest: PublicationManifest; projectionVersion: number };
  };
  readerAnnotation: {
    key: string;
    value: ReaderAnnotation;
    indexes: { bookKey: string; kind: string };
  };
  readerAnnotationOutbox: {
    key: string;
    value: ReaderAnnotationMutation;
    indexes: { accountId: string; bookKey: string };
  };
  readerSyncState: {
    key: string;
    value: {
      accountId: string;
      cursor: string;
      modifiedAt: string;
      generation?: string;
      incarnation?: string;
      resyncing?: boolean;
    };
  };
  readerConflict: {
    key: string;
    value: { id: string; bookKey: string; local: ReaderAnnotation; remote: ReaderAnnotation };
    indexes: { bookKey: string };
  };
}
