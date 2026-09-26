/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

const totals = [
  'charactersRead',
  'readingTime',
  'minReadingSpeed',
  'altMinReadingSpeed',
  'lastReadingSpeed',
  'maxReadingSpeed'
];
// Complete Book stores the full getStatisticsMetadata result, not just a day row.
// Preserve its historical wire spellings, including Reding/Charaters.
const metadata = [
  'lastStatisticModified',
  'averageReadingTime',
  'averageWeightedRedingTime',
  'averageCharactersRead',
  'averageWeightedCharatersRead',
  'averageReadingSpeed',
  'averageWeightedReadingSpeed'
];
const allowed = new Set([
  ...totals,
  ...metadata,
  'dateKey',
  'completedBook',
  'exporterVersion',
  'dbVersion',
  'finishDate'
]);

/** @param {unknown} value */
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e15;
}
/** @param {unknown} value */
function calendarDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

/**
 * Accept actual completion snapshots and minimal legacy day totals, never unknown fields.
 * @param {unknown} value
 * @param {string} day
 */
export function isCompletedStatistics(value, day) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = /** @type {Record<string, unknown>} */ (value);
  if (
    Object.keys(data).some((key) => !allowed.has(key)) ||
    data.dateKey !== day ||
    !calendarDate(day)
  )
    return false;
  if (!totals.every((key) => finite(data[key]))) return false;
  if (!metadata.every((key) => data[key] === undefined || finite(data[key]))) return false;
  if (data.completedBook !== undefined && data.completedBook !== 1) return false;
  if (data.exporterVersion !== undefined && data.exporterVersion !== 1) return false;
  // Completion snapshots retain the database version written at the time.
  if (data.dbVersion !== undefined && ![5, 6, 7, 8].includes(data.dbVersion)) return false;
  return data.finishDate === undefined || data.finishDate === 'na' || calendarDate(data.finishDate);
}
