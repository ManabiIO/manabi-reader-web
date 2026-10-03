/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Host, TextInput, useNativeState } from '@expo/ui';
import { router, usePathname } from 'expo-router';
import { Action } from '../screens/NativeScreens';
import { UiText as Text } from '../shared-ui/Typography';
import { useUiTheme } from '../shared-ui/theme';
import { useReaderRuntime } from '../platform/RuntimeProvider.native';
import type { ContentSearchView } from './content-search-contract';
import {
  NativeContentSearchController,
  type ContentSearchScreenState
} from './content-search-controller';

export function NativeLibraryContentSearch({
  view,
  disabled
}: {
  view: ContentSearchView;
  disabled: boolean;
}) {
  const theme = useUiTheme();
  const { colors } = theme;
  const styles = {
    ...baseStyles,
    root: [baseStyles.root, { backgroundColor: colors.background }],
    card: [baseStyles.card, { backgroundColor: colors.card, borderColor: colors.border }],
    match: [baseStyles.match, { backgroundColor: colors.primary, color: colors.primaryForeground }],
    error: [baseStyles.error, { backgroundColor: colors.destructiveBackground }]
  };
  const { command, snapshot } = useReaderRuntime();
  const focused = usePathname() === '/manage';
  const [draft, setDraft] = useState('');
  const input = useNativeState('');
  const [state, setState] = useState<ContentSearchScreenState>({
    pending: false,
    opening: false,
    error: ''
  });
  const controller = useMemo(() => new NativeContentSearchController(command, setState), [command]);
  const viewKey = JSON.stringify(view);
  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    controller.cancel();
    return () => controller.cancel();
  }, [controller, viewKey, focused, snapshot.session, snapshot.epoch]);
  const result = state.result;
  const blocked = disabled || !snapshot.session || !focused || state.opening;
  const submit = () => {
    if (!blocked) void controller.start(input.value, view);
  };
  return (
    <View style={styles.root}>
      <View style={styles.controls}>
        <Text accessibilityRole="header" style={styles.title}>
          Search saved book passages
        </Text>
        <Text>
          Searches imported copies in this Library view. Provider-only books must be imported first.
        </Text>
        <Host matchContents colorScheme={theme.mode} seedColor={theme.seedColor}>
          <TextInput
            value={input}
            placeholder="Text inside saved books"
            maxLength={1024}
            returnKeyType="search"
            onChangeText={(text) => {
              input.value = text;
              setDraft(text);
              // Keep the exact composing text. Only explicit IME submission/Search runs matching.
              controller.cancel();
            }}
            onSubmitEditing={submit}
          />
        </Host>
        <View style={styles.row}>
          <Action
            theme={theme}
            label="Search passages"
            variant="filled"
            disabled={blocked || !draft.trim() || state.pending}
            onPress={submit}
          />
          {(state.pending || result) && (
            <Action theme={theme} label="Cancel search" onPress={() => controller.cancel()} />
          )}
        </View>
        {(state.pending || result?.status === 'loading' || state.opening) && (
          <View style={styles.row} accessibilityLiveRegion="polite">
            <ActivityIndicator
              color={colors.primary}
              accessibilityLabel={state.opening ? 'Opening passage' : 'Searching saved passages'}
            />
            <Text>{state.opening ? 'Opening passage…' : 'Searching saved passages…'}</Text>
          </View>
        )}
        {!!state.error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {state.error}
          </Text>
        )}
        {!!result?.failed && (
          <Text accessibilityRole="alert">
            Some saved books could not be searched ({result.failed}). Results may be incomplete.
          </Text>
        )}
        {!!result?.truncated && (
          <Text>
            Showing bounded results: up to 24 passages per book and 300 overall. Narrow your search
            for more matches.
          </Text>
        )}
      </View>
      <FlatList
        data={result?.items ?? []}
        keyExtractor={(hit) => hit.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text>
            {result?.status === 'ready'
              ? 'No matching passages in the saved books in this view.'
              : !result && !state.pending
                ? 'Enter text, then choose Search passages.'
                : ''}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open passage in ${item.title}, section ${item.section}: ${item.excerpt}`}
            accessibilityState={{ disabled: blocked }}
            disabled={blocked}
            style={styles.card}
            onPress={() => {
              void controller.open(item, (id) => router.push({ pathname: '/b', params: { id } }));
            }}
          >
            <Text style={styles.title}>{item.title}</Text>
            <Text>Section {item.section}</Text>
            <Text style={styles.excerpt}>
              {item.excerpt.slice(0, item.match.start)}
              <Text style={styles.match}>
                {item.excerpt.slice(item.match.start, item.match.end)}
              </Text>
              {item.excerpt.slice(item.match.end)}
            </Text>
          </Pressable>
        )}
      />
      {result && (
        <View style={styles.pagination}>
          <Action
            theme={theme}
            label="Previous passages"
            disabled={blocked || !result.offset}
            onPress={() => void controller.load(Math.max(0, result.offset - result.limit))}
          />
          <Text>
            {result.total ? result.offset + 1 : 0}–
            {Math.min(result.offset + result.items.length, result.total)} of {result.total}
          </Text>
          <Action
            theme={theme}
            label="Next passages"
            disabled={blocked || result.offset + result.items.length >= result.total}
            onPress={() => void controller.load(result.offset + result.limit)}
          />
        </View>
      )}
    </View>
  );
}
const baseStyles = StyleSheet.create({
  root: { flex: 1 },
  controls: { padding: 14, gap: 9 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  list: { paddingHorizontal: 14, gap: 9, paddingBottom: 12 },
  card: {
    padding: 14,
    gap: 6,
    borderRadius: 14,
    borderWidth: 1
  },
  title: { fontSize: 17, fontWeight: '600' },
  excerpt: { fontSize: 16, lineHeight: 24 },
  match: { fontWeight: '700' },
  error: { padding: 10, borderRadius: 10 },
  pagination: {
    paddingHorizontal: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between'
  }
});
