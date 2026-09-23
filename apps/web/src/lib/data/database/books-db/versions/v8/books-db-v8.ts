/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type BooksDbV7 from '../v7/books-db-v7';

export type PersonalKind = 'annotation' | 'resume' | 'completion' | 'statistics';

export interface PersonalRecord {
  id: string;
  accountId: string;
  kind: PersonalKind;
  entityId: string;
  bookKey: string;
  revision: number;
  payload: Record<string, unknown> | null;
  deleted: boolean;
}

export interface PersonalMutation {
  id: string;
  accountId: string;
  kind: Exclude<PersonalKind, 'annotation'>;
  entityId: string;
  bookKey: string;
  baseRevision: number;
  localValue: Record<string, unknown> | null;
  request?: {
    mutation_id: string;
    kind: PersonalKind;
    entity_id: string;
    book_key: string;
    base_revision: number;
    operation: 'put' | 'delete';
    payload: Record<string, unknown> | null;
  };
}

export interface PersonalConflict {
  id: string;
  accountId: string;
  kind: PersonalKind;
  entityId: string;
  bookKey: string;
  local: Record<string, unknown> | null;
  remote: Record<string, unknown> | null;
  remoteRevision: number;
  fields: string[];
}

export default interface BooksDbV8 extends BooksDbV7 {
  readerBookScope: {
    key: number;
    value: { bookId: number; accountId: string; hydrated?: boolean };
  };
  readerAnnotationScope: { key: string; value: { annotationId: string; accountId: string } };
  readerPersonalRecord: {
    key: string;
    value: PersonalRecord;
    indexes: { accountId: string; bookKey: string };
  };
  readerPersonalOutbox: {
    key: string;
    value: PersonalMutation;
    indexes: { accountId: string; bookKey: string };
  };
  readerPersonalConflict: {
    key: string;
    value: PersonalConflict;
    indexes: { accountId: string; bookKey: string };
  };
}
