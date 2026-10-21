/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useState, type ReactNode } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import { Host } from '@expo/ui';
import { ExpoButton } from '../shared-ui/ExpoButton';
import { ActionButton } from '../shared-ui/ActionButton';
import { Menu } from '../shared-ui/Menu';
import { UiIcon } from '../shared-ui/UiIcon';
import { RouteBack } from '../shared-ui/RouteBack';
import { ScreenStatusBar } from '../shared-ui/ScreenStatusBar';
import { useUiTheme } from '../shared-ui/theme';
import { contextualDestinations } from '../shared-ui/navigation-context';
import { useReaderRuntime } from '../platform/RuntimeProvider.native';
import type { UiTheme } from '../shared-ui/theme';

export function Action({
  label,
  onPress,
  disabled = false,
  variant = 'outlined',
  theme
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  variant?: 'filled' | 'outlined' | 'text';
  theme?: UiTheme;
}) {
  return (
    <Host matchContents colorScheme={theme?.mode} seedColor={theme?.seedColor}>
      <ExpoButton
        theme={theme}
        label={label}
        onPress={onPress}
        disabled={disabled}
        variant={variant}
      />
    </Host>
  );
}
export function MenuAction({
  label,
  onPress,
  disabled
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <ActionButton
      role="menuitem"
      variant="ghost"
      disabled={disabled}
      onPress={onPress}
      style={{ justifyContent: 'flex-start' }}
      textStyle={{ textAlign: 'left' }}
    >
      {label}
    </ActionButton>
  );
}
export function Screen({
  title,
  children,
  actions,
  theme,
  menuActions,
  onBeforeBack,
  backAction,
  hideMenu,
  background
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  theme?: UiTheme;
  menuActions?: (close: () => void) => ReactNode;
  onBeforeBack?: () => boolean;
  backAction?: ReactNode;
  hideMenu?: boolean;
  background?: ReactNode;
}) {
  const { error, clearError } = useReaderRuntime();
  const provided = useUiTheme();
  const activeTheme = theme ?? provided;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: activeTheme.colors.background }]}>
      {background}
      <ScreenStatusBar theme={activeTheme} />
      <NativeScreenHeader
        title={title}
        theme={theme}
        actions={actions}
        menuActions={menuActions}
        onBeforeBack={onBeforeBack}
        backAction={backAction}
        hideMenu={hideMenu}
      />
      {error ? (
        <View
          accessibilityRole="alert"
          style={[styles.error, { backgroundColor: activeTheme.colors.destructiveBackground }]}
        >
          <Text style={{ color: activeTheme.colors.foreground }}>{error}</Text>
          <Action theme={activeTheme} label="Dismiss" onPress={clearError} />
        </View>
      ) : null}
      {children}
    </SafeAreaView>
  );
}
export function NativeScreenHeader({
  title,
  actions,
  menuActions,
  theme,
  onBeforeBack,
  backAction,
  hideMenu
}: {
  title: string;
  actions?: ReactNode;
  menuActions?: (close: () => void) => ReactNode;
  theme?: UiTheme;
  onBeforeBack?: () => boolean;
  backAction?: ReactNode;
  hideMenu?: boolean;
}) {
  const provided = useUiTheme();
  const colors = (theme ?? provided).colors;
  const pathname = usePathname();
  const destinations = contextualDestinations(pathname, 'android');
  const [open, setOpen] = useState(false);
  const root = pathname === '/manage' || pathname === '/';
  return (
    <View style={styles.header}>
      {backAction ?? (!root && <RouteBack onBeforeBack={onBeforeBack} />)}
      <Text
        accessibilityRole="header"
        style={[
          styles.heading,
          { color: colors.foreground, flex: 1, flexShrink: 1, fontSize: root ? 20 : 22 }
        ]}
      >
        {title}
      </Text>
      {actions}
      {!hideMenu && (!!menuActions || destinations.length > 0) && (
        <View>
          <ActionButton
            variant="ghost"
            size="icon-lg"
            shape="circle"
            accessibilityLabel={`${title} actions`}
            aria-haspopup="menu"
            aria-expanded={open}
            onPress={() => setOpen(true)}
          >
            <UiIcon name="more" size={22} color={colors.foreground} />
          </ActionButton>
          <Menu visible={open} label={`${title} actions`} onClose={() => setOpen(false)}>
            {menuActions?.(() => setOpen(false))}
            {menuActions && destinations.length > 0 && (
              <View style={{ borderTopWidth: 1, borderColor: colors.border, marginVertical: 4 }} />
            )}
            {destinations.map((item) => (
              <ActionButton
                key={item.path}
                variant="ghost"
                role="menuitem"
                style={{ justifyContent: 'flex-start' }}
                textStyle={{ textAlign: 'left' }}
                onPress={() => {
                  setOpen(false);
                  router.push(item.path);
                }}
              >
                {item.label}
              </ActionButton>
            ))}
          </Menu>
        </View>
      )}
    </View>
  );
}
export function NativeConnectionsScreen() {
  const { snapshot, command } = useReaderRuntime();
  const { colors } = useUiTheme();
  return (
    <Screen title="Accounts and libraries">
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {snapshot.account.username
            ? `Signed in as ${snapshot.account.username}`
            : 'Manabi account'}
        </Text>
        <Text style={{ color: colors.foreground }}>
          {snapshot.account.status === 'unavailable'
            ? 'Manabi account services are not available on this deployment. Local libraries still work.'
            : snapshot.account.status === 'offline'
              ? 'Offline. Local reading data remains available.'
              : snapshot.account.username
                ? 'Your account is connected.'
                : 'Sign-in needs a supported native session handoff from the account service.'}
        </Text>
        <Action
          label="Refresh account"
          onPress={() => {
            void command('account.refresh').catch(() => {});
          }}
        />
        {snapshot.account.username && (
          <Action
            label="Sign out"
            onPress={() =>
              Alert.alert(
                'Sign out?',
                'Local books stay on this device. Account-owned reading data remains protected.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Sign out',
                    onPress: () => {
                      void command('account.logout').catch(() => {});
                    }
                  }
                ]
              )
            }
          />
        )}
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#faf9f6' },
  header: {
    minHeight: 64,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8
  },
  heading: { fontSize: 26, fontWeight: '700', color: '#222923' },
  title: { fontSize: 17, fontWeight: '600', color: '#222923' },
  list: { padding: 16, gap: 12 },
  error: { margin: 12, padding: 12, backgroundColor: '#ffe8e2', borderRadius: 12, gap: 8 }
});
