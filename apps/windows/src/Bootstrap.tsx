/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useState } from 'react';
import {
  Button,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from 'react-native';

// Developer-only host acceptance screen. No library storage or user data is
// opened until the persistent WebView2 owner has its own acceptance gate.
export default function Bootstrap() {
  const { width, height } = useWindowDimensions();
  const [text, setText] = useState('');
  const [presses, setPresses] = useState(0);
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.heading}>
          Manabi Reader · Windows host
        </Text>
        <Text>Host qualification only. The reader library is not connected yet.</Text>
        <Text testID="host-platform">
          {Platform.OS} · {Math.round(width)} × {Math.round(height)}
        </Text>
        <TextInput
          testID="host-input"
          accessibilityLabel="Keyboard and Japanese input check"
          placeholder="Type here to check keyboard and IME input"
          value={text}
          onChangeText={setText}
          style={styles.input}
        />
        <Text selectable testID="host-input-echo">
          {text || '日本語の入力を確認できます。'}
        </Text>
        <Button
          testID="host-increment"
          title={`Interaction check: ${presses}`}
          onPress={() => setPresses((value) => value + 1)}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, backgroundColor: '#f7f6f2' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: 20 },
  heading: { fontSize: 28, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#6d746c', borderRadius: 8, padding: 12, minHeight: 48 }
});
