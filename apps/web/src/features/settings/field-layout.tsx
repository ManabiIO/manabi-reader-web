/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SettingsFieldColors } from './SettingsFieldGroup';

export interface FieldSurfaceProps {
  settingId: string;
  category: string;
  visible: boolean;
  labelledBy?: string;
  wide: boolean;
  colors?: SettingsFieldColors;
  children?: ReactNode;
}
export interface FieldTitleProps {
  id: string;
  emphasized: boolean;
  color?: string;
  children?: ReactNode;
}
export interface FieldDescriptionProps {
  color?: string;
  children?: ReactNode;
}

/** Native surface leaves preserve one RN parent and do not introduce another Expo Host boundary. */
export function FieldSurface({ visible, colors, children, settingId }: FieldSurfaceProps) {
  return (
    <View
      testID={`settings-field-${settingId}`}
      style={[
        styles.surface,
        { backgroundColor: colors?.card, borderColor: colors?.border },
        !visible && styles.hidden
      ]}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      {children}
    </View>
  );
}
export function FieldHeader({ children }: { children?: ReactNode }) {
  return <View style={styles.header}>{children}</View>;
}
export function FieldTitle({ id, emphasized, color, children }: FieldTitleProps) {
  return (
    <Text
      nativeID={id}
      accessibilityRole="header"
      style={[styles.title, { color }, emphasized && styles.emphasized]}
    >
      {children}
    </Text>
  );
}
export function FieldDescription({ color, children }: FieldDescriptionProps) {
  return <Text style={[styles.description, { color }]}>{children}</Text>;
}
export function FieldContent({ children }: { children?: ReactNode }) {
  return <View style={styles.content}>{children}</View>;
}
const styles = StyleSheet.create({
  surface: { minWidth: 0, padding: 16, borderRadius: 16, borderWidth: 1, gap: 12 },
  hidden: { display: 'none' },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  title: { fontSize: 14, flexShrink: 1 },
  emphasized: { fontWeight: '600' },
  description: { fontSize: 14 },
  content: { minWidth: 0, gap: 10 }
});
