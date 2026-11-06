/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { View } from 'react-native';

export function FontList({ children }: { children: ReactNode }) {
  return <View style={{ minWidth: 0 }}>{children}</View>;
}
export const FontListItem = FontList;
