/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { SafeAreaView } from 'react-native-safe-area-context';
import type { ViewProps } from 'react-native';
import { ScreenStatusBar } from './ScreenStatusBar';
/** Preserve the native route's safe-area ownership without changing its content. */
export function AppFrame({ children, ...props }: ViewProps) {
  return (
    <SafeAreaView {...props}>
      <ScreenStatusBar />
      {children}
    </SafeAreaView>
  );
}
