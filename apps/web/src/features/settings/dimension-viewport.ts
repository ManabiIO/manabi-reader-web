/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useWindowDimensions } from 'react-native';
/** The reader uses the screen viewport, not the narrower Settings card. */
export function useDimensionViewport() {
  const { width, height } = useWindowDimensions();
  return { width, height };
}
