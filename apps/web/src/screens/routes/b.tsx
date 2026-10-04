/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useRef } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useReaderRuntime } from '../../platform/RuntimeProvider.native';
/** The persistent DOM belongs to the provider; this route owns navigation, not its lifetime. */
export default function ReaderRoute() {
  const { reader, error, snapshot, closeReader, retryReader } = useReaderRuntime();
  const failure = reader.error || error;
  const navigation = useNavigation();
  const leaving = useRef(false);
  usePreventRemove(reader.visible || reader.pending, ({ data }) => {
    if (leaving.current) return;
    leaving.current = true;
    void closeReader()
      .then((result) => {
        if (result.allowed) navigation.dispatch(data.action);
      })
      .catch(() => {})
      .finally(() => {
        leaving.current = false;
      });
  });
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
      {failure ? (
        <>
          <Text accessibilityRole="alert">{failure}</Text>
          <Pressable accessibilityRole="button" onPress={retryReader}>
            <Text>Try again</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.dismissTo('/manage')}>
            <Text>Back to Library</Text>
          </Pressable>
        </>
      ) : !reader.visible ? (
        <>
          <ActivityIndicator accessibilityLabel="Opening reader" />
          <Text>{snapshot.loading ? 'Preparing your Library…' : 'Opening reader…'}</Text>
        </>
      ) : null}
    </View>
  );
}
