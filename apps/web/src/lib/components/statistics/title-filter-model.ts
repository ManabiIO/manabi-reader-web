/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { StatisticsTitleFilterItem } from './statistics-types';

export const TITLE_FILTER_PAGE_SIZE = 25;

export function filterStatisticsTitles(
  items: readonly StatisticsTitleFilterItem[],
  query: string,
  dates: ReadonlySet<string>,
  dateOnly: boolean,
  selectedOnly: boolean
): StatisticsTitleFilterItem[] {
  const needle = query.trim().normalize('NFC').toLowerCase();
  return items.filter(
    (item) =>
      (!needle || item.title.normalize('NFC').toLowerCase().includes(needle)) &&
      (!dateOnly || dates.has(item.title)) &&
      (!selectedOnly || item.isSelected)
  );
}

/** Stable pagination independent of viewport, font metrics and mount timing.
 * The containing sheet scrolls; every row on this bounded page can grow. */
export function statisticsTitlePage<T>(items: readonly T[], requestedPage: number) {
  const pages = Math.max(1, Math.ceil(items.length / TITLE_FILTER_PAGE_SIZE));
  const page = Math.min(
    pages,
    Math.max(1, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1)
  );
  const start = (page - 1) * TITLE_FILTER_PAGE_SIZE;
  return { page, pages, rows: items.slice(start, start + TITLE_FILTER_PAGE_SIZE) };
}


/** Change only the titles represented by the current filter result.
 * Hidden titles keep their draft selection, matching workspace filter semantics. */
export function setMatchingStatisticsTitleSelection(
  items: readonly StatisticsTitleFilterItem[],
  matchingItems: readonly StatisticsTitleFilterItem[],
  isSelected: boolean
): StatisticsTitleFilterItem[] {
  const matchingTitles = new Set(matchingItems.map((item) => item.title));
  return items.map((item) =>
    matchingTitles.has(item.title) ? { ...item, isSelected } : item
  );
}
