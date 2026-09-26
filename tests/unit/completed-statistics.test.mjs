import assert from 'node:assert/strict';
import test from 'node:test';
import { isCompletedStatistics } from '../../apps/web/src/lib/manabi/completed-statistics.js';

const day = '2026-09-19';
const totals = {
  dateKey: day,
  charactersRead: 60,
  readingTime: 300,
  minReadingSpeed: 720,
  altMinReadingSpeed: 720,
  lastReadingSpeed: 720,
  maxReadingSpeed: 720
};
const completed = {
  ...totals,
  exporterVersion: 1,
  dbVersion: 8,
  lastStatisticModified: 1789837322544,
  averageReadingTime: 300,
  averageWeightedRedingTime: 300,
  averageCharactersRead: 60,
  averageWeightedCharatersRead: 60,
  averageReadingSpeed: 720,
  averageWeightedReadingSpeed: 720,
  finishDate: 'na'
};

test('actual Complete Book metadata and legacy totals both remain valid', () => {
  assert.equal(isCompletedStatistics(totals, day), true);
  assert.equal(isCompletedStatistics(completed, day), true);
  assert.equal(isCompletedStatistics({ ...completed, dbVersion: 5 }, day), true);
  assert.equal(isCompletedStatistics({ ...completed, dbVersion: 6 }, day), true);
  assert.equal(isCompletedStatistics({ ...completed, dbVersion: 7 }, day), true);
  assert.equal(isCompletedStatistics({ ...completed, finishDate: day }, day), true);
  assert.equal(isCompletedStatistics({ ...totals, completedBook: 1 }, day), true);
});

test('completion schema rejects invalid metadata without erasing valid fields', () => {
  for (const fields of [
    { averageReadingTime: NaN },
    { averageWeightedCharatersRead: -1 },
    { readingTime: Infinity },
    { exporterVersion: 2 },
    { dbVersion: 9 },
    { completedBook: true },
    { dateKey: '2026-02-30' },
    { finishDate: '2026-02-30' },
    { dateKey: '2026-09-18' },
    { token: 'private' }
  ])
    assert.equal(isCompletedStatistics({ ...completed, ...fields }, day), false);
  assert.equal(isCompletedStatistics({ ...completed, readingTime: undefined }, day), false);
  assert.equal(isCompletedStatistics([], day), false);
  assert.equal(isCompletedStatistics(null, day), false);
  assert.equal(completed.averageWeightedRedingTime, 300);
});
