/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Action } from '../screens/NativeScreens';
import { useReaderRuntime } from '../platform/RuntimeProvider.native';
import { NativeCatalogController, type CatalogScreenState } from './catalog-controller';

/** Native controls only. The public catalog's markup and network URLs stay in DOM. */
export function NativeEditorsPicks({ close }: { close(): void }) {
  const { command } = useReaderRuntime();
  const [state, setState] = useState<CatalogScreenState>({
    pending: false,
    opening: '',
    error: ''
  });
  const controller = useRef<NativeCatalogController | null>(null);
  if (!controller.current) controller.current = new NativeCatalogController(command, setState);
  useEffect(() => {
    const current = controller.current!;
    current.activate();
    void current.start();
    const subscription = AppState.addEventListener('change', (value) => {
      if (value !== 'active') current.cancel();
    });
    return () => {
      subscription.remove();
      current.dispose();
    };
  }, []);
  const result = state.result;
  const loading = state.pending || result?.status === 'loading';
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.heading}>
          Editor's Picks
        </Text>
        <Action
          label={state.opening || loading ? 'Cancel' : 'Close'}
          onPress={() => {
            controller.current!.cancel();
            close();
          }}
        />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text>Public books to add to your Library and read offline</Text>
        {(loading || !!state.opening) && (
          <ActivityIndicator
            accessibilityLabel={
              state.opening ? 'Downloading and importing book' : 'Loading Editor’s Picks'
            }
          />
        )}
        {!!state.opening && (
          <Text accessibilityRole="text">
            Downloading and importing… Cancelling after a save may leave the copy in your Library.
          </Text>
        )}
        {!!state.error && <Text accessibilityRole="alert">{state.error}</Text>}
        {!loading && !state.opening && (!result || result.status === 'error') && (
          <Action label="Try Again" onPress={() => void controller.current!.start()} />
        )}
        {result?.status === 'ready' && result.total === 0 && (
          <Text>No books are listed right now.</Text>
        )}
        {result?.items.map((item) => (
          <View key={item.key} style={styles.card}>
            <Text accessibilityRole="header" style={styles.title}>
              {item.title}
            </Text>
            {!!item.author && <Text>{item.author}</Text>}
            {!!item.summary && <Text numberOfLines={4}>{item.summary}</Text>}
            <Action
              label={state.opening === item.key ? 'Opening…' : 'Open'}
              disabled={!!state.opening}
              onPress={() =>
                void controller.current!.open(item.key, (id) => {
                  close();
                  router.push({ pathname: '/b', params: { id: String(id) } });
                })
              }
            />
          </View>
        ))}
        {!!result?.total && (
          <View style={styles.header}>
            <Action
              label="Previous"
              disabled={!!state.opening || result.offset === 0}
              onPress={() =>
                void controller.current!.load(Math.max(0, result.offset - result.limit))
              }
            />
            <Text>
              {result.offset + 1}–{Math.min(result.total, result.offset + result.limit)} of{' '}
              {result.total}
            </Text>
            <Action
              label="Next"
              disabled={!!state.opening || result.offset + result.limit >= result.total}
              onPress={() => void controller.current!.load(result.offset + result.limit)}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    padding: 16
  },
  heading: { fontSize: 24, fontWeight: '600' },
  content: { padding: 16, gap: 16 },
  card: { padding: 16, gap: 8, borderWidth: 1, borderColor: '#ddd', borderRadius: 12 },
  title: { fontSize: 18, fontWeight: '600' }
});
