/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { LibraryQuery } from './contract';

export const CONTENT_SEARCH_PAGE_LIMIT = 30;
export const CONTENT_SEARCH_HIT_LIMIT = 300;
export const CONTENT_SEARCH_LIFETIME = 10 * 60 * 1000;
export type ContentSearchView = Pick<
  LibraryQuery,
  'collection' | 'series' | 'source' | 'unfinished' | 'sort' | 'direction'
>;
export interface NativeContentHit {
  key: string;
  bookId: number;
  title: string;
  section: number;
  excerpt: string;
  /** Original excerpt UTF-16 boundaries, exactly as returned by the shared worker. */
  match: { start: number; end: number };
}
export interface NativeContentSearchState {
  token: string;
  query: string;
  status: 'loading' | 'ready' | 'error';
  items: NativeContentHit[];
  total: number;
  offset: number;
  limit: number;
  failed: number;
  truncated: boolean;
  error?: string;
}
