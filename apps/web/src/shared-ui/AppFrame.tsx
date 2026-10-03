/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { SafeAreaView } from 'react-native-safe-area-context';
import type { ViewProps } from 'react-native';
/** Preserve the native route's safe-area ownership without changing its content. */
export function AppFrame(props: ViewProps) {
  return <SafeAreaView {...props} />;
}
