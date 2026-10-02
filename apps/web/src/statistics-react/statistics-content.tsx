/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useReaderController } from '../reader-react/controller';
import {
  Dom,
  SurfaceEvents,
  AppIcon,
  Sheet,
  useLatest,
  useReaderBindings,
  type ReaderViewProps,
  ReaderScope
} from './primitives';
import {
  createStatisticsContent,
  type StatisticsContentProps
} from './statistics-content-controller';

import { HeatmapType } from '$lib/components/statistics/statistics-heatmap/statistics-heatmap';

import { StatisticsTab } from '$lib/components/statistics/statistics-types';

import { StatisticsHeatmap } from './statistics-heatmap';
import { StatisticsSummary } from './statistics-summary';
import { StatisticsTitleFilter } from './statistics-title-filter';

const faSpinner = 'faSpinner';
export function StatisticsContent(props: Partial<StatisticsContentProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createStatisticsContent(props as StatisticsContentProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-statistics-statistics-content">
      {c.$copyStatisticsDataHandler$ ?? ''}
      {c.$exportStatisticsDataHandler$ ?? ''}
      {c.$exportRawStatisticsHandler$ ?? ''}
      {c.$deleteStatisticsDataHandler$ ?? ''}
      {c.$setStatisticsDatesToAllTimeHandler$ ?? ''}
      <SurfaceEvents target="window" events={{ keyup: c.onKeyUp }}></SurfaceEvents>
      {c.isLoading ? (
        <>
          <Dom
            as="div"
            className={['fixed inset-0 flex h-full w-full items-center justify-center text-7xl']
              .filter(Boolean)
              .join(' ')}
          >
            <AppIcon icon={faSpinner} spin={true}></AppIcon>
          </Dom>
        </>
      ) : (
        <>
          {' '}
          {c.$lastStatisticsTab$ === StatisticsTab.OVERVIEW ? (
            <>
              <StatisticsHeatmap
                statisticsData={c.bookPrefilterStatistics}
                readingGoals={c.readingGoals}
                statisticsTitleFilters={c.statisticsTitleFilters}
                today={c.today}
                todayKey={c.todayKey}
                heatmapAggregration={c.$lastReadingDataHeatmapAggregationMode$}
                bindings={{
                  heatmapAggregration: (value) => {
                    c.$lastReadingDataHeatmapAggregationMode$ = value;
                  }
                }}
              ></StatisticsHeatmap>
              {c.readingGoals.length ? (
                <>
                  <Dom as="div" className={['mt-8 sm:mt-16'].filter(Boolean).join(' ')}>
                    <StatisticsHeatmap
                      statisticsData={c.bookPrefilterStatistics}
                      readingGoals={c.readingGoals}
                      statisticsTitleFilters={c.statisticsTitleFilters}
                      today={c.today}
                      todayKey={c.todayKey}
                      heatmapType={HeatmapType.READING_GOALS}
                      heatmapAggregration={c.$lastReadingGoalsHeatmapAggregationMode$}
                      bindings={{
                        heatmapAggregration: (value) => {
                          c.$lastReadingGoalsHeatmapAggregationMode$ = value;
                        }
                      }}
                    ></StatisticsHeatmap>
                  </Dom>
                </>
              ) : null}
            </>
          ) : null}
          {c.$lastStatisticsTab$ === StatisticsTab.SUMMARY ? (
            <>
              <StatisticsSummary
                aggregratedStatistics={c.aggregratedStatistics}
                statisticsDateRangeLabel={c.statisticsDateRangeLabel}
                events={{ delete: c.handleDeleteRequest, edit: c.handleEditRequest }}
              ></StatisticsSummary>
            </>
          ) : null}
        </>
      )}
      <Sheet.Root
        open={c.$statisticsTitleFilterIsOpen$}
        onOpenChange={(open) => (c.$statisticsTitleFilterIsOpen$ = open)}
      >
        <Sheet.Content
          side={'right'}
          showCloseButton={false}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            document.querySelector<HTMLButtonElement>('[title="Open Title Filter Menu"]')?.focus();
          }}
          className={['data-[side=right]:w-full data-[side=right]:sm:max-w-xl']
            .filter(Boolean)
            .join(' ')}
        >
          <Sheet.Description className={['sr-only'].filter(Boolean).join(' ')}>
            {'Choose the books included in reading statistics.'}
          </Sheet.Description>
          <StatisticsTitleFilter
            statisticsTitleFilters={c.statisticsTitleFilters}
            titlesInStatisticsDateRange={c.titlesInStatisticsDateRange}
            events={{
              applyFilter: c.updateTitleFilter,
              clearPrefilter: c.clearPrefilter,
              close: () => (c.$statisticsTitleFilterIsOpen$ = false)
            }}
          ></StatisticsTitleFilter>
        </Sheet.Content>
      </Sheet.Root>
      {c.$statisticsActionInProgress$ ? (
        <>
          <Dom
            as="div"
            className={['fixed inset-0 z-[70] bg-black/[.2] tap-highlight-transparent']
              .filter(Boolean)
              .join(' ')}
          ></Dom>
          <Dom
            as="div"
            className={['fixed inset-0 flex h-full w-full items-center justify-center text-7xl']
              .filter(Boolean)
              .join(' ')}
          >
            <AppIcon icon={faSpinner} spin={true}></AppIcon>
          </Dom>
        </>
      ) : null}
    </ReaderScope>
  );
}
