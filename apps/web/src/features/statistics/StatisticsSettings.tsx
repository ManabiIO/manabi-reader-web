/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useState } from 'react';
import { UiIcon } from '../../shared-ui/UiIcon';
import { UiText as Text } from '../../shared-ui/Typography';
import { View, StyleSheet } from 'react-native';
import {
  ActionButton,
  ChoiceField,
  TextField,
  SwitchField,
  Heading,
  useUiTheme
} from '../../shared-ui/StatisticsPrimitives';
import {
  statisticsCharactersSources,
  statisticsSpeedSources,
  statisticsTimeSources,
  type StatisticsCapability
} from './contract';
import { rangeTemplates, weekdays, type StatisticsViewProps } from './view-model';
import type { ReactNode } from 'react';

function Group({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useUiTheme();
  return (
    <View
      role="group"
      accessibilityLabel={title}
      style={[styles.group, { borderTopColor: colors.border }]}
    >
      <Heading level={3} style={styles.legend}>
        {title}
      </Heading>
      {children}
    </View>
  );
}
function CapabilityReason({ value }: { value: StatisticsCapability }) {
  const { colors } = useUiTheme();
  return value.available ? null : (
    <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>{value.reason}</Text>
  );
}
function DateDraftField({
  value,
  onCommit,
  today,
  ...props
}: { value: string; onCommit(value: string): void; today: string } & Omit<
  import('../../shared-ui/StatisticsPrimitives').TextFieldProps,
  'value' | 'onChangeText' | 'type'
>) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const { colors } = useUiTheme();
  useEffect(() => {
    setDraft(value);
    setInvalid(false);
  }, [value]);
  const valid = (input: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(input) &&
    !Number.isNaN(new Date(`${input}T12:00:00`).getTime()) &&
    new Date(`${input}T12:00:00`).getDate() === Number(input.slice(8));
  const commit = () => {
    const next = draft || today;
    if (valid(next)) {
      setInvalid(false);
      if (next !== value) onCommit(next);
    } else setInvalid(true);
  };
  return (
    <View style={props.style}>
      <TextField
        {...props}
        style={undefined}
        type="date"
        value={draft}
        onBlur={commit}
        onSubmitEditing={commit}
        onChangeText={(next) => {
          setDraft(next);
          setInvalid(false);
          if (!next) {
            setDraft(today);
            onCommit(today);
          } else if (valid(next) && next !== value) onCommit(next);
        }}
      />
      {invalid && (
        <Text role="alert" style={{ color: colors.destructive, fontSize: 14 }}>
          Enter a date in YYYY-MM-DD format.
        </Text>
      )}
    </View>
  );
}
export function StatisticsSettings({ state, dispatch }: StatisticsViewProps) {
  const { query: q, capabilities: caps, busy } = state;
  const { colors } = useUiTheme();
  const patch = (patch: Partial<typeof q>) => void dispatch({ type: 'query', patch });
  const field = <T extends string | number>(
    label: string,
    value: T,
    options: readonly { value: T; label: string }[],
    onValueChange: (value: T) => void,
    id: string
  ) => (
    <ChoiceField
      label={label}
      accessibilityLabel={label}
      value={value}
      options={[...options]}
      onValueChange={onValueChange}
      disabled={busy}
      testID={id}
      style={styles.field}
    />
  );
  return (
    <View style={styles.body} testID="statistics-settings">
      <Group title="Date range">
        <View style={styles.fields}>
          {field(
            'Template',
            q.rangeTemplate,
            rangeTemplates.map((value) => ({ value, label: value })),
            (value) => void dispatch({ type: 'template', value }),
            'datesTemplate'
          )}
          {field(
            'Start of Week',
            q.weekStartsOn,
            [...weekdays.slice(1), weekdays[0]].map((label) => ({
              value: weekdays.indexOf(label),
              label
            })),
            (value) => patch({ weekStartsOn: value }),
            'weekDay'
          )}
          <DateDraftField
            label="From"
            accessibilityLabel="From"
            today={state.data?.today ?? q.startDate}
            value={q.startDate}
            onCommit={(startDate) => patch({ startDate, rangeTemplate: 'Custom' })}
            editable={!busy}
            testID="fromDate"
            style={styles.field}
          />
          <DateDraftField
            label="To"
            accessibilityLabel="To"
            today={state.data?.today ?? q.startDate}
            value={q.endDate}
            onCommit={(endDate) => patch({ endDate, rangeTemplate: 'Custom' })}
            editable={!busy}
            testID="toDate"
            style={styles.field}
          />
        </View>
        <View style={styles.actions}>
          <ActionButton
            variant="ghost"
            accessibilityLabel="Set end date to start date"
            disabled={busy}
            onPress={() => patch({ endDate: q.startDate, rangeTemplate: 'Custom' })}
          >
            <UiIcon name="right" />
            Use start date for both
          </ActionButton>
          <ActionButton
            variant="ghost"
            accessibilityLabel="Set start date to end date"
            disabled={busy}
            onPress={() => patch({ startDate: q.endDate, rangeTemplate: 'Custom' })}
          >
            <UiIcon name="left" />
            Use end date for both
          </ActionButton>
          <ActionButton
            variant="ghost"
            disabled={busy}
            onPress={() => void dispatch({ type: 'all-time' })}
          >
            Use all available dates for selected books
          </ActionButton>
        </View>
      </Group>
      <Group title="Measurements">
        <Text
          nativeID="statistics-measurement-help"
          style={[styles.help, { color: colors.mutedForeground }]}
        >
          Choose which values appear in the summary and how the reading data is grouped.
        </Text>
        <View style={styles.fields}>
          {field(
            'Time Data Source',
            q.timeSource,
            statisticsTimeSources.map((source) => ({ value: source.key, label: source.label })),
            (timeSource) => patch({ timeSource }),
            'timeDataSource'
          )}
          {field(
            'Characters Data Source',
            q.charactersSource,
            statisticsCharactersSources.map((source) => ({
              value: source.key,
              label: source.label
            })),
            (charactersSource) => patch({ charactersSource }),
            'charactersSource'
          )}
          {field(
            'Speed Data Source',
            q.speedSource,
            statisticsSpeedSources.map((source) => ({ value: source.key, label: source.label })),
            (speedSource) => patch({ speedSource }),
            'speedSource'
          )}
          {field(
            'Primary Aggregation',
            q.aggregation,
            [
              { value: 'none', label: 'None' },
              { value: 'date', label: 'Date' },
              { value: 'title', label: 'Title' }
            ],
            (aggregation) => patch({ aggregation }),
            'primaryAggregration'
          )}
        </View>
      </Group>
      <Group title="Export history">
        <Text style={[styles.help, { color: colors.mutedForeground }]}>
          Raw history preserves book identities, unresolved legacy days, and migration receipts for
          recovery; it is not a TTU import file. The TTU ZIP exports use titles and cannot preserve
          book identities.
        </Text>
        <View style={styles.actions}>
          <ActionButton
            variant="secondary"
            disabled={busy || !caps.rawRecovery.available}
            onPress={() => void dispatch({ type: 'export', format: 'raw', scope: 'all' })}
          >
            Download raw history (JSON)
          </ActionButton>
          <ActionButton
            variant="outline"
            disabled={busy || !caps.ttuExport.available}
            onPress={() => void dispatch({ type: 'export', format: 'ttu', scope: 'selection' })}
          >
            Export Selection
          </ActionButton>
          <ActionButton
            variant="outline"
            disabled={busy || !caps.ttuExport.available}
            onPress={() => void dispatch({ type: 'export', format: 'ttu', scope: 'all' })}
          >
            Export All
          </ActionButton>
        </View>
        <CapabilityReason value={caps.rawRecovery} />
        <CapabilityReason value={caps.ttuExport} />
      </Group>
      <Group title="Manage history">
        <SwitchField
          label="Confirm Statistics Deletion"
          value={q.confirmDeletion}
          onValueChange={(confirmDeletion) => patch({ confirmDeletion })}
          disabled={busy}
        />
        <View style={styles.actions}>
          <ActionButton
            variant="destructive"
            disabled={busy}
            onPress={() => void dispatch({ type: 'delete-selection' })}
          >
            Delete Selection
          </ActionButton>
          <ActionButton
            variant="destructive"
            disabled={busy || !caps.globalDelete.available}
            onPress={() => void dispatch({ type: 'delete-all' })}
          >
            Delete All
          </ActionButton>
        </View>
        <CapabilityReason value={caps.globalDelete} />
      </Group>
    </View>
  );
}
const styles = StyleSheet.create({
  body: { gap: 16 },
  group: { minWidth: 0, gap: 16, marginTop: 8, paddingTop: 16, borderTopWidth: 1 },
  legend: { fontSize: 16, fontWeight: '600' },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  field: { flexGrow: 1, flexBasis: 200, minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  help: { fontSize: 14, lineHeight: 20 }
});
