/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

interface CalendarDay {
  dateString: string;
  isCurrentYear: boolean;
  heatmapRow: number;
  heatmapColumn: number;
}

/** Days run down each week column. Do not leave the displayed year. */
export function heatmapNavigationDate(
  days: readonly CalendarDay[],
  date: string,
  key: string,
  rtl = false,
  control = false
): string | undefined {
  const available = days.filter((day) => day.isCurrentYear);
  const index = available.findIndex((day) => day.dateString === date);
  if (index < 0 || (control && key !== 'Home' && key !== 'End')) return;
  let next: number;
  switch (key) {
    case 'ArrowUp':
      next = index - 1;
      break;
    case 'ArrowDown':
      next = index + 1;
      break;
    case 'ArrowLeft':
      next = index + (rtl ? 7 : -7);
      break;
    case 'ArrowRight':
      next = index + (rtl ? -7 : 7);
      break;
    case 'Home':
      next = control ? 0 : index - (available[index].heatmapRow - 2);
      break;
    case 'End':
      next = control ? available.length - 1 : index + (8 - available[index].heatmapRow);
      break;
    default:
      return;
  }
  return available[Math.max(0, Math.min(available.length - 1, next))].dateString;
}

/** Rebuild columns from this year's days, not labels left over from another year. */
export function heatmapMonthLabels(
  days: readonly CalendarDay[],
  labels: readonly { monthLabel: string }[]
) {
  const result = labels.map(({ monthLabel }) => ({ monthLabel, heatmapColumn: '' }));
  for (const day of days) {
    if (!day.isCurrentYear || !day.dateString.endsWith('-01')) continue;
    const month = Number(day.dateString.slice(5, 7)) - 1;
    if (result[month])
      result[month].heatmapColumn = `${day.heatmapColumn + 1}/${day.heatmapColumn + 3}`;
  }
  return result;
}

/** The grid's measured width already excludes its navigation buttons and margins. */
export function heatmapCellSize(width: number, minimum: number, gap: number, columns: number) {
  if (!Number.isFinite(width) || width <= 0 || columns < 1) return minimum;
  return Math.max(minimum, Math.floor((width - gap * (columns - 1)) / columns));
}
