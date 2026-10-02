/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Data-only choices: importing these in native never loads the DOM owner. */
export const nativeStatisticsTimeSources = [
  { key: 'readingTime', label: 'Total Time' },
  { key: 'averageReadingTime', label: 'Average Time' },
  { key: 'averageWeightedReadingTime', label: 'Weighted Time' }
] as const;
export const nativeStatisticsCharactersSources = [
  { key: 'charactersRead', label: 'Characters' },
  { key: 'averageCharactersRead', label: 'Average Characters' },
  { key: 'averageWeightedCharactersRead', label: 'Weighted Characters' }
] as const;
export const nativeStatisticsSpeedSources = [
  { key: 'lastReadingSpeed', label: 'Speed' },
  { key: 'minReadingSpeed', label: 'Min Speed' },
  { key: 'altMinReadingSpeed', label: 'Alt Min Speed' },
  { key: 'maxReadingSpeed', label: 'Max Speed' }
] as const;
export type NativeStatisticsTimeSource = (typeof nativeStatisticsTimeSources)[number]['key'];
export type NativeStatisticsCharactersSource =
  (typeof nativeStatisticsCharactersSources)[number]['key'];
export type NativeStatisticsSpeedSource = (typeof nativeStatisticsSpeedSources)[number]['key'];
export type NativeStatisticsMeasurements = Record<
  NativeStatisticsTimeSource | NativeStatisticsCharactersSource | NativeStatisticsSpeedSource,
  number
>;

/** Bounded Library Open response. This token is not a mutation snapshot. */
export interface NativeStatisticsSelectionAdmission {
  admissionVersion: 1;
  selectionToken: string;
  bookId: number;
}

export interface NativeStatisticsQuery {
  /** Opaque, account-bound Library selection. Never a numeric-ID route hint. */
  selectionToken?: string;
  startDate?: string;
  endDate?: string;
  year?: number;
  bookIds?: number[];
  bookSelection?: 'all' | 'selected';
  page?: number;
  aggregation?: 'title' | 'date' | 'none';
  sort?: 'title' | 'date' | 'time' | 'characters' | 'speed';
  direction?: 'asc' | 'desc';
  timeSource?: NativeStatisticsTimeSource;
  charactersSource?: NativeStatisticsCharactersSource;
  speedSource?: NativeStatisticsSpeedSource;
  /** All-time metrics and color scale; calendar cells remain year-paged. */
  heatmapAggregation?: 'year' | 'all-time';
}
export interface NativeStatisticsBook {
  id: number;
  title: string;
  bookKey: string;
  deletable: boolean;
}
export interface NativeStatisticsMutationTargets {
  bookIds: number[];
  bookKeys: string[];
}
export interface NativeStatisticsRow {
  /** DOM-only projection admission metadata; stripped before bridge serialization. */
  sharedMutationTargets?: NativeStatisticsMutationTargets;
  id: string;
  title: string;
  date: string;
  time: number;
  characters: number;
  speed: number;
  /** Bounded display-only measurements; raw totals above remain edit values. */
  measurements: NativeStatisticsMeasurements;
  affectedTitles?: string[];
  /** Only individual, proven identity/day rows can be edited. */
  entry?: { bookId: number; bookKey: string; date: string };
}
export interface NativeStatisticsSnapshot {
  /** DOM-only projection admission metadata; stripped before bridge serialization. */
  sharedMutationTargets?: NativeStatisticsMutationTargets;
  snapshotId: string;
  query: Required<NativeStatisticsQuery>;
  today: string;
  weekStartsOn: number;
  books: NativeStatisticsBook[];
  rows: NativeStatisticsRow[];
  totalRows: number;
  selectionTitles?: string[];
  allTitles?: string[];
  pages: number;
  totals: { time: number; characters: number; speed: number; days: number };
  days: { date: string; color: string; details: string[]; time: number }[];
  daysRead: string;
  currentStreak: number;
  currentStreakDates?: string[];
  titleChoices?: { title: string; inDateRange: boolean }[];
  longestStreak: number;
  longestStreakCount?: number;
  longestStreaks?: { startDate: string; endDate: string; duration: number }[];
  currentStreakRange?: { startDate: string; endDate: string; duration: number };
  /** Allows an all-time highlight to navigate without transferring other years. */
  longestStreakStartDate: string | null;
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

/** DOM-only shared dispatch recovers titles from its privately admitted proof. */
export type SharedNativeStatisticsAction = {
  [Type in NativeStatisticsAction['type']]: Omit<
    Extract<NativeStatisticsAction, { type: Type }>,
    'title'
  >;
}[NativeStatisticsAction['type']];
