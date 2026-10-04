/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { ObservableController } from './observable-controller';
export function useController<T extends ObservableController>(create: () => T, enabled = true): T {
  const [controller] = useState(create);
  useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => (enabled ? controller.activate() : undefined), [controller, enabled]);
  return controller;
}
/** Inputs cross this boundary atomically before paint; async operations retain their captured snapshots. */
export function useControllerProps<T extends ObservableController>(
  controller: T,
  props: Partial<T>
) {
  useLayoutEffect(() => {
    Object.assign(controller, props);
    controller.flush();
  }, [controller, ...Object.values(props)]);
}
