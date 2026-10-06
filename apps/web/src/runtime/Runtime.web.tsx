/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect } from 'react';
import { usePathname } from 'expo-router';
import { refreshLocation } from './stores';
import { BrowserRuntime } from './BrowserRuntime';
export { BrowserRuntime } from './BrowserRuntime';
/** Only the web shell subscribes to Expo Router. The Android DOM owner has an explicit route bridge. */
export default function Runtime() {
  const pathname = usePathname();
  useEffect(refreshLocation, [pathname]);
  return <BrowserRuntime />;
}
