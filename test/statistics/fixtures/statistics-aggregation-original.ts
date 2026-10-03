/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { getDefaultStatistic } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import {
  type BookStatistic,
  StatisticsReadingDataAggregationMode
} from '$lib/components/statistics/statistics-types';

/** Frozen extraction oracle from statistics-content-controller.ts at 727b360.
 * Test-only: intentionally independent of the production helper so a port cannot
 * silently change the original formulas, zero handling, or min/max semantics.
 */
export function originalAggregateStatistics(
  statisticsForSelection: BookStatistic[],
  statisticsDataAggegrationMode: StatisticsReadingDataAggregationMode
): BookStatistic[] {
  let aggregatedStatisticsData: BookStatistic[] = [];
  if (statisticsDataAggegrationMode === StatisticsReadingDataAggregationMode.NONE) {
    aggregatedStatisticsData = statisticsForSelection;
  } else {
    const aggregationKey =
      statisticsDataAggegrationMode === StatisticsReadingDataAggregationMode.DATE
        ? 'dateKey'
        : 'title';
    const aggregrationMap = new Map<string, BookStatistic[]>();
    for (let index = 0, { length } = statisticsForSelection; index < length; index += 1) {
      const entry = statisticsForSelection[index];
      const keyValue = entry[aggregationKey];
      const entries = aggregrationMap.get(keyValue) || [];
      entries.push(entry);
      aggregrationMap.set(keyValue, entries);
    }
    const aggregationKeys = [...aggregrationMap.keys()];
    for (let index = 0, { length } = aggregationKeys; index < length; index += 1) {
      const key = aggregationKeys[index];
      const entries = aggregrationMap.get(key) || [];
      const statistic: BookStatistic = {
        ...getDefaultStatistic('-', '-'),
        ...{
          id: `${key}`,
          averageReadingTime: 0,
          averageWeightedReadingTime: 0,
          averageCharactersRead: 0,
          averageWeightedCharactersRead: 0,
          averageReadingSpeed: 0,
          averageWeightedReadingSpeed: 0
        }
      };
      let weightedSum = 0;
      let validReadingDays = 0;
      for (let index2 = 0, { length: length2 } = entries; index2 < length2; index2 += 1) {
        const entry = entries[index2];
        if (aggregationKey === 'title') {
          statistic.title = key;
        } else {
          statistic.dateKey = key;
        }
        statistic.readingTime += entry.readingTime;
        statistic.charactersRead += entry.charactersRead;
        statistic.minReadingSpeed = statistic.minReadingSpeed
          ? Math.min(statistic.minReadingSpeed, entry.minReadingSpeed)
          : entry.minReadingSpeed;
        statistic.altMinReadingSpeed = statistic.altMinReadingSpeed
          ? Math.min(statistic.altMinReadingSpeed, entry.altMinReadingSpeed)
          : statistic.altMinReadingSpeed;
        statistic.maxReadingSpeed = Math.max(statistic.maxReadingSpeed, entry.lastReadingSpeed);
        weightedSum += entry.readingTime * entry.charactersRead;
        if (statistic.readingTime) {
          validReadingDays += 1;
        }
      }
      statistic.lastReadingSpeed = statistic.readingTime
        ? Math.ceil((3600 * statistic.charactersRead) / statistic.readingTime)
        : 0;
      statistic.averageReadingTime = validReadingDays
        ? Math.ceil(statistic.readingTime / validReadingDays)
        : 0;
      statistic.averageWeightedReadingTime = statistic.charactersRead
        ? Math.ceil(weightedSum / statistic.charactersRead)
        : 0;
      statistic.averageCharactersRead = validReadingDays
        ? Math.ceil(statistic.charactersRead / validReadingDays)
        : 0;
      statistic.averageWeightedCharactersRead = statistic.readingTime
        ? Math.ceil(weightedSum / statistic.readingTime)
        : 0;
      statistic.averageReadingSpeed = statistic.averageReadingTime
        ? Math.ceil((3600 * statistic.averageCharactersRead) / statistic.averageReadingTime)
        : 0;
      statistic.averageWeightedReadingSpeed = statistic.averageWeightedReadingTime
        ? Math.ceil(
            (3600 * statistic.averageWeightedCharactersRead) / statistic.averageWeightedReadingTime
          )
        : 0;
      aggregatedStatisticsData.push(statistic);
    }
  }
  return aggregatedStatisticsData;
}
