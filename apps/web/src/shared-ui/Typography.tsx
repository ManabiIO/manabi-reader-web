/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Platform, StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';
import { useUiTheme } from './theme';
/** Branded body text retains the browser's root text scaling and font token;
 * native keeps RN font scaling. Layout is still the same RN Text component. */
export function UiText({ style, ...props }: TextProps) {
  const { colors } = useUiTheme();
  const input = StyleSheet.flatten(style);
  const size = typeof input?.fontSize === 'number' ? input.fontSize : 16;
  const base: TextStyle = {
    color: colors.foreground,
    fontSize: 16,
    lineHeight: size <= 12 ? 16 : size <= 14 ? 20 : size * 1.5,
    ...input
  };
  const resolved: TextStyle =
    Platform.OS === 'web'
      ? {
          ...base,
          fontFamily: 'var(--font-sans, system-ui)',
          fontSize:
            typeof base.fontSize === 'number'
              ? (`${base.fontSize / 16}rem` as unknown as number)
              : base.fontSize,
          lineHeight:
            typeof base.lineHeight === 'number'
              ? (`${base.lineHeight / 16}rem` as unknown as number)
              : base.lineHeight
        }
      : base;
  return <Text {...props} style={resolved} />;
}
