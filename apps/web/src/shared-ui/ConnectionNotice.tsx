/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useState } from 'react';
import { Platform, View } from 'react-native';
import { ActionButton } from './ActionButton';
import { Dialog } from './ModalSurface';
import { UiText } from './Typography';
import { useUiTheme } from './theme';

/** Shared web/Android presentation. No persistent flags or second storage owner. */
export function ConnectionNotice({ online }: { online: boolean | undefined }) {
  const [open, setOpen] = useState(false);
  const [returningFocus, setReturningFocus] = useState(false);
  const { colors } = useUiTheme();
  // Retain an open explanation and its focus-return target through reconnection.
  if (online !== false && !open && !returningFocus) return null;
  return (
    <>
      <ActionButton
        variant="ghost"
        shape="rounded"
        accessibilityLabel={online === false ? 'Offline. Connection details' : 'Connection details'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPress={() => setOpen(true)}
        onBlur={() => setReturningFocus(false)}
        style={{
          minHeight: 44,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          borderRadius: 12
        }}
      >
        <UiText role="status" accessibilityLiveRegion="polite" style={{ fontSize: 14 }}>
          {online === false ? 'Offline · On this device' : 'Connection details'}
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
          <UiText style={{ fontSize: 14, color: colors.mutedForeground }}>
            Keep a backup of important reading data before clearing app or site data, or moving to
            another device.
          </UiText>
        </View>
      </Dialog>
    </>
  );
}
