/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export type SearchResultFilter = 'all' | 'dictionary' | 'titles' | 'content';

export interface SearchResultPlan {
  readonly titles: boolean;
  readonly content: boolean;
}

const plans = {
  all: { titles: true, content: true },
  dictionary: { titles: false, content: false },
  titles: { titles: true, content: false },
  content: { titles: false, content: true }
} as const satisfies Record<SearchResultFilter, SearchResultPlan>;

export const searchResultPlan = (filter: SearchResultFilter): SearchResultPlan => plans[filter];

export interface MediaSearchRevisions {
  readonly titles: number;
  readonly content: number;
}

/** Searchable video metadata affects both sections; captions affect Content only. */
export function advanceMediaSearchRevisions(
  current: MediaSearchRevisions,
  captionsChanged: boolean,
  metadataChanged: boolean
): MediaSearchRevisions {
  return {
    titles: current.titles + Number(metadataChanged),
    content: current.content + Number(captionsChanged || metadataChanged)
  };
}


/** Increment only when an immutable snapshot is replaced, not on every consumer query. */
export function referenceRevision<T>() {
  let current: T | undefined,
    initialized = false,
    revision = 0;
  return (next: T): number => {
    if (!initialized || next !== current) {
      initialized = true;
      current = next;
      revision++;
    }
    return revision;
  };
}

/** Recompute a potentially expensive corpus projection only when its snapshot identity changes. */
export function memoizeReferenceProjection<T, R>(project: (value: T) => R) {
  let current: T | undefined,
    initialized = false,
    result: R;
  return (next: T): R => {
    if (!initialized || next !== current) {
      initialized = true;
      current = next;
      result = project(next);
    }
    return result!;
  };
}
