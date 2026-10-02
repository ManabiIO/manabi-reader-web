/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useUiTheme } from './theme';
export interface FieldFrameProps {
  label?: string;
  accessibilityLabel?: string;
  hideLabel?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}
export function FieldFrame({
  label,
  accessibilityLabel,
  hideLabel,
  children,
  style
}: FieldFrameProps) {
  const { colors } = useUiTheme();
  return (
    <View accessibilityLabel={accessibilityLabel ?? label} style={[{ gap: 6, minWidth: 0 }, style]}>
      {label && !hideLabel ? (
        <Text style={{ color: colors.foreground, fontSize: 14 }}>{label}</Text>
      ) : null}
      {children}
    </View>
  );
}
