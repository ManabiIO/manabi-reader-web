/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { StatisticsDay, StatisticsQuery, StatisticsRow, StatisticsState } from './contract';

export type StatisticsDispatch = (intent: import('./contract').StatisticsIntent) => Promise<void>;
export interface StatisticsViewProps {
  state: StatisticsState;
  dispatch: StatisticsDispatch;
}
export const rangeTemplates = ['Today', 'This Week', 'This Month', 'This Year', 'Custom'] as const;
export const weekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
];
export const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];
export const minutes = (seconds: number) => Math.floor((seconds / 60 + Number.EPSILON) * 100) / 100;
export const rangeLabel = (query: StatisticsQuery) =>
  query.startDate === query.endDate ? query.startDate : `${query.startDate} - ${query.endDate}`;
export const measurementDetails = (row: StatisticsRow, kind: 'time' | 'characters' | 'speed') => {
  const m = row.measurements;
  if (kind === 'time')
    return [
      `Time: ${minutes(m.readingTime)} min`,
      `Average Time: ${minutes(m.averageReadingTime)} min`,
      `Weighted Time: ${minutes(m.averageWeightedReadingTime)} min`
    ];
  if (kind === 'characters')
    return [
      `Characters: ${m.charactersRead}`,
      `Average Characters: ${m.averageCharactersRead}`,
      `Weighted Characters: ${m.averageWeightedCharactersRead}`
    ];
  return [
    `Speed: ${m.lastReadingSpeed}`,
    `Min Speed: ${m.minReadingSpeed}`,
    `Alt Min Speed: ${m.altMinReadingSpeed}`,
    `Max Speed: ${m.maxReadingSpeed}`
  ];
};
export function summaryWeights(aggregation: StatisticsQuery['aggregation'], width: number) {
  if (aggregation === 'none')
    return width >= 1024
      ? [0.14, 0.26, 0.85, 0.59, 0.59, 0.45]
      : [0.31, 0.6, 0.77, 0.74, 0.6, 0.57];
  if (aggregation === 'date') return width >= 1024 ? [0.1, 1, 1, 1, 1] : [0.1, 0.6, 1, 1.1, 0.85];
  return width >= 1024 ? [0.1, 0.93, 0.35, 0.42, 0.3] : [0.1, 1, 0.45, 0.45, 0.45];
}
export function calendarColumns(days: StatisticsDay[], year: number, weekStartsOn: number) {
  const firstWeekday = new Date(year, 0, 1, 12).getDay();
  const offset = (firstWeekday - weekStartsOn + 7) % 7;
  const byDate = new Map(days.map((day) => [day.date, day]));
  const count = Math.round(
    (new Date(year + 1, 0, 1, 12).getTime() - new Date(year, 0, 1, 12).getTime()) / 86400000
  );
  const columns: ({
    date: string;
    day?: StatisticsDay;
    month: number;
    dayOfMonth: number;
    inYear: boolean;
  } | null)[][] = [];
  for (let index = 0; index < Math.ceil((count + offset) / 7) * 7; index++) {
    const dayIndex = index - offset;
    if (index % 7 === 0) columns.push([]);
    const date = new Date(year, 0, dayIndex + 1, 12);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    columns[columns.length - 1].push({
      date: key,
      day: byDate.get(key),
      month: date.getMonth(),
      dayOfMonth: date.getDate(),
      inYear: dayIndex >= 0 && dayIndex < count
    });
  }
  return columns;
}
/** Matches the established 3rem rows and 1.5rem gaps; compact view shows one row. */
export function summaryPageSize(width: number, height: number, fontScale = 1) {
  return width < 768 ? 1 : Math.max(1, Math.ceil((height - 276 * fontScale) / (78.4 * fontScale)));
}
