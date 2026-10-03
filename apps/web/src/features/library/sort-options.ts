/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { SortDirection } from '../../lib/data/sort-types';

export const librarySortChoices = [
  { property: 'lastBookOpen', label: 'Recent' },
  { property: 'title', label: 'Title' },
  { property: 'author', label: 'Author' },
  { property: 'id', label: 'Added' },
  { property: 'progress', label: 'Progress' },
  { property: 'characters', label: 'Characters' },
  { property: 'lastBookModified', label: 'Last Update' },
  { property: 'lastBookmarkModified', label: 'Bookmarked' }
] as const;
export type LibrarySort = (typeof librarySortChoices)[number]['property'];
export const LIBRARY_SORTS = librarySortChoices.map(({ property }) => property);
export interface LibrarySortPreference {
  property: LibrarySort;
  direction: SortDirection;
}
/** Old or damaged stored choices must never become arbitrary sort fields. */
export function readLibrarySort(value: unknown): LibrarySortPreference {
  const choice = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    property: LIBRARY_SORTS.includes(choice.property as LibrarySort)
      ? (choice.property as LibrarySort)
      : 'lastBookOpen',
    direction: choice.direction === 'asc' ? SortDirection.ASC : SortDirection.DESC
  };
}
