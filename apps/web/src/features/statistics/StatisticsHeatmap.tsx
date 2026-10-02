/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { isRtlTarget } from '../../shared-ui/layout-direction';
import { UiIcon } from '../../shared-ui/UiIcon';
import { UiText as Text } from '../../shared-ui/Typography';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { ActionButton, useUiTheme } from '../../shared-ui/StatisticsPrimitives';
import {
  CalendarLayout,
  CalendarHeading,
  CalendarYear,
  CalendarControls,
  calendarCellStyle,
  calendarLabelStyle,
  type CalendarHandle
} from '../../shared-ui/CalendarLayout';
import { AnchoredPopover } from '../../shared-ui/AnchoredPopover';
import {
  heatmapCellSize,
  heatmapNavigationDate
} from '../../lib/components/statistics/statistics-heatmap/heatmap-navigation';
import { calendarColumns, months, weekdays, type StatisticsViewProps } from './view-model';

export function StatisticsHeatmap({
  state,
  dispatch,
  goal = false
}: StatisticsViewProps & { goal?: boolean }) {
  const { colors } = useUiTheme();
  const { width } = useWindowDimensions();
  const { data, query: q } = state;
  const displayYear = goal ? q.goalYear : q.year;
  const columns = useMemo(
    () => calendarColumns((goal ? data?.goalDays : data?.days) ?? [], displayYear, q.weekStartsOn),
    [data, displayYear, q.weekStartsOn, goal]
  );
  const navigationDays = useMemo(
    () =>
      columns.flatMap((column, x) =>
        column.map((day, y) => ({
          dateString: day!.date,
          isCurrentYear: day!.inYear,
          heatmapRow: y + 2,
          heatmapColumn: x + 3
        }))
      ),
    [columns]
  );
  const [gridWidth, setGridWidth] = useState(0);
  const [activeDate, setActiveDate] = useState<string>();
  const calendar = useRef<CalendarHandle>(null);
  const buttons = useRef(new Map<string, View>());
  const cellSize = heatmapCellSize(gridWidth, 15, 1, 57);
  const active = activeDate?.startsWith(String(displayYear))
    ? activeDate
    : data?.today.startsWith(String(displayYear))
      ? data.today
      : `${displayYear}-01-01`;
  const aggregation = goal ? q.goalHeatmapAggregation : q.heatmapAggregation;
  const stats = goal ? data?.goalStats : data;
  const currentHighlight = goal ? state.goalHighlight : state.highlight;
  const highlighted = useMemo(
    () =>
      new Set(
        currentHighlight
          ? currentHighlight.kind === 'longest'
            ? stats?.longestStreakDates
            : currentHighlight.kind === 'current'
              ? stats?.currentStreakDates
              : data?.goalStats?.completedDates
          : []
      ),
    [currentHighlight, stats, data, goal]
  );
  useEffect(() => {
    setActiveDate(undefined);
  }, [displayYear]);
  useEffect(() => {
    if (!highlighted.size) return;
    const date = [...highlighted][0];
    const day = navigationDays.find((day) => day.dateString === date);
    if (day) calendar.current?.revealColumn(day.heatmapColumn);
  }, [highlighted, navigationDays]);
  const year = (direction: -1 | 1) => {
    if (calendar.current?.movePeriod(direction) !== false)
      void dispatch({
        type: 'query',
        patch: { [goal ? 'goalYear' : 'year']: displayYear + direction }
      });
  };
  const highlight = (kind: 'longest' | 'current' | 'completed') =>
    void dispatch({ type: 'highlight', kind, goal });
  const suffix = aggregation === 'all-time' ? 'All Time' : displayYear;
  return (
    <View
      style={{ minWidth: 0 }}
      testID={goal ? 'statistics-goals-heatmap' : 'statistics-reading-heatmap'}
    >
      <View style={styles.toolbar}>
        <CalendarHeading>
          Reading {goal ? 'Goals ' : ''}Data for <CalendarYear>{displayYear}</CalendarYear>
        </CalendarHeading>
        <CalendarControls>
          <ActionButton
            variant="ghost"
            shape="circle"
            accessibilityLabel="Return to current year"
            title="Return to current year"
            disabled={state.busy}
            onPress={() =>
              void dispatch({
                type: 'query',
                patch: {
                  [goal ? 'goalYear' : 'year']: Number(
                    data?.today.slice(0, 4) ?? new Date().getFullYear()
                  )
                }
              })
            }
          >
            <UiIcon name="repeat" />
          </ActionButton>
          <ActionButton
            variant={aggregation === 'all-time' ? 'secondary' : 'ghost'}
            shape="circle"
            accessibilityLabel="Use all-time streak data"
            title="Switch streak data between all time and current year"
            selected={aggregation === 'all-time'}
            disabled={state.busy}
            onPress={() =>
              void dispatch({
                type: 'query',
                patch: {
                  [goal ? 'goalHeatmapAggregation' : 'heatmapAggregation']:
                    aggregation === 'all-time' ? 'year' : 'all-time'
                }
              })
            }
          >
            <UiIcon name="layers" />
          </ActionButton>
        </CalendarControls>
      </View>
      <View style={styles.calendarRow}>
        <ActionButton
          variant="ghost"
          shape="circle"
          accessibilityLabel="Previous heatmap period"
          title="Previous heatmap period"
          disabled={state.busy}
          onPress={() => year(-1)}
        >
          <UiIcon name="previous" />
        </ActionButton>
        <CalendarLayout
          ref={calendar}
          label={`Reading ${goal ? 'Goals ' : ''}Data for ${displayYear}. Use arrow keys for days and weeks; Home and End for week boundaries.`}
          cellSize={cellSize}
          columns={columns.length}
          onWidth={setGridWidth}
        >
          {columns.map((column, index) => {
            const first = column.find((day) => day?.inYear && day.dayOfMonth === 1);
            return (
              first && (
                <Text
                  key={`month-${first.month}`}
                  style={[
                    calendarLabelStyle(1, index + 4, cellSize),
                    { fontSize: width >= 768 ? 14 : 12, color: colors.foreground }
                  ]}
                >
                  {months[first.month]}
                </Text>
              )
            );
          })}
          {Array.from({ length: 7 }, (_, row) => (
            <Text
              key={`weekday-${row}`}
              style={[
                calendarLabelStyle(row + 2, 1, cellSize),
                {
                  backgroundColor: colors.background,
                  color: colors.foreground,
                  fontSize: width >= 640 ? 14 : 12
                }
              ]}
            >
              {weekdays[(q.weekStartsOn + row) % 7].slice(0, 3)}
            </Text>
          ))}
          {columns.flatMap((column, x) =>
            column.map((item, y) => {
              if (!item) return null;
              const today = item.date === data?.today;
              const selected = !today && (item.date === q.startDate || item.date === q.endDate);
              return (
                <ActionButton
                  key={item.date}
                  ref={(ref) => {
                    if (ref) buttons.current.set(item.date, ref);
                    else buttons.current.delete(item.date);
                  }}
                  variant="ghost"
                  disabled={!item.inYear}
                  accessibilityLabel={
                    item.inYear ? item.day?.details.join('. ') || item.date : undefined
                  }
                  accessibilityElementsHidden={!item.inYear}
                  aria-hidden={!item.inYear}
                  aria-haspopup={item.inYear ? 'dialog' : undefined}
                  aria-expanded={
                    item.inYear
                      ? state.selectedDay === item.date && !!state.selectedDayGoal === goal
                      : undefined
                  }
                  title={item.inYear ? item.day?.details.join('\n') || item.date : ''}
                  dataSet={{
                    date: item.date,
                    highlighted: highlighted.has(item.date) ? 'true' : 'false'
                  }}
                  testID={`${goal ? 'goal' : 'reading'}-day-${item.date}`}
                  tabIndex={item.inYear && active === item.date ? 0 : -1}
                  onFocus={() => setActiveDate(item.date)}
                  onKeyDown={(event) => {
                    const next = heatmapNavigationDate(
                      navigationDays,
                      item.date,
                      event.key,
                      isRtlTarget(event.currentTarget),
                      event.ctrlKey || event.metaKey
                    );
                    if (!next) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setActiveDate(next);
                    buttons.current.get(next)?.focus();
                    const nextDay = navigationDays.find((day) => day.dateString === next);
                    if (nextDay) calendar.current?.revealColumn(nextDay.heatmapColumn);
                  }}
                  onPress={() => {
                    setActiveDate(item.date);
                    void dispatch({ type: 'day', date: item.date, goal });
                  }}
                  style={[
                    calendarCellStyle(y + 2, x + 3, cellSize),
                    {
                      minWidth: cellSize,
                      minHeight: cellSize,
                      // Override the shared button axis padding, not only the
                      // shorthand (RN gives axis padding precedence).
                      paddingHorizontal: 0,
                      paddingVertical: 0,
                      borderRadius: 3,
                      backgroundColor: item.inYear
                        ? item.day?.color || colors.heatmapEmpty
                        : colors.heatmapOutside,
                      borderWidth: today || selected ? 3 : 1,
                      borderColor: today
                        ? colors.heatmapToday
                        : selected
                          ? colors.heatmapSelected
                          : highlighted.has(item.date)
                            ? colors.primary
                            : colors.border,
                      ...(highlighted.has(item.date)
                        ? { outlineWidth: 2, outlineColor: colors.primary, outlineStyle: 'solid' }
                        : {})
                    }
                  ]}
                >
                  {null}
                </ActionButton>
              );
            })
          )}
        </CalendarLayout>
        <ActionButton
          variant="ghost"
          shape="circle"
          accessibilityLabel="Next heatmap period"
          title="Next heatmap period"
          disabled={state.busy}
          onPress={() => year(1)}
        >
          <UiIcon name="next" />
        </ActionButton>
      </View>
      <AnchoredPopover
        visible={!!state.selectedDay && !!state.selectedDayGoal === goal}
        onClose={() => void dispatch({ type: 'day' })}
        title={state.selectedDay ?? 'Reading day'}
        label="Reading day details"
        closeLabel="Close heatmap details"
        anchor={buttons.current.get(state.selectedDay ?? '')}
      >
        {(goal ? data?.goalDays : data?.days)
          ?.find((day) => day.date === state.selectedDay)
          ?.details.slice(1)
          .map((detail, index) => (
            <Text key={index} style={{ color: colors.foreground, marginTop: index ? 8 : 0 }}>
              {detail}
            </Text>
          ))}
      </AnchoredPopover>
      <View
        style={[
          styles.metrics,
          { flexDirection: width >= 640 ? 'row' : 'column', gap: width >= 640 ? 16 : 8 }
        ]}
      >
        {goal ? (
          <ActionButton
            variant="ghost"
            title="Highlight completed Reading Goals"
            onPress={() => highlight('completed')}
            style={styles.metric}
            textStyle={{ fontSize: width >= 640 ? 14 : 12 }}
          >{`100% completed (${suffix}):\n${data?.goalStats?.completed ?? '0'}`}</ActionButton>
        ) : (
          <Text
            style={[styles.metric, { color: colors.foreground, fontSize: width >= 640 ? 14 : 12 }]}
          >{`Days read (${suffix}):${width >= 640 ? '\n' : ' '}${data?.daysRead ?? '0'}`}</Text>
        )}
        <ActionButton
          variant="ghost"
          title="Highlight Streak"
          onPress={() => highlight('longest')}
          style={styles.metric}
          textStyle={{ fontSize: width >= 640 ? 14 : 12 }}
        >{`Longest Streak${stats?.longestStreakCount === 1 ? '' : 's'} (${suffix}):${width >= 640 ? '\n' : ' '}${stats?.longestStreak ?? 0} ${goal ? 'goal' : 'day'}${stats?.longestStreak === 1 ? '' : 's'}${stats?.longestStreak ? ` (${stats.longestStreakCount ?? 1} ${(stats.longestStreakCount ?? 1) === 1 ? 'Time' : 'Times'})` : ''}`}</ActionButton>
        <ActionButton
          variant="ghost"
          title="Highlight Streak"
          onPress={() => highlight('current')}
          style={styles.metric}
          textStyle={{ fontSize: width >= 640 ? 14 : 12 }}
        >{`Current Streak (${suffix}):${width >= 640 ? '\n' : ' '}${stats?.currentStreak ?? 0} ${goal ? 'goal' : 'day'}${stats?.currentStreak === 1 ? '' : 's'}`}</ActionButton>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16
  },
  calendarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: 0
  },
  metrics: { marginTop: 16, justifyContent: 'center', alignItems: 'stretch' },
  metric: { flex: 1, paddingHorizontal: 0, paddingVertical: 0, minWidth: 0, textAlign: 'center' }
});
