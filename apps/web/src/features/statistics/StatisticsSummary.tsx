/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { AnchoredPopover } from '../../shared-ui/AnchoredPopover';
import { UiIcon } from '../../shared-ui/UiIcon';
import { UiText as Text } from '../../shared-ui/Typography';
import { useState } from 'react';
import { FlatList, Pressable, View, StyleSheet, useWindowDimensions } from 'react-native';
import {
  ActionButton,
  ChoiceField,
  TextField,
  CheckboxField,
  useUiTheme
} from '../../shared-ui/StatisticsPrimitives';
import {
  statisticsCharactersSources,
  statisticsSpeedSources,
  statisticsTimeSources,
  type StatisticsQuery,
  type StatisticsRow
} from './contract';
import {
  minutes,
  measurementDetails,
  rangeLabel,
  summaryWeights,
  type StatisticsViewProps
} from './view-model';

export function StatisticsSummary({ state, dispatch }: StatisticsViewProps) {
  const { colors } = useUiTheme();
  const { width } = useWindowDimensions();
  const [details, setDetails] = useState<{ lines: string[]; anchor: View }>();
  const [pagesOpen, setPagesOpen] = useState(false);
  const [pagesAnchor, setPagesAnchor] = useState<View>();
  const { data, query: q, editor } = state;
  const wide = width >= 768;
  const columns: {
    key: StatisticsQuery['sort'];
    label: string;
    options?: readonly { key: string; label: string }[];
    value?: string;
  }[] = [
    ...(q.aggregation !== 'title' ? [{ key: 'date' as const, label: 'Date' }] : []),
    ...(q.aggregation !== 'date' ? [{ key: 'title' as const, label: 'Title' }] : []),
    {
      key: 'time',
      label: statisticsTimeSources.find((item) => item.key === q.timeSource)!.label,
      options: statisticsTimeSources,
      value: q.timeSource
    },
    {
      key: 'characters',
      label: statisticsCharactersSources.find((item) => item.key === q.charactersSource)!.label,
      options: statisticsCharactersSources,
      value: q.charactersSource
    },
    {
      key: 'speed',
      label: statisticsSpeedSources.find((item) => item.key === q.speedSource)!.label,
      options: statisticsSpeedSources,
      value: q.speedSource
    }
  ];
  const weights = summaryWeights(q.aggregation, width);
  const columnStyle = (column: (typeof columns)[number], index: number) =>
    column.key === 'date' ? styles.dateColumn : { flex: weights[index + 1], minWidth: 0 };
  const sort = (property: StatisticsQuery['sort']) =>
    void dispatch({
      type: 'query',
      patch: {
        sort: property,
        direction: q.sort === property ? (q.direction === 'asc' ? 'desc' : 'asc') : q.direction
      }
    });
  const header = (column: (typeof columns)[number]) => (
    <View style={styles.headerCell}>
      {column.options ? (
        <ChoiceField
          compact
          accessibilityLabel={`Choose ${column.key} measurement`}
          value={column.value!}
          options={column.options.map((option) => ({ value: option.key, label: option.label }))}
          disabled={!!editor || state.busy}
          onValueChange={(value) =>
            void dispatch({
              type: 'query',
              patch: {
                [column.key === 'time'
                  ? 'timeSource'
                  : column.key === 'characters'
                    ? 'charactersSource'
                    : 'speedSource']: value,
                sort: column.key
              }
            })
          }
          style={{ flex: 1 }}
        />
      ) : (
        <ActionButton
          variant="ghost"
          disabled={!!editor || state.busy}
          onPress={() => sort(column.key)}
          textStyle={{ textAlign: 'left' }}
          style={styles.headerLabel}
        >
          {column.label}
        </ActionButton>
      )}
      <ActionButton
        variant="ghost"
        accessibilityLabel={`Sort by ${column.label}`}
        title="Click to select/sort by this Attribute"
        disabled={!!editor || state.busy}
        onPress={() => sort(column.key)}
        size="icon-sm"
        shape="rounded"
        style={{ paddingHorizontal: 4 }}
      >
        <UiIcon
          name={q.direction === 'asc' ? 'sortAscending' : 'sortDescending'}
          color={q.sort === column.key ? colors.primary : colors.mutedForeground}
        />
      </ActionButton>
    </View>
  );
  const cell = (row: StatisticsRow, column: (typeof columns)[number]) => {
    const editing = editor?.row.id === row.id;
    if (editing && column.key === 'time')
      return (
        <TextField
          type="number"
          accessibilityLabel={`Reading time for ${row.title} (seconds)`}
          value={editor.time}
          onChangeText={(time) => void dispatch({ type: 'editor', patch: { time } })}
          editable={!state.busy}
        />
      );
    if (editing && column.key === 'characters')
      return (
        <TextField
          type="number"
          accessibilityLabel={`Characters read for ${row.title}`}
          value={editor.characters}
          onChangeText={(characters) => void dispatch({ type: 'editor', patch: { characters } })}
          editable={!state.busy}
        />
      );
    if (editing && column.key === 'speed')
      return (
        <CheckboxField
          label="Reset Min/Max Speed"
          value={editor.resetMinMax}
          disabled={state.busy}
          onValueChange={(resetMinMax) => void dispatch({ type: 'editor', patch: { resetMinMax } })}
        />
      );
    if (column.key === 'title')
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Show full title ${row.title}`}
          onPress={(event) =>
            setDetails({ lines: [row.title], anchor: event.currentTarget as unknown as View })
          }
          style={styles.detailTarget}
        >
          <Text numberOfLines={2} style={[styles.cellText, { color: colors.foreground }]}>
            {row.title}
          </Text>
        </Pressable>
      );
    if (column.key === 'date')
      return <Text style={[styles.cellText, { color: colors.foreground }]}>{row.date}</Text>;
    const key =
      column.key === 'time'
        ? 'readingTime'
        : column.key === 'characters'
          ? 'charactersRead'
          : 'lastReadingSpeed';
    const blurred = state.data?.blurredMeasurements?.includes(key);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${column.label} details for ${row.title || row.date}`}
        onPress={(event) =>
          setDetails({
            lines: measurementDetails(row, column.key as 'time' | 'characters' | 'speed'),
            anchor: event.currentTarget as unknown as View
          })
        }
        style={styles.detailTarget}
      >
        <Text style={[styles.cellText, { color: colors.foreground, opacity: blurred ? 0 : 1 }]}>
          {column.key === 'time'
            ? `${minutes(row.measurements[q.timeSource])} min`
            : column.key === 'characters'
              ? row.measurements[q.charactersSource]
              : `${row.measurements[q.speedSource]} / h`}
        </Text>
        {blurred && (
          <Text
            accessibilityLabel="Hidden measurement"
            style={{ position: 'absolute', color: colors.mutedForeground }}
          >
            ••••
          </Text>
        )}
      </Pressable>
    );
  };
  const actions = (row: StatisticsRow) => (
    <View style={styles.rowActions}>
      <ActionButton
        variant={editor?.row.id === row.id ? 'ghost' : 'destructive'}
        size="icon-sm"
        shape="circle"
        accessibilityLabel={editor?.row.id === row.id ? 'Cancel edit' : `Delete row ${row.title}`}
        disabled={state.busy || (!!editor && editor.row.id !== row.id)}
        onPress={() =>
          void dispatch(
            editor?.row.id === row.id ? { type: 'close-editor' } : { type: 'delete-row', row }
          )
        }
      >
        <UiIcon name={editor?.row.id === row.id ? 'close' : 'trash'} />
      </ActionButton>
      {row.entry && (
        <ActionButton
          variant="ghost"
          size="icon-sm"
          shape="circle"
          accessibilityLabel={editor?.row.id === row.id ? 'Save changes' : `Edit row ${row.title}`}
          disabled={state.busy || (!!editor && editor.row.id !== row.id)}
          onPress={() =>
            void dispatch(
              editor?.row.id === row.id ? { type: 'save-editor' } : { type: 'edit', row }
            )
          }
        >
          <UiIcon name={editor?.row.id === row.id ? 'save' : 'edit'} />
        </ActionButton>
      )}
    </View>
  );
  return (
    <View testID="statistics-summary" style={{ minWidth: 0 }}>
      {!!data?.rows.length && (
        <Text style={[styles.range, { color: colors.mutedForeground }]}>
          Data for {data?.dateRangeLabel ?? rangeLabel(q)}
        </Text>
      )}
      {!data?.rows.length ? (
        <Text
          role="status"
          style={[
            data?.allTitles?.length ? styles.emptyRange : styles.empty,
            { color: colors.foreground }
          ]}
        >
          No Data found for {data?.dateRangeLabel ?? rangeLabel(q)}
        </Text>
      ) : (
        <View
          style={[styles.table, { borderColor: colors.border }]}
          role="table"
          accessibilityLabel="Reading statistics"
        >
          {wide && (
            <View
              role="row"
              style={[
                styles.wideRow,
                styles.tableHeader,
                { backgroundColor: colors.card, borderBottomColor: colors.border }
              ]}
            >
              {columns.map((column, index) => (
                <View key={column.key} role="columnheader" style={columnStyle(column, index)}>
                  {header(column)}
                </View>
              ))}
              <View role="columnheader" style={styles.actionsColumn}>
                <Text style={[styles.actionsLabel, { color: colors.mutedForeground }]}>
                  Actions
                </Text>
              </View>
            </View>
          )}
          <FlatList
            data={data.rows}
            keyExtractor={(row) => row.id}
            scrollEnabled={false}
            renderItem={({ item: row }) =>
              wide ? (
                <View
                  role="row"
                  style={[styles.wideRow, { borderBottomColor: colors.border }]}
                  testID={`statistics-row-${row.id}`}
                >
                  {columns.map((column, index) => (
                    <View role="cell" key={column.key} style={columnStyle(column, index)}>
                      {cell(row, column)}
                    </View>
                  ))}
                  <View role="cell" style={styles.actionsColumn}>
                    {actions(row)}
                  </View>
                </View>
              ) : (
                <View
                  role="row"
                  style={[styles.compactRow, { borderBottomColor: colors.border }]}
                  testID={`statistics-row-${row.id}`}
                >
                  {columns.map((column) => (
                    <View
                      key={column.key}
                      style={[styles.compactPair, { borderBottomColor: colors.border }]}
                    >
                      <View role="rowheader" style={{ flex: 0.75, minWidth: 0 }}>
                        {header(column)}
                      </View>
                      <View role="cell" style={{ flex: 1, minWidth: 0 }}>
                        {cell(row, column)}
                      </View>
                    </View>
                  ))}
                  <View role="cell" style={styles.compactActions}>
                    {actions(row)}
                  </View>
                </View>
              )
            }
          />
        </View>
      )}
      {(data?.pages ?? 0) > 1 && (
        <View accessibilityLabel="Statistics pages" style={styles.pages}>
          <ActionButton
            variant="ghost"
            accessibilityLabel="Previous statistics page"
            disabled={state.busy || q.page <= 1}
            onPress={() => void dispatch({ type: 'query', patch: { page: q.page - 1 } })}
          >
            <UiIcon name="previous" />
          </ActionButton>
          <ActionButton
            variant="ghost"
            accessibilityLabel="Choose statistics page"
            disabled={state.busy}
            onPress={(event) => {
              setPagesAnchor(event.currentTarget as unknown as View);
              setPagesOpen(true);
            }}
          >
            PAGE {q.page} / {data?.pages}
          </ActionButton>
          <ActionButton
            variant="ghost"
            accessibilityLabel="Next statistics page"
            disabled={state.busy || q.page >= (data?.pages ?? 1)}
            onPress={() => void dispatch({ type: 'query', patch: { page: q.page + 1 } })}
          >
            <UiIcon name="next" />
          </ActionButton>
        </View>
      )}
      <AnchoredPopover
        visible={!!details}
        title="Measurement details"
        label="Measurement details"
        closeLabel="Close measurement details"
        anchor={details?.anchor}
        onClose={() => setDetails(undefined)}
        maxWidth={320}
      >
        {details?.lines.map((detail) => (
          <Text key={detail} style={{ color: colors.foreground, marginBottom: 8 }}>
            {detail}
          </Text>
        ))}
      </AnchoredPopover>
      <AnchoredPopover
        visible={pagesOpen}
        title="Statistics pages"
        label="Statistics pages"
        closeLabel="Close statistics pages"
        anchor={pagesAnchor}
        onClose={() => setPagesOpen(false)}
        maxWidth={128}
        maxHeight={128}
        padding={8}
        showHeading={false}
        showClose={false}
        focusSelected
        bodyScroll={false}
      >
        <FlatList
          style={{ height: 112 }}
          data={Array.from({ length: data?.pages ?? 0 }, (_, index) => index + 1)}
          keyExtractor={(page) => String(page)}
          initialScrollIndex={Math.max(0, q.page - 1)}
          initialNumToRender={4}
          maxToRenderPerBatch={8}
          windowSize={5}
          getItemLayout={(_data, index) => ({ length: 44, offset: 44 * index, index })}
          renderItem={({ item: page }) => (
            <ActionButton
              variant={page === q.page ? 'secondary' : 'ghost'}
              selected={page === q.page}
              size="sm"
              style={{ height: 44, minHeight: 44 }}
              onPress={() => {
                setPagesOpen(false);
                void dispatch({ type: 'query', patch: { page } });
              }}
            >
              {page}
            </ActionButton>
          )}
        />
      </AnchoredPopover>
    </View>
  );
}
const styles = StyleSheet.create({
  range: { marginTop: 8, marginBottom: 20, fontSize: 14 },
  table: { minWidth: 0, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  headerCell: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  headerLabel: { flex: 1, paddingHorizontal: 0, alignItems: 'flex-start' },
  wideRow: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1
  },
  tableHeader: { minHeight: 56 },
  dateColumn: { flexBasis: 112, flexGrow: 0, flexShrink: 0, minWidth: 0 },
  actionsColumn: { width: 96, flexShrink: 0 },
  actionsLabel: { fontSize: 12, textAlign: 'right' },
  compactRow: { paddingHorizontal: 16, borderBottomWidth: 1 },
  compactPair: {
    flexDirection: 'row',
    gap: 16,
    minHeight: 60,
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1
  },
  compactActions: { paddingVertical: 12, alignItems: 'flex-end' },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4 },
  detailTarget: { minHeight: 44, justifyContent: 'center' },
  cellText: { fontSize: 16, lineHeight: 24 },
  pages: {
    marginVertical: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  emptyRange: { fontSize: 16, lineHeight: 24, padding: 8 },
  empty: { fontSize: 36, lineHeight: 40, textAlign: 'center', padding: 24 }
});
