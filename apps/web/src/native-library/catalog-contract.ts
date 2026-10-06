/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const CATALOG_PAGE_LIMIT = 20;
export const CATALOG_LIFETIME = 10 * 60 * 1000;
export interface NativeCatalogItem {
  key: string;
  title: string;
  author: string;
  summary: string;
}
/** No acquisition/cover URLs, source IDs, account identifiers or content bytes. */
export interface NativeCatalogState {
  token: string;
  status: 'loading' | 'ready' | 'error';
  items: NativeCatalogItem[];
  total: number;
  offset: number;
  limit: number;
}
