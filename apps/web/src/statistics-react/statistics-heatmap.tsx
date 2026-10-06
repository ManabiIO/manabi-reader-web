/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import {
  Dom,
  AppIcon,
  Button,
  CloseButton,
  useLatest,
  useReaderBindings,
  type ReaderViewProps,
  Popover,
  ReaderScope
} from './primitives';
import {
  createStatisticsHeatmap,
  type StatisticsHeatmapProps
} from './statistics-heatmap-controller';

import {
  heatmapGridGapValue,
  heatmapDayMargins,
  HeatmapStreakType,
  HeatmapDataAggregration,
  HeatmapType
} from '$lib/components/statistics/statistics-heatmap/statistics-heatmap';

import { pluralize } from '$lib/functions/utils';

const faChevronLeft = 'faChevronLeft';
const faChevronRight = 'faChevronRight';
const faLayerGroup = 'faLayerGroup';
const faRepeat = 'faRepeat';
export function StatisticsHeatmap(props: Partial<StatisticsHeatmapProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createStatisticsHeatmap(props as StatisticsHeatmapProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-statistics-statistics-heatmap">
      <Dom as="div" className={['heatmap-toolbar'].filter(Boolean).join(' ')}>
        <Dom as="h2" className={['heatmap-toolbar-label'].filter(Boolean).join(' ')}>
          {' Reading '}
          {c.heatmapType === HeatmapType.STATISTICS ? '' : 'Goals '}
          {'Data for '}
          <Dom as="span" className={['heatmap-year'].filter(Boolean).join(' ')}>
            {c.heatmapYear}
          </Dom>
        </Dom>
        <Dom as="div" className={['heatmap-toolbar-actions'].filter(Boolean).join(' ')}>
          <Button
            variant={'ghost'}
            size={'icon'}
            shape={'circle'}
            aria-label={'Return to current year'}
            title={'Return to current year'}
            onClick={() => c.changeHeatmapYear(c.today.getFullYear() - c.heatmapYear)}
          >
            <AppIcon icon={faRepeat}></AppIcon>
          </Button>
          <Button
            variant={
              c.heatmapAggregration === HeatmapDataAggregration.ALL_TIME ? 'secondary' : 'ghost'
            }
            size={'icon'}
            shape={'circle'}
            aria-label={'Use all-time streak data'}
            aria-pressed={c.heatmapAggregration === HeatmapDataAggregration.ALL_TIME}
            title={'Switch streak data between all time and current year'}
            onClick={() =>
              (c.heatmapAggregration =
                c.heatmapAggregration === HeatmapDataAggregration.ALL_TIME
                  ? HeatmapDataAggregration.YEAR
                  : HeatmapDataAggregration.ALL_TIME)
            }
          >
            <AppIcon icon={faLayerGroup}></AppIcon>
          </Button>
        </Dom>
      </Dom>
      <Dom as="div" className={['flex items-center justify-between'].filter(Boolean).join(' ')}>
        <Button
          variant={'ghost'}
          size={'icon'}
          shape={'circle'}
          aria-label={'Previous heatmap period'}
          title={'Previous heatmap period'}
          onClick={() => {
            if (!c.heatmapElement) return;
            if (c.heatmapElement.scrollLeft === 0) {
              c.changeHeatmapYear(-1);
            } else {
              c.heatmapElement.scrollBy({
                top: 0,
                left: -(c.heatmapElement.clientWidth / 2),
                behavior: 'smooth'
              });
            }
          }}
        >
          <AppIcon icon={faChevronLeft}></AppIcon>
        </Button>
        <Dom
          as="div"
          role={'group'}
          aria-label={`${c.heatmapLabel}. Use arrow keys for days and weeks; Home and End for week boundaries.`}
          elementRef={(value: HTMLDivElement | null) => {
            c.heatmapElement = value;
          }}
          className={['heatmap-calendar grid min-w-0 flex-1 items-center overflow-x-auto py-1']
            .filter(Boolean)
            .join(' ')}
          style={{
            gridAutoColumns: `${c.dayElementSize}px`,
            gridAutoRows: `${c.dayElementSize}px`,
            gap: `${heatmapGridGapValue}px`,
            margin: `0 ${heatmapDayMargins}px`,
            scrollPaddingInlineStart: `${c.dayElementSize * 2 + heatmapGridGapValue * 2 + 4}px`
          }}
        >
          {(c.monthLabels ?? []).map((label, _index0) => (
            <React.Fragment key={label.monthLabel}>
              <Dom
                as="div"
                className={['text-xs md:text-sm'].filter(Boolean).join(' ')}
                style={{
                  gridRow: '1/1',
                  gridColumn: `${label.heatmapColumn}`,
                  height: `${c.dayElementSize}px`,
                  marginBottom: `${c.dayElementSize}px`
                }}
              >
                {label.monthLabel}
              </Dom>
            </React.Fragment>
          ))}
          <Dom
            as="div"
            className={['sticky left-0'].filter(Boolean).join(' ')}
            style={{
              gridRow: '1/1',
              gridColumn: '1/3',
              height: `${c.dayElementSize * 2}px`,
              backgroundColor: 'var(--background)'
            }}
          ></Dom>
          {(c.dayLabels ?? []).map((dayLabel, index) => (
            <React.Fragment key={dayLabel}>
              <Dom
                as="div"
                className={['sticky left-0 text-xs sm:text-sm'].filter(Boolean).join(' ')}
                style={{
                  gridRow: `${index + 2}/${index + 2}`,
                  gridColumn: '1/3',
                  backgroundColor: 'var(--background)'
                }}
              >
                {dayLabel}
              </Dom>
            </React.Fragment>
          ))}
          {(c.currentHeatmapDays ?? []).map((heatmapDay, _index1) => (
            <React.Fragment key={heatmapDay.dateString}>
              {(() => {
                const isToday = heatmapDay.dateString === c.todayKey;
                const isSelected =
                  !isToday &&
                  (heatmapDay.dateString === c.$lastStatisticsStartDate$ ||
                    heatmapDay.dateString === c.$lastStatisticsEndDate$);
                return (
                  <>
                    <Dom
                      as="button"
                      type={'button'}
                      tabIndex={
                        heatmapDay.isCurrentYear &&
                        heatmapDay.dateString === c.activeDay?.dateString
                          ? 0
                          : -1
                      }
                      disabled={!heatmapDay.isCurrentYear}
                      aria-hidden={!heatmapDay.isCurrentYear ? true : undefined}
                      aria-haspopup={heatmapDay.isCurrentYear ? 'dialog' : undefined}
                      aria-expanded={
                        heatmapDay.isCurrentYear
                          ? c.detailsOpen && c.popoverDetails[0] === heatmapDay.dateString
                          : undefined
                      }
                      aria-disabled={!heatmapDay.isCurrentYear}
                      aria-label={
                        heatmapDay.isCurrentYear ? heatmapDay.dayDetails.join('. ') : undefined
                      }
                      title={`${heatmapDay.isCurrentYear ? `${heatmapDay.dayDetails.join('\n')}` : ''}`}
                      data-date={heatmapDay.dateString}
                      className={[
                        'heatmap-day fadeIn justify-self-center',
                        heatmapDay.isCurrentYear && 'cursor-pointer',
                        heatmapDay.isCurrentYear && 'bg-heatmap-empty',
                        !heatmapDay.isCurrentYear && 'bg-heatmap-outside',
                        isSelected && 'border-amber-500',
                        isToday && 'border-red-500',
                        c.selectedStreakDates.has(heatmapDay.dateString) && 'highlight'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{
                        animationDelay: `${3 * heatmapDay.heatmapColumn}ms`,
                        height: `${c.dayElementSize}px`,
                        width: `${c.dayElementSize}px`,
                        gridRow: `${heatmapDay.heatmapRow}/${heatmapDay.heatmapRow}`,
                        gridColumn: `${heatmapDay.heatmapColumn}/${heatmapDay.heatmapColumn}`,
                        backgroundColor: heatmapDay.color || null,
                        borderWidth: `${isSelected || isToday ? '3' : '1'}px`
                      }}
                      events={{
                        click: (event: MouseEvent) => {
                          if (event.currentTarget instanceof HTMLElement)
                            c.openHeatmapDay(event.currentTarget, heatmapDay);
                        },
                        focus: () => (c.activeDate = heatmapDay.dateString),
                        keydown: (event: KeyboardEvent) =>
                          c.handleHeatmapDayKeydown(event, heatmapDay),
                        keyup: (event: KeyboardEvent) => event.stopPropagation()
                      }}
                    ></Dom>
                  </>
                );
              })()}
            </React.Fragment>
          ))}
        </Dom>
        <Button
          variant={'ghost'}
          size={'icon'}
          shape={'circle'}
          aria-label={'Next heatmap period'}
          title={'Next heatmap period'}
          onClick={() => {
            if (!c.heatmapElement) return;
            const scrollWidth =
              c.heatmapElement.scrollWidth - c.heatmapElement.scrollLeft - heatmapDayMargins;
            if (scrollWidth <= c.heatmapElement.clientWidth) {
              c.changeHeatmapYear(1);
            } else {
              c.heatmapElement.scrollBy({
                top: 0,
                left: c.heatmapElement.clientWidth / 2,
                behavior: 'smooth'
              });
            }
          }}
        >
          <AppIcon icon={faChevronRight}></AppIcon>
        </Button>
      </Dom>
      <Popover
        yOffset={5}
        label={'Reading day details'}
        dialog={true}
        isOpen={c.detailsOpen}
        restoreAnchorFocus={true}
        bindings={{
          isOpen: (value) => {
            c.detailsOpen = value;
          },
          this: (value) => {
            c.heatmapDetailDataPopover = value;
          }
        }}
      >
        <Dom as="div" slot={'content'} className={['heatmap-details'].filter(Boolean).join(' ')}>
          <Dom as="div" className={['heatmap-details-header'].filter(Boolean).join(' ')}>
            <Dom as="h2">{c.popoverDetails[0] ?? 'Reading day'}</Dom>
            <CloseButton
              aria-label={'Close heatmap details'}
              onClick={() => c.closeHeatmapDetails()}
            ></CloseButton>
          </Dom>
          {(c.popoverDetails.slice(1) ?? []).map((detail, index) => (
            <React.Fragment key={index}>
              <Dom as="p">{detail}</Dom>
            </React.Fragment>
          ))}
        </Dom>
      </Popover>
      {c.currentHeatmapData ? (
        <>
          {(() => {
            const isAllTime = c.heatmapAggregration === HeatmapDataAggregration.ALL_TIME;
            const mapAggregationlabel = `(${isAllTime ? 'All Time' : c.heatmapYear})`;
            const typeLabel = `${c.heatmapType === HeatmapType.STATISTICS ? 'day' : 'goal'}`;
            const daysReadLabel = `Days read ${mapAggregationlabel}:`;
            const readingGoalsCompletedLabel = `100% completed ${mapAggregationlabel}:`;
            const longestStreaksLabel = `Longest ${pluralize(c.currentHeatmapData.longestStreaks.length, 'Streak', false)} ${mapAggregationlabel}:`;
            const longestStreaksDuration = c.currentHeatmapData.longestStreaks[0]?.duration || 0;
            const longestStreaksCount = `${
              longestStreaksDuration
                ? ` (${pluralize(c.currentHeatmapData.longestStreaks.length, 'Time')})`
                : ''
            }`;
            const longestStreaksDays = `${longestStreaksDuration} ${pluralize(longestStreaksDuration, typeLabel, false)}`;
            const currentStreakLabel = `Current Streak ${mapAggregationlabel}:`;
            const currentStreakDays = pluralize(
              c.currentHeatmapData.currentStreak.duration,
              typeLabel
            );
            return (
              <>
                <Dom
                  as="div"
                  className={['mt-4 hidden grid-cols-3 justify-center text-center text-sm sm:grid']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {c.checkIsStatisticsHeatmapData(c.currentHeatmapData) ? (
                    <>
                      <Dom as="div">{daysReadLabel}</Dom>
                    </>
                  ) : (
                    <>
                      {' '}
                      <Dom
                        as="button"
                        title={'Highlight completed Reading Goals'}
                        events={{
                          click: () =>
                            c.highlightStreaks(
                              c.currentHeatmapData.streaks,
                              HeatmapStreakType.READING_GOALS_COMPLETED
                            )
                        }}
                      >
                        {readingGoalsCompletedLabel}
                      </Dom>
                    </>
                  )}
                  <Dom as="div">
                    <Dom
                      as="button"
                      title={'Highlight Streak'}
                      events={{
                        click: () =>
                          c.highlightStreaks(
                            c.currentHeatmapData.longestStreaks,
                            HeatmapStreakType.LONGEST
                          )
                      }}
                    >
                      {longestStreaksLabel}
                    </Dom>
                  </Dom>
                  <Dom as="div">
                    <Dom
                      as="button"
                      title={'Highlight Streak'}
                      events={{
                        click: () =>
                          c.highlightStreaks(
                            c.currentHeatmapData.currentStreak.duration
                              ? [c.currentHeatmapData.currentStreak]
                              : [],
                            HeatmapStreakType.CURRENT
                          )
                      }}
                    >
                      {currentStreakLabel}
                    </Dom>
                  </Dom>
                  {c.checkIsStatisticsHeatmapData(c.currentHeatmapData) ? (
                    <>
                      <Dom as="div">{c.currentHeatmapData.daysRead}</Dom>
                    </>
                  ) : (
                    <>
                      {' '}
                      <Dom
                        as="button"
                        title={'Highlight completed Reading Goals'}
                        events={{
                          click: () =>
                            c.highlightStreaks(
                              c.currentHeatmapData.streaks,
                              HeatmapStreakType.READING_GOALS_COMPLETED
                            )
                        }}
                      >
                        {c.currentHeatmapData.completedReadingGoals}
                      </Dom>
                    </>
                  )}
                  <Dom as="div">
                    <Dom
                      as="button"
                      title={'Highlight Streak'}
                      events={{
                        click: () =>
                          c.highlightStreaks(
                            c.currentHeatmapData.longestStreaks,
                            HeatmapStreakType.LONGEST
                          )
                      }}
                    >
                      {longestStreaksDays}
                      {longestStreaksCount}
                    </Dom>
                  </Dom>
                  <Dom as="div">
                    <Dom
                      as="button"
                      title={'Highlight Streak'}
                      events={{
                        click: () =>
                          c.highlightStreaks(
                            c.currentHeatmapData.currentStreak.duration
                              ? [c.currentHeatmapData.currentStreak]
                              : [],
                            HeatmapStreakType.CURRENT
                          )
                      }}
                    >
                      {currentStreakDays}
                    </Dom>
                  </Dom>
                </Dom>
                <Dom
                  as="div"
                  className={['mt-4 grid grid-cols-[auto_auto] gap-y-2 text-xs sm:hidden']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {c.checkIsStatisticsHeatmapData(c.currentHeatmapData) ? (
                    <>
                      <Dom as="div">{daysReadLabel}</Dom>
                      <Dom as="div">{c.currentHeatmapData.daysRead}</Dom>
                    </>
                  ) : (
                    <>
                      {' '}
                      <Dom
                        as="button"
                        title={'Highlight completed Reading Goals'}
                        className={['text-left'].filter(Boolean).join(' ')}
                        events={{
                          click: () =>
                            c.highlightStreaks(
                              c.currentHeatmapData.streaks,
                              HeatmapStreakType.READING_GOALS_COMPLETED
                            )
                        }}
                      >
                        {readingGoalsCompletedLabel}
                      </Dom>
                      <Dom
                        as="button"
                        title={'Highlight completed Reading Goals'}
                        className={['text-left'].filter(Boolean).join(' ')}
                        events={{
                          click: () =>
                            c.highlightStreaks(
                              c.currentHeatmapData.streaks,
                              HeatmapStreakType.READING_GOALS_COMPLETED
                            )
                        }}
                      >
                        {c.currentHeatmapData.completedReadingGoals}
                      </Dom>
                    </>
                  )}
                  <Dom
                    as="button"
                    title={'Highlight Streak'}
                    className={['text-left'].filter(Boolean).join(' ')}
                    events={{
                      click: () =>
                        c.highlightStreaks(
                          c.currentHeatmapData.longestStreaks,
                          HeatmapStreakType.LONGEST
                        )
                    }}
                  >
                    {longestStreaksLabel}
                  </Dom>
                  <Dom
                    as="button"
                    title={'Highlight Streak'}
                    className={['text-left'].filter(Boolean).join(' ')}
                    events={{
                      click: () =>
                        c.highlightStreaks(
                          c.currentHeatmapData.longestStreaks,
                          HeatmapStreakType.LONGEST
                        )
                    }}
                  >
                    {longestStreaksDays}
                    {longestStreaksCount}
                  </Dom>
                  <Dom as="div">
                    <Dom
                      as="button"
                      title={'Highlight Streak'}
                      events={{
                        click: () =>
                          c.highlightStreaks(
                            c.currentHeatmapData.currentStreak.duration
                              ? [c.currentHeatmapData.currentStreak]
                              : [],
                            HeatmapStreakType.CURRENT
                          )
                      }}
                    >
                      {currentStreakLabel}
                    </Dom>
                  </Dom>
                  <Dom as="div">
                    <Dom
                      as="button"
                      title={'Highlight Streak'}
                      events={{
                        click: () =>
                          c.highlightStreaks(
                            c.currentHeatmapData.currentStreak.duration
                              ? [c.currentHeatmapData.currentStreak]
                              : [],
                            HeatmapStreakType.CURRENT
                          )
                      }}
                    >
                      {currentStreakDays}
                    </Dom>
                  </Dom>
                </Dom>
              </>
            );
          })()}
        </>
      ) : null}
    </ReaderScope>
  );
}
