/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface NativeStatisticsQuery {
  startDate?: string;
  endDate?: string;
  year?: number;
  bookIds?: number[];
  bookSelection?: 'all' | 'selected';
  page?: number;
  aggregation?: 'title' | 'date' | 'none';
  sort?: 'title' | 'date' | 'time' | 'characters' | 'speed';
  direction?: 'asc' | 'desc';
}
export interface NativeStatisticsBook {
  id: number;
  title: string;
  bookKey: string;
  deletable: boolean;
}
export interface NativeStatisticsRow {
  id: string;
  title: string;
  date: string;
  time: number;
  characters: number;
  speed: number;
  /** Only individual, proven identity/day rows can be edited. */
  entry?: { bookId: number; bookKey: string; date: string };
}
export interface NativeStatisticsSnapshot {
  snapshotId: string;
  query: Required<NativeStatisticsQuery>;
  today: string;
  weekStartsOn: number;
  books: NativeStatisticsBook[];
  rows: NativeStatisticsRow[];
  totalRows: number;
  pages: number;
  totals: { time: number; characters: number; speed: number; days: number };
  days: { date: string; color: string; details: string[]; time: number }[];
  daysRead: string;
  currentStreak: number;
  longestStreak: number;
  longestStreakDates: string[];
  allTime: { startDate: string; endDate: string } | null;
  /** Explicit schema/ownership gate, never an empty global-goals projection. */
  goals: { available: false; reason: string };
  notices: string[];
}
export interface NativeStatisticsDelete {
  type: 'delete-book-history';
  snapshotId: string;
  bookId: number;
  title: string;
  bookKey: string;
}
export type NativeStatisticsAction =
  | NativeStatisticsDelete
  | {
      type: 'delete-day';
      snapshotId: string;
      bookId: number;
      bookKey: string;
      title: string;
      date: string;
    }
  | {
      type: 'save-day';
      snapshotId: string;
      bookId: number;
      /** Actual identity/day from an individual row, or primary key for a new day. */
      bookKey: string;
      title: string;
      date: string;
      mode: 'create' | 'edit';
      time: number;
      characters: number;
      resetMinMax: boolean;
    }
  | {
      type: 'delete-range';
      snapshotId: string;
      bookIds: number[];
      startDate: string;
      endDate: string;
    };
