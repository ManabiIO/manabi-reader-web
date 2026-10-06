/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { ExternalLink } from '../../shared-ui/ExternalLink';
import { AppFrame } from '../../shared-ui/AppFrame';
import { UiIcon } from '../../shared-ui/UiIcon';
import { RouteBack } from '../../shared-ui/RouteBack';
import { UiText as Text } from '../../shared-ui/Typography';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View, StyleSheet, useWindowDimensions } from 'react-native';
import {
  ActionButton,
  ChoiceField,
  Dialog,
  Heading,
  Menu,
  NavLink,
  Sheet,
  TextField,
  CheckboxField,
  UiThemeProvider,
  useUiTheme
} from '../../shared-ui/StatisticsPrimitives';
import { useFocusEffect } from 'expo-router';
import { Text as NativeText } from 'react-native';
import type { StatisticsPort } from './contract';
import { useStatisticsPort } from './ports';
import { useStatisticsController } from './use-statistics';
import { StatisticsSettings } from './StatisticsSettings';
import { StatisticsSummary } from './StatisticsSummary';
import { StatisticsHeatmap } from './StatisticsHeatmap';
import { StatisticsTitleFilter, StatisticsTitleFilterFooter } from './StatisticsTitleFilter';
import { ShortcutListener } from '../../shared-ui/ShortcutListener';
import { rangeTemplates, summaryPageSize, type StatisticsViewProps } from './view-model';
/** Both Expo route entries resolve this exact composition and controller.
 * Only typed effects and bounded semantic/interaction leaves vary by platform. */
export function StatisticsScreen() {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  // Expo Stack retains inactive route components. Retire all drafts, dialogs,
  // proof leases and effect callbacks on blur, not only physical unmount.
  return focused ? <FocusedStatisticsScreen /> : null;
}
function FocusedStatisticsScreen() {
  const port = useStatisticsPort();
  return <StatisticsScreenWithPort key={port.ownerKey} port={port} />;
}
export function StatisticsScreenWithPort({ port }: { port: StatisticsPort }) {
  const controller = useStatisticsController(port);
  const theme = useRef(port.initialTheme);
  if (controller.state.data?.uiTheme) theme.current = controller.state.data.uiTheme;
  if (!theme.current)
    return (
      <View
        role="status"
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}
        testID="statistics-appearance-loading"
      >
        {controller.state.error ? (
          <>
            <NativeText role="alert">{controller.state.error}</NativeText>
            <NavLink href="/manage" variant="outline">
              Return to Library
            </NavLink>
          </>
        ) : (
          <>
            <ActivityIndicator />
            <NativeText>Loading statistics appearance…</NativeText>
          </>
        )}
      </View>
    );
  return (
    <UiThemeProvider {...theme.current}>
      <StatisticsView {...controller} userGuideHref={port.userGuideHref} />
    </UiThemeProvider>
  );
}
export function StatisticsView({
  state,
  dispatch,
  userGuideHref
}: StatisticsViewProps & { userGuideHref?: string }) {
  const { colors } = useUiTheme();
  const { width, height, fontScale } = useWindowDimensions();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [newDayBook, setNewDayBook] = useState('');
  const pageSize = summaryPageSize(width, height, fontScale);
  useEffect(() => {
    if (state.query.pageSize !== pageSize && !state.busy && !state.editor)
      void dispatch({ type: 'query', patch: { pageSize } });
  }, [pageSize, state.query.pageSize, state.busy, state.editor, dispatch]);
  const viewProps = { state, dispatch };
  const maxWidth = width >= 1536 ? 1152 : width >= 1024 && width < 1280 ? 896 : undefined;
  const beginSettings = () => {
    setOptionsOpen(false);
    void dispatch({ type: 'settings', open: true });
  };
  return (
    <AppFrame
      style={[styles.screen, { backgroundColor: colors.background }]}
      testID="shared-statistics-screen"
    >
      <ShortcutListener
        enabled={
          !state.busy &&
          !state.editor &&
          !state.confirmation &&
          !state.settingsOpen &&
          !state.titleFilterOpen &&
          !optionsOpen
        }
        bindings={state.data?.shortcuts ?? {}}
        onShortcut={(action) => {
          if (action === 'range-template') {
            const templates = rangeTemplates.slice(0, -1);
            const next = (templates.indexOf(state.query.rangeTemplate) + 1) % templates.length;
            void dispatch({ type: 'template', value: templates[next] });
          } else {
            const modes = ['none', 'date', 'title'] as const;
            void dispatch({
              type: 'query',
              patch: {
                aggregation: modes[(modes.indexOf(state.query.aggregation) + 1) % modes.length]
              }
            });
          }
        }}
      />
      <View
        role="banner"
        accessibilityLabel="Statistics toolbar"
        style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.card }]}
      >
        <View style={[styles.topbar, { paddingHorizontal: width >= 640 ? 24 : 12 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <RouteBack />
            <Heading level={1}>Statistics</Heading>
          </View>
          <View style={{ position: 'relative', zIndex: 20 }}>
            <ActionButton
              variant="ghost"
              size="icon-lg"
              shape="circle"
              accessibilityLabel="Statistics options"
              title="Statistics options"
              aria-haspopup="menu"
              aria-expanded={optionsOpen}
              onPress={() => setOptionsOpen(!optionsOpen)}
            >
              <UiIcon name="more" size={22} />
            </ActionButton>
            <Menu
              visible={optionsOpen}
              label="Statistics options"
              onClose={() => setOptionsOpen(false)}
            >
              <ActionButton role="menuitem" variant="ghost" onPress={beginSettings}>
                Statistics Settings
              </ActionButton>
              <View
                role="separator"
                style={{ borderTopWidth: 1, borderColor: colors.border, marginVertical: 4 }}
              />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, margin: 8 }}>
                Copy TMW log data
              </Text>
              <ActionButton
                role="menuitem"
                variant="ghost"
                disabled={state.busy || !state.capabilities.clipboard.available}
                onPress={() => {
                  setOptionsOpen(false);
                  void dispatch({ type: 'copy', measurement: 'readingTime' });
                }}
              >
                Copy Reading Time
              </ActionButton>
              <ActionButton
                role="menuitem"
                variant="ghost"
                disabled={state.busy || !state.capabilities.clipboard.available}
                onPress={() => {
                  setOptionsOpen(false);
                  void dispatch({ type: 'copy', measurement: 'charactersRead' });
                }}
              >
                Copy Characters Read
              </ActionButton>
              {!state.capabilities.clipboard.available && (
                <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
                  {state.capabilities.clipboard.reason}
                </Text>
              )}
              {userGuideHref && (
                <ExternalLink href={userGuideHref} accessibilityLabel="User guide">
                  <Text>User guide</Text>
                </ExternalLink>
              )}
            </Menu>
          </View>
          <View style={styles.navigation}>
            {state.data?.currentBookId !== undefined && (
              <NavLink href={`/b?id=${state.data.currentBookId}`} variant="ghost">
                Resume reading
              </NavLink>
            )}
          </View>
        </View>
        <View style={[styles.toolbar, { paddingHorizontal: width >= 640 ? 24 : 12 }]}>
          <View role="group" accessibilityLabel="Statistics view" style={styles.tabs}>
            <ActionButton
              variant="ghost"
              shape="rounded"
              selected={state.view === 'summary'}
              style={{
                minHeight: 44,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderWidth: 0,
                borderRadius: 0,
                backgroundColor: 'transparent',
                borderBottomWidth: 2,
                borderBottomColor: state.view === 'summary' ? colors.primary : 'transparent'
              }}
              textStyle={{
                fontWeight: '500',
                color: state.view === 'summary' ? colors.primary : colors.mutedForeground
              }}
              dataSet={{ sectionLink: '' }}
              disabled={state.busy}
              onPress={() => void dispatch({ type: 'view', value: 'summary' })}
            >
              Summary
            </ActionButton>
            <ActionButton
              variant="ghost"
              shape="rounded"
              selected={state.view === 'overview'}
              style={{
                minHeight: 44,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderWidth: 0,
                borderRadius: 0,
                backgroundColor: 'transparent',
                borderBottomWidth: 2,
                borderBottomColor: state.view === 'overview' ? colors.primary : 'transparent'
              }}
              textStyle={{
                fontWeight: '500',
                color: state.view === 'overview' ? colors.primary : colors.mutedForeground
              }}
              dataSet={{ sectionLink: '' }}
              disabled={state.busy}
              onPress={() => void dispatch({ type: 'view', value: 'overview' })}
            >
              Heatmap
            </ActionButton>
          </View>
          <ActionButton
            variant="secondary"
            title="Open Title Filter Menu"
            disabled={!state.data || state.busy}
            onPress={() => void dispatch({ type: 'title-filter', open: true })}
          >
            Filter books
          </ActionButton>
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
        <View
          style={[styles.content, { paddingHorizontal: width >= 768 ? 32 : 16, maxWidth }]}
          testID="statistics-content"
        >
          {!!state.error &&
            !state.settingsOpen &&
            !state.titleFilterOpen &&
            state.editor?.mode !== 'create' && (
              <View role="alert" style={[styles.notice, { borderColor: colors.destructive }]}>
                <Text style={{ color: colors.destructive, flex: 1 }}>{state.error}</Text>
                <ActionButton
                  variant="ghost"
                  onPress={() => void dispatch({ type: 'clear-error' })}
                >
                  Dismiss
                </ActionButton>
                <ActionButton
                  variant="outline"
                  disabled={state.busy}
                  onPress={() => void dispatch({ type: 'refresh' })}
                >
                  Retry
                </ActionButton>
              </View>
            )}
          {state.data?.notices.map((notice, index) => (
            <Text
              key={index}
              role="status"
              style={{ color: colors.mutedForeground, marginBottom: 12 }}
            >
              {notice}
            </Text>
          ))}
          {!state.data && !state.busy ? (
            <NavLink href="/manage" variant="outline">
              Return to Library
            </NavLink>
          ) : !state.data ? (
            <View role="status" accessibilityLabel="Loading statistics" style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.foreground }}>Loading statistics…</Text>
            </View>
          ) : state.view === 'summary' ? (
            <StatisticsSummary {...viewProps} />
          ) : (
            <>
              <StatisticsHeatmap {...viewProps} />
              {state.capabilities.goals.available && state.data.goalDays.length > 0 && (
                <View style={{ marginTop: width >= 640 ? 64 : 32 }}>
                  <StatisticsHeatmap {...viewProps} goal />
                </View>
              )}
              {!state.capabilities.goals.available && (
                <Text style={{ marginTop: 16, color: colors.mutedForeground }}>
                  {state.capabilities.goals.reason}
                </Text>
              )}
            </>
          )}
          {state.busy && !!state.data && (
            <View role="status" accessibilityLabel="Updating statistics" style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
        </View>
      </ScrollView>
      <Sheet
        visible={state.settingsOpen}
        onClose={() => void dispatch({ type: 'settings', open: false })}
        title="Statistics options"
        description="Choose your date range, measurements, and export format."
        closeLabel="Close statistics options"
        closeDisabled={state.busy}
        maxWidth={576}
      >
        {!!state.error && (
          <Text role="alert" style={{ color: colors.destructive }}>
            {state.error}
          </Text>
        )}
        <StatisticsSettings {...viewProps} />
        {state.capabilities.createDay.available && !!state.data?.books.length && (
          <View style={{ gap: 12 }}>
            <Heading level={3}>Add reading day</Heading>
            <ChoiceField<string>
              label="Book"
              accessibilityLabel="Book for reading day"
              value={newDayBook}
              options={[
                { value: '', label: 'Choose a book' },
                ...state.data.books.map((book, index) => ({
                  value: String(index),
                  label: book.title
                }))
              ]}
              onValueChange={(value) => setNewDayBook(String(value))}
              disabled={state.busy}
            />
            <ActionButton
              disabled={state.busy || newDayBook === ''}
              onPress={() => {
                const book = state.data?.books[Number(newDayBook)];
                if (book) void dispatch({ type: 'create-day', book });
              }}
            >
              Add reading day
            </ActionButton>
          </View>
        )}
      </Sheet>
      <Sheet
        visible={state.titleFilterOpen}
        onClose={() => void dispatch({ type: 'title-filter', open: false })}
        title="Filter books"
        description="Choose the books included in reading statistics."
        descriptionHidden
        closeLabel="Close title filter"
        maxWidth={576}
        closeDisabled={state.busy}
        panelClassName="filter-panel"
        stickyChrome
        footer={<StatisticsTitleFilterFooter {...viewProps} />}
      >
        {!!state.error && (
          <Text role="alert" style={{ color: colors.destructive }}>
            {state.error}
          </Text>
        )}
        <StatisticsTitleFilter {...viewProps} />
      </Sheet>
      <Dialog
        visible={!!state.confirmation}
        onClose={() => void dispatch({ type: 'confirm', accept: false })}
        title={state.confirmation?.title ?? 'Confirm statistics action'}
        closeLabel="Cancel statistics action"
        maxWidth={480}
      >
        <Text style={{ color: colors.foreground }}>{state.confirmation?.message}</Text>
        <View style={styles.confirmActions}>
          <ActionButton
            variant="ghost"
            onPress={() => void dispatch({ type: 'confirm', accept: false })}
          >
            Cancel
          </ActionButton>
          <ActionButton
            variant="destructive"
            onPress={() => void dispatch({ type: 'confirm', accept: true })}
          >
            {state.confirmation?.confirmLabel ?? 'Confirm'}
          </ActionButton>
        </View>
      </Dialog>
      <Dialog
        visible={state.editor?.mode === 'create'}
        onClose={() => void dispatch({ type: 'close-editor' })}
        title="Add reading day"
        closeLabel="Cancel edit"
        closeDisabled={state.busy}
        maxWidth={480}
      >
        {state.editor && (
          <View style={{ gap: 16 }}>
            {!!state.error && (
              <Text role="alert" style={{ color: colors.destructive }}>
                {state.error}
              </Text>
            )}
            <Text style={{ color: colors.foreground }}>{state.editor.row.title}</Text>
            <TextField
              type="date"
              label="Date"
              value={state.editor.date}
              editable={!state.busy}
              onChangeText={(date) => void dispatch({ type: 'editor', patch: { date } })}
            />
            <TextField
              type="number"
              label="Reading time (seconds)"
              value={state.editor.time}
              editable={!state.busy}
              onChangeText={(time) => void dispatch({ type: 'editor', patch: { time } })}
            />
            <TextField
              type="number"
              label="Characters read"
              value={state.editor.characters}
              editable={!state.busy}
              onChangeText={(characters) =>
                void dispatch({ type: 'editor', patch: { characters } })
              }
            />
            <CheckboxField
              label="Reset Min/Max Speed"
              value={state.editor.resetMinMax}
              disabled={state.busy}
              onValueChange={(resetMinMax) =>
                void dispatch({ type: 'editor', patch: { resetMinMax } })
              }
            />
            <ActionButton
              disabled={state.busy}
              onPress={() => void dispatch({ type: 'save-editor' })}
            >
              Save reading day
            </ActionButton>
          </View>
        )}
      </Dialog>
    </AppFrame>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, minWidth: 0 },
  header: { borderBottomWidth: 1, zIndex: 10 },
  topbar: {
    zIndex: 20,
    width: '100%',
    maxWidth: 1280,
    alignSelf: 'center',
    minHeight: 48,
    paddingVertical: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  navigation: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    minWidth: 0,
    maxWidth: '100%',
    flexShrink: 1,
    gap: 4
  },
  primaryNav: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toolbar: {
    width: '100%',
    maxWidth: 1280,
    alignSelf: 'center',
    minHeight: 56,
    paddingBottom: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 4
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    minWidth: 0,
    maxWidth: '100%',
    gap: 4,
    paddingVertical: 4
  },
  content: { minWidth: 0, width: '100%', alignSelf: 'center', paddingVertical: 24 },
  loading: { padding: 24, alignItems: 'center', gap: 12 },
  notice: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8
  },
  confirmActions: {
    marginTop: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8
  }
});
