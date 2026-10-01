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
