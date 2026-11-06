/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { UiText } from '../../shared-ui/Typography';
import { useUiTheme } from '../../shared-ui/theme';
import type { BackgroundMode, BackgroundTarget } from '../../lib/appearance/state';
export interface BackgroundFrameProps {
  label: string;
  busy: boolean;
  children?: ReactNode;
}
export interface BackgroundModeProps {
  target: BackgroundTarget;
  mode: BackgroundMode;
  children?: ReactNode;
}
export interface BackgroundPreviewProps extends BackgroundModeProps {
  uri?: string;
  fade: number;
  present: boolean;
}
export interface BackgroundMessageProps {
  kind: 'filename' | 'status' | 'error';
  children?: ReactNode;
}
export function BackgroundFrame({ label, busy, children }: BackgroundFrameProps) {
  const { colors } = useUiTheme();
  return (
    <View
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      style={{
        minWidth: 0,
        gap: 12,
        padding: 14,
        borderWidth: 1,
        borderRadius: 12,
        borderColor: colors.border
      }}
    >
      <UiText accessibilityRole="header" style={{ fontWeight: '600' }}>
        {label}
      </UiText>
      {children}
    </View>
  );
}
export function BackgroundModes({ children }: { children?: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{children}</View>;
}
export function BackgroundModeFrame({ mode, children }: BackgroundModeProps) {
  const { colors } = useUiTheme();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: 220,
        minWidth: 0,
        gap: 10,
        padding: 12,
        borderRadius: 12,
        backgroundColor: colors.muted
      }}
    >
      <UiText accessibilityRole="header" style={{ fontSize: 14, fontWeight: '600' }}>
        {mode === 'light' ? 'Light' : 'Dark'}
      </UiText>
      {children}
    </View>
  );
}
export function BackgroundPreview({ target, mode, uri, fade, present }: BackgroundPreviewProps) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        height: 120,
        overflow: 'hidden',
        borderRadius: 10,
        backgroundColor: mode === 'dark' ? '#111' : '#f7f7f7'
      }}
    >
      {uri && (
        <Image
          key={uri}
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessible={false}
        />
      )}
      {uri && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: mode === 'dark' ? '#000' : '#fff', opacity: fade }
          ]}
        />
      )}
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <UiText style={{ color: mode === 'dark' ? '#f7f7f7' : '#111', textAlign: 'center' }}>
          {uri
            ? target === 'reader'
              ? '本を読む\nRead comfortably'
              : 'Read comfortably'
            : present
              ? 'Preview unavailable'
              : 'No image'}
        </UiText>
      </View>
    </View>
  );
}
export function BackgroundMessage({ kind, children }: BackgroundMessageProps) {
  const { colors } = useUiTheme();
  return (
    <UiText
      accessibilityRole={kind === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion={kind === 'status' ? 'polite' : undefined}
      style={{
        fontSize: 13,
        color: kind === 'error' ? colors.destructive : colors.mutedForeground
      }}
    >
      {children}
    </UiText>
  );
}
export function BackgroundActions({ children }: { children?: ReactNode }) {
  return <View style={{ gap: 8 }}>{children}</View>;
}
