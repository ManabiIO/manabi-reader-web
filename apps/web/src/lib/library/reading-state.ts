/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { finishedDay, isFinished, progressFraction } from './completion.ts';
import type { ShelfBook } from './view-model';

export function hasReadingEvidence(book: ShelfBook): boolean {
  return (
    book.lastBookOpen > 0 || (book.lastBookmarkModified > 0 && progressFraction(book.progress) > 0)
  );
}

export function readingTimestamp(book: ShelfBook): number {
  return Math.max(book.lastBookOpen || 0, book.lastBookmarkModified || 0);
}

export function readingLabel(book: ShelfBook): string {
  if (isFinished(book)) return 'Finished';
  if (!hasReadingEvidence(book)) return 'Unread';
  return `${Math.floor(progressFraction(book.progress) * 100)}%`;
}

export function continueBooks(books: ShelfBook[], limit = 10): ShelfBook[] {
  return books
    .filter((book) => !isFinished(book) && hasReadingEvidence(book))
    .sort(
      (a, b) =>
        readingTimestamp(b) - readingTimestamp(a) ||
        a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) ||
        a.key.localeCompare(b.key)
    )
    .slice(0, limit);
}

/** Prefer an actually-read unfinished volume, then the stable natural series order. */
export function seriesReadingTarget(
  books: ShelfBook[],
  volumeOrder?: ShelfBook[]
): ShelfBook | undefined {
  const unfinished = books.filter((book) => !isFinished(book));
  const read = continueBooks(unfinished, unfinished.length);
  if (read.length) return read[0];
  if (volumeOrder) {
    const eligible = new Set(unfinished.map((book) => book.key));
    const ordered = volumeOrder.find((book) => eligible.has(book.key));
    if (ordered) return ordered;
  }
  return [...unfinished].sort(
    (a, b) =>
      (a.file?.name || a.title).localeCompare(b.file?.name || b.title, undefined, {
        numeric: true,
        sensitivity: 'base'
      }) || a.key.localeCompare(b.key)
  )[0];
}

export interface FinishedGroup {
  day?: string;
  books: ShelfBook[];
}

export function finishedGroups(
  books: ShelfBook[],
  direction: 'asc' | 'desc' = 'desc'
): FinishedGroup[] {
  const dated = new Map<string, ShelfBook[]>();
  const unknown: ShelfBook[] = [];
  for (const book of books.filter(isFinished)) {
    const day = finishedDay(book);
    if (!day) unknown.push(book);
    else dated.set(day, [...(dated.get(day) || []), book]);
  }
  const byTitle = (a: ShelfBook, b: ShelfBook) =>
    a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) ||
    a.key.localeCompare(b.key);
  const groups: FinishedGroup[] = [...dated.entries()]
    .sort(([a], [b]) => (direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a)))
    .map(([day, values]) => ({ day, books: values.sort(byTitle) }));
  if (unknown.length) groups.push({ books: unknown.sort(byTitle) });
  return groups;
}

export function formatCalendarDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, date)));
}
