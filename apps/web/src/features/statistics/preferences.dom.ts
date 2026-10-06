/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Read-only preference bootstrap owned by the existing DOM runtime. */
import {
  lastStatisticsStartDate$,
  lastStatisticsEndDate$,
  lastStartDayOfWeek$,
  lastStatisticsRangeTemplate$,
  lastPrimaryReadingDataAggregationMode$,
  lastReadingTimeDataSource$,
  lastCharactersDataSource$,
  lastReadingSpeedDataSource$,
  lastStatisticsSummarySortProperty$,
  lastStatisticsSummarySortDirection$,
  lastReadingDataHeatmapAggregationMode$,
  lastReadingGoalsHeatmapAggregationMode$,
  startDayHoursForTracker$,
  confirmStatisticsDeletion$
} from '$lib/data/store';
import { get } from '$lib/state/store';
import {
  StatisticsRangeTemplate,
  StatisticsReadingDataAggregationMode,
  preFilteredTitlesForStatistics$,
  preFilteredBookKeysForStatistics$
} from '$lib/components/statistics/statistics-types';
import { HeatmapDataAggregration } from '$lib/components/statistics/statistics-heatmap/statistics-heatmap';
import { getDateString, getStartHoursDate } from '$lib/functions/statistic-util';
import type { StatisticsQuery } from './contract';
import { statisticsDateTemplate } from './controller';
export function readStatisticsQueryPreferences(includePrefilter = true): Partial<StatisticsQuery> {
  const today = getDateString(getStartHoursDate(get(startDayHoursForTracker$)));
  const aggregation = get(lastPrimaryReadingDataAggregationMode$);
  const sort = get(lastStatisticsSummarySortProperty$);
  const rangeTemplate = get(lastStatisticsRangeTemplate$);
  const weekStartsOn = get(lastStartDayOfWeek$);
  const titles = includePrefilter ? [...get(preFilteredTitlesForStatistics$)] : [];
  return {
    startDate: get(lastStatisticsStartDate$) || today,
    endDate: get(lastStatisticsEndDate$) || today,
    ...(rangeTemplate !== StatisticsRangeTemplate.CUSTOM
      ? statisticsDateTemplate(rangeTemplate, today, weekStartsOn)
      : {}),
    year: Number(today.slice(0, 4)),
    goalYear: Number(today.slice(0, 4)),
    weekStartsOn,
    rangeTemplate,
    confirmDeletion: get(confirmStatisticsDeletion$),
    aggregation:
      aggregation === StatisticsReadingDataAggregationMode.TITLE
        ? 'title'
        : aggregation === StatisticsReadingDataAggregationMode.DATE
          ? 'date'
          : 'none',
    sort:
      sort === 'title'
        ? 'title'
        : sort === 'dateKey'
          ? 'date'
          : sort.toLowerCase().includes('time')
            ? 'time'
            : sort.toLowerCase().includes('characters')
              ? 'characters'
              : 'speed',
    direction: get(lastStatisticsSummarySortDirection$),
    timeSource: get(lastReadingTimeDataSource$) as StatisticsQuery['timeSource'],
    charactersSource: get(lastCharactersDataSource$) as StatisticsQuery['charactersSource'],
    speedSource: get(lastReadingSpeedDataSource$) as StatisticsQuery['speedSource'],
    prefilteredBookKeys: includePrefilter ? [...get(preFilteredBookKeysForStatistics$)] : [],
    prefilteredTitles: titles,
    ...(titles.length ? { selectedTitles: titles } : {}),
    heatmapAggregation:
      get(lastReadingDataHeatmapAggregationMode$) === HeatmapDataAggregration.ALL_TIME
        ? 'all-time'
        : 'year',
    goalHeatmapAggregation:
      get(lastReadingGoalsHeatmapAggregationMode$) === HeatmapDataAggregration.ALL_TIME
        ? 'all-time'
        : 'year'
  };
}
