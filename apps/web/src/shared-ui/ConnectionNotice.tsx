/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { ActionButton } from './ActionButton';
import { Dialog } from './ModalSurface';
import { UiText } from './Typography';
import { useUiTheme } from './theme';

/** Shared web/Android presentation. No persistent flags or second storage owner. */
export function ConnectionNotice({
  online,
  inline = false,
  syncAction,
  statusIcon
}: {
  online: boolean | undefined;
  inline?: boolean;
  syncAction?: ReactNode;
  statusIcon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [returningFocus, setReturningFocus] = useState(false);
  const { colors } = useUiTheme();
  // Retain an open explanation and its focus-return target through reconnection.
  if (online !== false && !syncAction && !open && !returningFocus) return null;
  return (
    <>
      <ActionButton
        variant="ghost"
        shape="rounded"
        accessibilityLabel={
          online === false
            ? 'Offline. Connection details'
            : syncAction
              ? 'Review sync. Connection details'
              : 'Connection details'
        }
        dataSet={inline ? { 'connection-status': '' } : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPress={() => setOpen(true)}
        onBlur={() => setReturningFocus(false)}
        style={{
          minHeight: 44,
          paddingHorizontal: inline ? 8 : 14,
          paddingVertical: 10,
          borderWidth: inline ? 0 : 1,
          borderColor: colors.border,
          backgroundColor: inline ? 'transparent' : colors.card,
          borderRadius: inline ? 8 : 12
        }}
      >
        {statusIcon}
        <UiText role="status" accessibilityLiveRegion="polite" style={{ fontSize: 14 }}>
          {online === false
            ? inline
              ? 'Offline'
              : 'Offline · On this device'
            : syncAction
              ? 'Review sync'
              : 'Connection details'}
        </UiText>
      </ActionButton>
      <Dialog
        visible={open}
        onClose={() => {
          setReturningFocus(Platform.OS === 'web');
          setOpen(false);
        }}
        title="Reading on this device"
        closeLabel="Close connection details"
        maxWidth={440}
        stickyChrome
        testID="connection-details-dialog"
      >
        <View style={{ gap: 16 }}>
          <UiText role="status" accessibilityLiveRegion="polite" style={{ fontWeight: '600' }}>
            {online === false
              ? 'You’re offline. You can keep reading.'
              : 'Your device is connected.'}
          </UiText>
          <UiText>
            Books already saved on this device are available offline. Books and media you haven’t
            downloaded need a connection.
          </UiText>
          <UiText>
            Reading progress is saved on this device. Connect to sync with your linked libraries;
            being online doesn’t mean everything has synced. Books without a linked library stay on
            this device.
          </UiText>
          {syncAction && (
            <View style={{ gap: 8 }}>
              <UiText>Reading sync needs attention. You can keep reading on this device.</UiText>
              {syncAction}
            </View>
          )}
          <UiText style={{ fontSize: 14, color: colors.mutedForeground }}>
            Keep a backup of important reading data before clearing app or site data, or moving to
            another device.
          </UiText>
        </View>
      </Dialog>
    </>
  );
}
