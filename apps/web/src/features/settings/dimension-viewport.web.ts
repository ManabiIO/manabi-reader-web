/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useSyncExternalStore } from 'react';
const snapshot = () =>
  typeof window === 'undefined' ? '0:0' : `${window.innerWidth}:${window.innerHeight}`;
const serverSnapshot = () => '0:0';
const subscribe = (notify: () => void) => {
  window.addEventListener('resize', notify);
  return () => window.removeEventListener('resize', notify);
};
/** Retain browser innerWidth/innerHeight pixel semantics, including scrollbars. */
export function useDimensionViewport() {
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [width, height] = value.split(':').map(Number);
  return { width, height };
}
