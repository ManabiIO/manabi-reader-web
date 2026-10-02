/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Data and effects only. This boundary must never return platform UI. */
export {
  nativeStatisticsTimeSources as statisticsTimeSources,
  nativeStatisticsCharactersSources as statisticsCharactersSources,
  nativeStatisticsSpeedSources as statisticsSpeedSources
} from '../../statistics-react/native-contract';
import type {
  NativeStatisticsCharactersSource,
  NativeStatisticsMeasurements,
  NativeStatisticsSpeedSource,
  NativeStatisticsTimeSource
} from '../../statistics-react/native-contract';

import type { AppearanceMode, ThemeOption } from '../../lib/data/theme-option';
export interface StatisticsUiTheme {
  themeId: string;
  appearance: AppearanceMode;
  customThemes: Record<string, ThemeOption>;
}
export type StatisticsRangeTemplate = 'Today' | 'This Week' | 'This Month' | 'This Year' | 'Custom';
export interface StatisticsQuery {
  selectionToken?: string;
  startDate: string;
  endDate: string;
  year: number;
  goalYear: number;
  weekStartsOn: number;
  rangeTemplate: StatisticsRangeTemplate;
  confirmDeletion: boolean;
  aggregation: 'title' | 'date' | 'none';
  sort: 'title' | 'date' | 'time' | 'characters' | 'speed';
  direction: 'asc' | 'desc';
  timeSource: NativeStatisticsTimeSource;
  charactersSource: NativeStatisticsCharactersSource;
  speedSource: NativeStatisticsSpeedSource;
  page: number;
  pageSize: number;
  /** Omitted means every title; [] deliberately selects none. */
  selectedTitles?: string[];
  /** Logical identities, never numeric route hints. Native admission remains opaque. */
  prefilteredBookKeys: string[];
  prefilteredTitles?: string[];
  heatmapAggregation: 'year' | 'all-time';
  goalHeatmapAggregation: 'year' | 'all-time';
}
export interface StatisticsBook {
  id?: number;
  title: string;
  bookKey?: string;
  deletable: boolean;
}
export interface StatisticsEntry {
  bookId?: number;
  bookKey?: string;
  title: string;
  date: string;
}
export interface StatisticsRow {
  id: string;
  title: string;
  date: string;
  time: number;
  characters: number;
  speed: number;
  measurements: NativeStatisticsMeasurements;
  entry?: StatisticsEntry;
  affectedTitles?: string[];
}
export interface StatisticsDay {
  date: string;
  color: string;
  details: string[];
  time: number;
}
export interface StatisticsStreak {
  startDate: string;
  endDate: string;
  duration: number;
}
export interface StatisticsSnapshot {
  snapshotId: string;
  uiTheme?: StatisticsUiTheme;
  query: StatisticsQuery;
  today: string;
  dateRangeLabel?: string;
  shortcuts?: Record<string, 'range-template' | 'aggregation'>;
  currentBookId?: number;
  blurredMeasurements?: string[];
  books: StatisticsBook[];
  titles: { title: string; selected: boolean; inDateRange: boolean }[];
  rows: StatisticsRow[];
  totalRows: number;
  selectionTitles?: string[];
  allTitles?: string[];
  pages: number;
  totals: { time: number; characters: number; speed: number; days: number };
  days: StatisticsDay[];
  goalDays: StatisticsDay[];
  daysRead: string;
  currentStreak: number;
  longestStreak: number;
  longestStreakCount?: number;
  longestStreaks?: StatisticsStreak[];
  currentStreakRange?: StatisticsStreak;
  longestStreakStartDate: string | null;
  longestStreakDates: string[];
  currentStreakDates: string[];
  goalStats?: {
    completed: string;
    currentStreak: number;
    longestStreak: number;
    longestStreakCount?: number;
    longestStreaks?: StatisticsStreak[];
    currentStreakRange?: StatisticsStreak;
    completedStreaks?: StatisticsStreak[];
    longestStreakStartDate: string | null;
    longestStreakDates: string[];
    currentStreakDates: string[];
    completedDates: string[];
  };
  allTime: { startDate: string; endDate: string } | null;
  notices: string[];
}
export type StatisticsCapability = { available: true } | { available: false; reason: string };
export interface StatisticsCapabilities {
  goals: StatisticsCapability;
  clipboard: StatisticsCapability;
  ttuExport: StatisticsCapability;
  rawRecovery: StatisticsCapability;
  globalDelete: StatisticsCapability;
  createDay: StatisticsCapability;
}
/** Targets are captured from the visible snapshot, not reconstructed from a title after confirmation. */
export type StatisticsMutation =
  | {
      type: 'save-day';
      snapshotId: string;
      entry: StatisticsEntry;
      time: number;
      characters: number;
      resetMinMax: boolean;
      mode: 'edit' | 'create';
    }
  | { type: 'delete'; snapshotId: string; scope: 'selection' | 'all'; row?: StatisticsRow };
export interface StatisticsPort {
  readonly capabilities: StatisticsCapabilities;
  /** Changes whenever account/session/route authority changes. */
  readonly ownerKey: string;
  readonly initialTheme?: StatisticsUiTheme;
  readonly userGuideHref?: string;
  initialQuery(): Partial<StatisticsQuery>;
  initialView?: StatisticsState['view'];
  initialFilterPreferences?: { dateOnly: boolean; selectedOnly: boolean };
  persistFilterPreferences?(value: { dateOnly: boolean; selectedOnly: boolean }): void;
  persistView?(view: StatisticsState['view']): void;
  load(query: StatisticsQuery, signal: AbortSignal): Promise<StatisticsSnapshot>;
  mutate(action: StatisticsMutation, signal: AbortSignal): Promise<void>;
  export(
    format: 'ttu' | 'raw',
    scope: 'selection' | 'all',
    snapshotId: string,
    signal: AbortSignal
  ): Promise<void>;
  copy(
    measurement: 'readingTime' | 'charactersRead',
    snapshotId: string,
    signal: AbortSignal
  ): Promise<void>;
  /** Retirement invalidates outstanding responses, confirmations, and drafts. */
  subscribeInvalidation(listener: () => void): () => void;
  persistQuery?(query: StatisticsQuery): void;
  release?(): void;
  setProgress?(busy: boolean, lease: symbol): void;
}
export interface StatisticsEditor {
  row: StatisticsRow;
  date: string;
  /** Seconds, exactly as in the established web day editor. */
  time: string;
  characters: string;
  resetMinMax: boolean;
  mode: 'edit' | 'create';
}
export interface StatisticsState {
  query: StatisticsQuery;
  data?: StatisticsSnapshot;
  busy: boolean;
  error: string;
  settingsOpen: boolean;
  titleFilterOpen: boolean;
  titleSearch: string;
  filterPreferences: { dateOnly: boolean; selectedOnly: boolean };
  titleDraft: string[];
  view: 'overview' | 'summary';
  selectedDay?: string;
  selectedDayGoal?: boolean;
  highlightStreak: boolean;
  highlight?: { kind: 'longest' | 'current' | 'completed'; goal: boolean };
  goalHighlight?: { kind: 'longest' | 'current' | 'completed'; goal: boolean };
  editor?: StatisticsEditor;
  confirmation?: { title: string; message: string; confirmLabel: string };
  capabilities: StatisticsCapabilities;
}
export type StatisticsIntent =
  | { type: 'query'; patch: Partial<StatisticsQuery> }
  | { type: 'template'; value: StatisticsRangeTemplate }
  | { type: 'view'; value: StatisticsState['view'] }
  | { type: 'settings'; open: boolean }
  | { type: 'title-filter'; open: boolean }
  | { type: 'title-search'; value: string }
  | { type: 'filter-preferences'; patch: Partial<{ dateOnly: boolean; selectedOnly: boolean }> }
  | { type: 'title-toggle'; title: string }
  | { type: 'title-all'; selected: boolean; titles?: string[] }
  | { type: 'title-apply' }
  | { type: 'clear-prefilter' }
  | { type: 'edit'; row: StatisticsRow }
  | { type: 'create-day'; book: StatisticsBook }
  | { type: 'editor'; patch: Partial<Omit<StatisticsEditor, 'row' | 'mode'>> }
  | { type: 'save-editor' }
  | { type: 'close-editor' }
  | { type: 'delete-row'; row: StatisticsRow }
  | { type: 'delete-selection' }
  | { type: 'delete-all' }
  | { type: 'confirm'; accept: boolean }
  | { type: 'export'; format: 'ttu' | 'raw'; scope: 'selection' | 'all' }
  | { type: 'copy'; measurement: 'readingTime' | 'charactersRead' }
  | { type: 'day'; date?: string; goal?: boolean }
  | { type: 'day-key'; date: string; key: string; rtl?: boolean; control?: boolean }
  | { type: 'longest-streak' }
  | { type: 'highlight'; kind: 'longest' | 'current' | 'completed'; goal: boolean }
  | { type: 'refresh' }
  | { type: 'all-time' }
  | { type: 'clear-error' };
