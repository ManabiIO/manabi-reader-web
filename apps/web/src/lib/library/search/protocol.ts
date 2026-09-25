/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { PublicationResource } from '../../reader-location';
import type { TextMatch } from './text';

export interface SearchBook {
  id: number;
  contentHash?: string;
}
export interface ContentHit extends TextMatch {
  bookId: number;
  signature: string;
  resource: PublicationResource;
  resourceDigest: string;
}
export interface SearchRequest {
  type: 'search';
  id: number;
  query: string;
  database: { name: string; version: number };
  viewer: string | null;
  books: SearchBook[];
}
export type SearchReply =
  | { type: 'book'; id: number; bookId: number; hits: ContentHit[]; truncated: boolean }
  | {
      type: 'progress';
      id: number;
      scanned: number;
      total: number;
      failed: number;
      cacheUnavailable: boolean;
    }
  | { type: 'done'; id: number; truncated: boolean }
  | { type: 'error'; id: number; message: string };
