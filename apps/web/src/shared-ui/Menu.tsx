/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { Modal, Pressable, View, ScrollView, useWindowDimensions } from 'react-native';
import { useUiTheme } from './theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
export interface MenuProps {
  visible: boolean;
  onClose(): void;
  label: string;
  children: ReactNode;
}
export function Menu({ visible, onClose, label, children }: MenuProps) {
  const { colors } = useUiTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent onRequestClose={onClose} animationType="fade">
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + 64,
          paddingHorizontal: 16,
          alignItems: 'flex-end'
        }}
      >
        <Pressable
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
        />
        <View
          role="menu"
          accessibilityLabel={label}
          accessibilityViewIsModal
          style={{
            minWidth: 220,
            maxHeight: Math.max(44, height - insets.top - insets.bottom - 88),
            maxWidth: '100%',
            padding: 8,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.popover,
            gap: 4
          }}
        >
          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 4 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
