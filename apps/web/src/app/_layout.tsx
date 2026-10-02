/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RuntimeProvider } from '../platform/RuntimeProvider';
import '../app.css';
import '../app.generated.css';
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <RuntimeProvider>
        <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
      </RuntimeProvider>
    </SafeAreaProvider>
  );
}
