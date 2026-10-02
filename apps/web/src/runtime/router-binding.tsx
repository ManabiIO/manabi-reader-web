/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect } from 'react';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { installRouter } from './navigation';
import { refreshLocation } from './stores';
export function RouterBinding() {
  const path = usePathname();
  const params = useGlobalSearchParams();
  useEffect(
    () =>
      installRouter({
        push: (path) => router.push(path as never),
        replace: (path) => router.replace(path as never)
      }),
    []
  );
  useEffect(refreshLocation, [path, params]);
  return null;
}
