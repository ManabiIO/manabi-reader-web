/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
export interface NativeStatisticsQuery {
  startDate?: string;
  endDate?: string;
  year?: number;
  bookIds?: number[];
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
}
export interface NativeStatisticsSnapshot {
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
  notices: string[];
}
export interface NativeStatisticsDelete {
  type: 'delete-book-history';
  bookId: number;
  title: string;
  bookKey: string;
}
