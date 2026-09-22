/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { SortOption } from '$lib/data/sort-types';

export interface LibraryMenuChoice {
  value: string;
  label: string;
  icon?: 'grid' | 'list' | 'timeline';
}

export interface LibraryMenuModel {
  title: string;
  canGoBack: boolean;
  back(): void;
  search: {
    query: string;
    setQuery(value: string): void;
  };
  currentLayout: string;
  layouts: LibraryMenuChoice[];
  setLayout(value: string): void;
  showValue: string;
  showChoices: LibraryMenuChoice[];
  setShow(value: string): void;
  sortProperty: SortOption['property'];
  sortDirection: 'asc' | 'desc';
  sortChoices: { property: SortOption['property']; label: string }[];
  moreSortChoices: { property: SortOption['property']; label: string }[];
  setSort(property: string, direction?: 'asc' | 'desc'): void;
  finishedOrder?: 'asc' | 'desc';
  setFinishedOrder(value: string): void;
  createSeries(): void;
  refreshFolders(): void;
  selectedWantToRead: {
    canAdd: boolean;
    canRemove: boolean;
    set(included: boolean): void;
  };
}
