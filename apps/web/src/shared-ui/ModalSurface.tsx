/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { UiIcon } from './UiIcon';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { ActionButton, Heading } from './ActionButton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUiTheme } from './theme';
export interface ModalSurfaceProps {
  visible: boolean;
  onClose(): void;
  title: string;
  accessibilityLabel?: string;
  children: ReactNode;
  description?: string;
  descriptionHidden?: boolean;
  testID?: string;
  maxWidth?: number;
  showClose?: boolean;
  closeLabel?: string;
  closeDisabled?: boolean;
  panelClassName?: string;
  stickyChrome?: boolean;
  footer?: ReactNode;
  bodyScroll?: boolean;
}
export function ModalSurface({
  visible,
  onClose,
  title,
  accessibilityLabel,
  children,
  description,
  descriptionHidden,
  testID,
  maxWidth = 640,
  showClose = true,
  closeLabel = 'Close',
  closeDisabled = false,
  footer,
  bodyScroll = true,
  kind
}: ModalSurfaceProps & { kind: 'sheet' | 'dialog' }) {
  const { colors } = useUiTheme();
  const insets = useSafeAreaInsets();
  const Body = bodyScroll ? ScrollView : View;
  const dismiss = () => {
    if (!closeDisabled) onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View
        style={{
          flex: 1,
          justifyContent: kind === 'sheet' ? 'flex-end' : 'center',
          backgroundColor: 'rgba(0,0,0,0.5)'
        }}
      >
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={dismiss}
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
        />
        <View
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel ?? title}
          accessibilityHint={descriptionHidden ? description : undefined}
          testID={testID}
          style={{
            width: '100%',
            maxWidth,
            maxHeight: '90%',
            alignSelf: 'center',
            backgroundColor: colors.popover,
            borderRadius: 16,
            overflow: 'hidden'
          }}
        >
          <Body
            {...(bodyScroll
              ? {
                  keyboardShouldPersistTaps: 'handled' as const,
                  contentContainerStyle: {
                    padding: 20,
                    paddingBottom: Math.max(20, insets.bottom),
                    gap: 16
                  }
                }
              : {
                  style: {
                    padding: 20,
                    paddingBottom: Math.max(20, insets.bottom),
                    gap: 16,
                    minHeight: 0,
                    flexShrink: 1
                  }
                })}
          >
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap-reverse',
                alignItems: 'flex-start',
                gap: 12
              }}
            >
              <Heading style={{ flexGrow: 1, flexBasis: 160, alignSelf: 'center' }}>
                {title}
              </Heading>
              {showClose ? (
                <ActionButton
                  size="icon-lg"
                  shape="circle"
                  variant="ghost"
                  accessibilityLabel={closeLabel}
                  disabled={closeDisabled}
                  onPress={dismiss}
                  style={{ marginLeft: 'auto' }}
                >
                  <UiIcon name="close" size={18} />
                </ActionButton>
              ) : null}
            </View>
            {description && !descriptionHidden ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>{description}</Text>
            ) : null}
            {children}
            {footer}
          </Body>
        </View>
      </View>
    </Modal>
  );
}
export function Sheet(props: ModalSurfaceProps) {
  return <ModalSurface {...props} kind="sheet" />;
}
export function Dialog(props: ModalSurfaceProps) {
  return <ModalSurface {...props} kind="dialog" />;
}
