/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Navigator, Stack } from 'expo-router';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RuntimeProvider } from '../platform/RuntimeProvider';
import { WebSlotRouter } from '../runtime/web-slot-router';
import '../app.css';
import '../app.generated.css';
function WebSlot() {
  const { NavigationContent } = Navigator.useContext();
  return (
    <NavigationContent>
      <Navigator.Slot />
    </NavigationContent>
  );
}
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <RuntimeProvider>
        {Platform.OS === 'web' ? (
          <Navigator router={WebSlotRouter}>
            <WebSlot />
          </Navigator>
        ) : (
          <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
        )}
      </RuntimeProvider>
    </SafeAreaProvider>
  );
}
