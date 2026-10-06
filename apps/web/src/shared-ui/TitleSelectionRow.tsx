/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

export interface TitleSelectionRowProps {
  children: ReactNode;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Native rows retain padding around the universal control's touch target. */
export function TitleSelectionRow({ children, style }: TitleSelectionRowProps) {
  return (
    <View
      style={[{ minHeight: 52, padding: 12, flexDirection: 'row', alignItems: 'center' }, style]}
    >
      {children}
    </View>
  );
}
