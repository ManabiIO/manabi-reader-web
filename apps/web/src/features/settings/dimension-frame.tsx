/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { View } from 'react-native';
import { UiText } from '../../shared-ui/Typography';
export interface DimensionFrameProps {
  label: string;
  children: ReactNode;
}
export function DimensionFrame({ label, children }: DimensionFrameProps) {
  return (
    <View accessibilityLabel={label} style={{ gap: 12, minWidth: 0, padding: 12 }}>
      <UiText style={{ fontWeight: '600', fontSize: 14 }}>{label}</UiText>
      {children}
    </View>
  );
}
