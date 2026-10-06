/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useMemo, useRef } from 'react';
import { useLocalSearchParams, usePathname } from 'expo-router';
import { useReaderRuntime } from '../../platform/RuntimeProvider.native';
import { nativeStatisticsRoute, statisticsRouteError } from '../../statistics-react/native-route';
import { createNativeStatisticsPort } from './native-port';
export function useStatisticsPort() {
  const runtime = useReaderRuntime(),
    pathname = usePathname();
  const route = nativeStatisticsRoute(useLocalSearchParams());
  const token = route.kind === 'selection' ? route.token : undefined;
  const valid = route.kind !== 'invalid' && pathname === '/statistics';
  const key = `${runtime.snapshot.session}:${runtime.snapshot.epoch}:${valid ? (token ?? 'all') : 'invalid'}`;
  const latest = useRef(key);
  latest.current = key;
  return useMemo(
    () =>
      createNativeStatisticsPort({
        ownerKey: () => latest.current,
        command: runtime.command,
        selectionToken: token,
        error: !valid
          ? statisticsRouteError
          : !runtime.snapshot.session
            ? 'The reading runtime is starting. Statistics will load when it is ready.'
            : undefined
      }),
    [key, runtime.command, token, valid]
  );
}
