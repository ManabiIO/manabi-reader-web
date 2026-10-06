/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { StatisticsPort } from './contract';
import { createStatisticsController } from './controller';

export function useStatisticsController(port: StatisticsPort) {
  const controller = useMemo(() => createStatisticsController(port), [port]);
  useEffect(() => controller.mount(), [controller]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  return { state, dispatch: controller.dispatch };
}
