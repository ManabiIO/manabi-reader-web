/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { UiText as Text } from '../../shared-ui/Typography';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, View, StyleSheet } from 'react-native';
import {
  ActionButton,
  NavLink,
  CheckboxField,
  TextField,
  useUiTheme
} from '../../shared-ui/StatisticsPrimitives';
import { TITLE_FILTER_PAGE_SIZE } from '../../lib/components/statistics/title-filter-model';
import { FocusPage } from '../../shared-ui/FocusPage';
import type { StatisticsViewProps } from './view-model';

/** Only the displayed page is local: the shared controller owns the uncommitted
 * selection and retires it on account/route changes and Cancel. */
export function StatisticsTitleFilter({ state, dispatch }: StatisticsViewProps) {
  const { colors } = useUiTheme();
  const { dateOnly, selectedOnly } = state.filterPreferences;
  const setDateOnly = (dateOnly: boolean) =>
    void dispatch({ type: 'filter-preferences', patch: { dateOnly } });
  const setSelectedOnly = (selectedOnly: boolean) =>
    void dispatch({ type: 'filter-preferences', patch: { selectedOnly } });
  const [page, setPage] = useState(1);
  const selected = useMemo(() => new Set(state.titleDraft), [state.titleDraft]);
  const titles = useMemo(
    () =>
      (state.data?.titles ?? []).filter(
        (item) =>
          (!dateOnly || item.inDateRange) &&
          (!selectedOnly || selected.has(item.title)) &&
          item.title
            .normalize('NFC')
            .toLowerCase()
            .includes(state.titleSearch.trim().normalize('NFC').toLowerCase())
      ),
    [state.data?.titles, selected, state.titleSearch, dateOnly, selectedOnly]
  );
  const pageCount = Math.max(1, Math.ceil(titles.length / TITLE_FILTER_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  useEffect(() => setPage(1), [state.titleSearch, dateOnly, selectedOnly]);
  const bulk = (value: boolean) =>
    void dispatch({ type: 'title-all', selected: value, titles: titles.map((item) => item.title) });
  return (
    <View style={styles.panel} testID="statistics-title-filter">
      <TextField
        type="search"
        accessibilityLabel="Filter book titles"
        placeholder="Filter titles"
        value={state.titleSearch}
        onChangeText={(value) => void dispatch({ type: 'title-search', value })}
        editable={!state.busy}
      />
      <View role="group" accessibilityLabel="Title visibility" style={styles.actions}>
        <ActionButton
          variant={dateOnly ? 'secondary' : 'ghost'}
          shape="rounded"
          selected={dateOnly}
          onPress={() => setDateOnly(!dateOnly)}
        >
          Selected dates only
        </ActionButton>
        <ActionButton
          variant={selectedOnly ? 'secondary' : 'ghost'}
          shape="rounded"
          selected={selectedOnly}
          onPress={() => setSelectedOnly(!selectedOnly)}
        >
          Selected titles only
        </ActionButton>
      </View>
      <View style={styles.actions}>
        <ActionButton
          variant="ghost"
          disabled={!titles.length || state.busy}
          onPress={() => bulk(true)}
        >
          Select matching
        </ActionButton>
        <ActionButton
          variant="ghost"
          disabled={!titles.length || state.busy}
          onPress={() => bulk(false)}
        >
          Remove matching
        </ActionButton>
        {(state.query.prefilteredBookKeys.length > 0 ||
          !!state.query.prefilteredTitles?.length ||
          state.query.selectionToken) && (
          <ActionButton
            variant="outline"
            disabled={state.busy}
            onPress={() => void dispatch({ type: 'clear-prefilter' })}
          >
            {state.query.selectionToken ? 'Clear title filter' : 'Remove Prefilter'}
          </ActionButton>
        )}
      </View>
      {state.query.selectionToken && (
        <View style={styles.actions}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
            Statistics is scoped to the books selected in Library.
          </Text>
          <NavLink href="/manage" variant="ghost">
            Return to Library
          </NavLink>
        </View>
      )}
      <Text role="status" style={{ color: colors.mutedForeground, fontSize: 14 }}>
        {titles.length} matching titles · {selected.size} selected
      </Text>
      {titles.length ? (
        <View
          role="group"
          accessibilityLabel="Book title selection"
          style={[styles.list, { borderColor: colors.border }]}
        >
          <FocusPage page={currentPage}>
            <FlatList
              data={titles.slice(
                (currentPage - 1) * TITLE_FILTER_PAGE_SIZE,
                currentPage * TITLE_FILTER_PAGE_SIZE
              )}
              keyExtractor={(item) => item.title}
              scrollEnabled={false}
              renderItem={({ item, index }) => (
                <View
                  style={[
                    styles.titleRow,
                    index > 0 && { borderTopWidth: 1, borderTopColor: colors.border }
                  ]}
                >
                  <CheckboxField
                    label={item.title}
                    value={selected.has(item.title)}
                    disabled={state.busy}
                    onValueChange={() => void dispatch({ type: 'title-toggle', title: item.title })}
                    style={{ flex: 1, opacity: item.inDateRange ? 1 : 0.65 }}
                  />
                </View>
              )}
            />
          </FocusPage>
        </View>
      ) : (
        <Text style={[styles.empty, { color: colors.foreground, backgroundColor: colors.muted }]}>
          No Titles to filter
        </Text>
      )}
      {pageCount > 1 && (
        <View accessibilityLabel="Title pages" style={styles.pages}>
          <ActionButton
            variant="ghost"
            disabled={currentPage === 1}
            onPress={() => setPage(currentPage - 1)}
          >
            Previous
          </ActionButton>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
            Page {currentPage} / {pageCount}
          </Text>
          <ActionButton
            variant="ghost"
            disabled={currentPage === pageCount}
            onPress={() => setPage(currentPage + 1)}
          >
            Next
          </ActionButton>
        </View>
      )}
    </View>
  );
}
export function StatisticsTitleFilterFooter({ state, dispatch }: StatisticsViewProps) {
  const { colors } = useUiTheme();
  return (
    <View
      style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.popover }]}
    >
      <ActionButton
        variant="ghost"
        disabled={state.busy}
        onPress={() => void dispatch({ type: 'title-filter', open: false })}
      >
        Cancel
      </ActionButton>
      <ActionButton
        variant="secondary"
        disabled={state.busy}
        onPress={() => void dispatch({ type: 'title-apply' })}
      >
        Apply Filter
      </ActionButton>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 16, minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  list: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  titleRow: { minHeight: 52, padding: 12, flexDirection: 'row', alignItems: 'center' },
  empty: { padding: 20, borderRadius: 12, textAlign: 'center' },
  pages: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    paddingTop: 0
  }
});
