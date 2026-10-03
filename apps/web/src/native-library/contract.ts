/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { UiThemeProviderProps } from '../shared-ui/theme';
import type { BookMetadata, BookSeries } from '../lib/library/book-presentation';
export const LIBRARY_PAGE_LIMIT = 60;
export const LIBRARY_ACTION_LIMIT = 60;
export const LIBRARY_SORTS = [
  'lastBookOpen',
  'title',
  'author',
  'id',
  'progress',
  'characters',
  'lastBookModified',
  'lastBookmarkModified'
] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];
export interface LibraryQuery {
  query?: string;
  collection?: string;
  series?: string;
  source?: string;
  unfinished?: boolean;
  sort?: LibrarySort;
  direction?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
  detail?: string;
}
export interface NativeLibraryBook {
  kind: 'book';
  key: string;
  title: string;
  creators: string;
  bookId?: number;
  characters: number;
  progress: number;
  /** Canonical reading-state label calculated in the DOM owner, including unread evidence. */
  readingLabel: string;
  finished: boolean;
  finishedOn?: string;
  wantToRead: boolean;
  coverBlur: boolean;
  hasCover: boolean;
  canChangeCover: boolean;
  series?: BookSeries | null;
  source: string;
  available: boolean;
  unavailableReason?: string;
}
export interface NativeLibrarySeries {
  kind: 'series';
  key: string;
  title: string;
  count: number;
  personal: boolean;
}
export type LibraryUiTheme = Pick<UiThemeProviderProps, 'themeId' | 'appearance' | 'customThemes'>;
export interface NativeLibraryState {
  uiTheme?: LibraryUiTheme;
  token: string;
  coverToken: string;
  items: (NativeLibraryBook | NativeLibrarySeries)[];
  total: number;
  offset: number;
  limit: number;
  totalBooks: number;
  collections: { id: string; name: string; count: number; builtIn: boolean }[];
  sources: {
    id: string;
    name: string;
    provider: string;
    physicalActionsAvailable: false;
    reason: string;
  }[];
  trail: { id: string; name: string }[];
  counts: { finished: number; wantToRead: number };
  detail?: NativeLibraryBook & { metadata: BookMetadata; direction: string };
}
export type LibraryAction =
  | {
      type: 'presentation';
      keys: string[];
      change: {
        title?: string;
        metadata?: BookMetadata;
        series?: BookSeries | null;
        direction?: 'ltr' | 'rtl' | 'unknown';
        coverBlur?: boolean;
      };
      preserveSeriesIndex?: boolean;
    }
  | { type: 'membership'; keys: string[]; collection: string; included: boolean }
  | { type: 'collection.create'; name: string; keys?: string[] }
  | { type: 'collection.rename'; collection: string; name: string }
  | { type: 'collection.remove'; collection: string }
  | { type: 'completion'; keys: string[]; state: 'finished' | 'reading'; day?: string };
export type LibraryActionRequest = { token: string } & LibraryAction;
/** Supplied by the existing trusted bridge; never accepted from its payload. */
export interface LibraryAuthority {
  key: string;
  signal: AbortSignal;
  assertCurrent(): void;
}

export interface LibraryAccessRequest {
  token: string;
  keys: string[];
  operation: 'open' | 'delete';
}
/** DOM-only authority: validate these again in the actual read/write transaction. */
export interface LibraryAccessIdentity {
  bookId: number;
  /** Canonical content hash or legacy local UUID, retained only inside the DOM runtime. */
  readerBookKey?: string;
  contentHash?: string;
  title: string;
  lastBookModified: number;
}
