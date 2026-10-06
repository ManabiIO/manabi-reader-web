/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ComponentProps, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Screen } from '../screens/NativeScreens';
import { ActionButton } from '../shared-ui/ActionButton';
import { UiText as Text } from '../shared-ui/Typography';
import { useUiTheme } from '../shared-ui/theme';
import type { NativeLibraryState } from './contract';

export const LIBRARY_SIDEBAR_WIDTH = 240;
export function hasLibrarySidebar(width: number, fontScale: number) {
  return width / Math.max(1, fontScale) >= 1024;
}

/** A persistent Library pane owns measurement; the sidebar never becomes a drawer. */
export function NativeLibraryFrame({
  sidebar,
  onPaneWidth,
  children,
  ...props
}: ComponentProps<typeof Screen> & {
  sidebar?: ReactNode;
  onPaneWidth(width: number): void;
}) {
  return (
    <Screen {...props}>
      <View style={{ flex: 1, flexDirection: 'row', minWidth: 0 }}>
        {sidebar}
        <View
          testID="library-content"
          style={{ flex: 1, minWidth: 0 }}
          onLayout={({ nativeEvent: { layout } }) => {
            if (layout.width > 0) onPaneWidth(layout.width);
          }}
        >
          {children}
        </View>
      </View>
    </Screen>
  );
}

/** Library shelves stay local; pushed screens own their navigation. */
export function NativeLibraryShelves({
  state,
  selected,
  disabled,
  onSelect,
  onSnippets,
  onManage
}: {
  state?: NativeLibraryState;
  selected: string;
  disabled: boolean;
  onSelect(id: string): void;
  onSnippets(): void;
  onManage(): void;
}) {
  const { colors } = useUiTheme();
  const shelves = [
    { id: 'books', name: 'Books', count: state?.totalBooks ?? 0 },
    { id: 'want-to-read', name: 'Want to Read', count: state?.counts.wantToRead ?? 0 },
    { id: 'finished', name: 'Finished', count: state?.counts.finished ?? 0 }
  ];
  const row = ({ id, name, count }: (typeof shelves)[number]) => (
    <ActionButton
      key={id}
      variant="ghost"
      selected={selected === id}
      disabled={disabled}
      accessibilityLabel={`${name} (${count})`}
      style={{
        width: '100%',
        flexWrap: 'nowrap',
        justifyContent: 'flex-start',
        paddingHorizontal: 12,
        borderWidth: 0,
        borderRadius: 8,
        backgroundColor: selected === id ? colors.muted : 'transparent'
      }}
      onPress={() => onSelect(id)}
    >
      <Text style={{ flex: 1, fontSize: 14, fontWeight: selected === id ? '600' : '400' }}>
        {name}
      </Text>
      <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{count}</Text>
    </ActionButton>
  );
  return (
    <ScrollView
      accessibilityLabel="Library shelves"
      keyboardShouldPersistTaps="handled"
      style={{
        width: LIBRARY_SIDEBAR_WIDTH,
        flexGrow: 0,
        flexShrink: 0,
        borderRightWidth: 1,
        borderColor: colors.border
      }}
      contentContainerStyle={{ padding: 16, gap: 4 }}
    >
      <Text
        accessibilityRole="header"
        style={{ fontSize: 20, fontWeight: '600', marginBottom: 12 }}
      >
        Library
      </Text>
      {row(shelves[0])}
      <ActionButton
        variant="ghost"
        disabled={disabled}
        style={{ width: '100%', justifyContent: 'flex-start', borderWidth: 0, borderRadius: 8 }}
        textStyle={{ textAlign: 'left', fontSize: 14 }}
        onPress={onSnippets}
      >
        Snippets
      </ActionButton>
      {shelves.slice(1).map(row)}
      <View style={{ marginTop: 16, gap: 4 }}>
        <Text
          accessibilityRole="header"
          style={{
            fontSize: 12,
            fontWeight: '600',
            color: colors.mutedForeground,
            paddingHorizontal: 12,
            marginBottom: 4
          }}
        >
          My Collections
        </Text>
        {state?.collections.filter((collection) => !collection.builtIn).map(row)}
        <ActionButton
          variant="ghost"
          disabled={disabled}
          style={{ width: '100%', justifyContent: 'flex-start', borderWidth: 0, borderRadius: 8 }}
          textStyle={{ textAlign: 'left', fontSize: 14 }}
          onPress={onManage}
        >
          Manage collections
        </ActionButton>
      </View>
    </ScrollView>
  );
}
