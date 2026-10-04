/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import { Host, TextInput, useNativeState } from '@expo/ui';
import { Switch } from '../shared-ui/ExpoToggle';
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
import type { SettingField } from '../platform/runtime-contract';

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
  hideMenu
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  theme?: UiTheme;
  menuActions?: (close: () => void) => ReactNode;
  onBeforeBack?: () => boolean;
  hideMenu?: boolean;
}) {
  const { error, clearError } = useReaderRuntime();
  const provided = useUiTheme();
  const activeTheme = theme ?? provided;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: activeTheme.colors.background }]}>
      <ScreenStatusBar theme={activeTheme} />
      <NativeScreenHeader
        title={title}
        theme={theme}
        actions={actions}
        menuActions={menuActions}
        onBeforeBack={onBeforeBack}
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
  hideMenu
}: {
  title: string;
  actions?: ReactNode;
  menuActions?: (close: () => void) => ReactNode;
  theme?: UiTheme;
  onBeforeBack?: () => boolean;
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
      {!root && <RouteBack onBeforeBack={onBeforeBack} />}
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
export function NativeLibraryScreen() {
  const { snapshot, command, importBooks, busy } = useReaderRuntime();
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<number[]>([]);
  const search = useNativeState('');
  useEffect(() => setSelection([]), [snapshot.session, snapshot.epoch]);
  const visible = snapshot.books;
  useEffect(() => {
    if (!snapshot.session) return;
    const timeout = setTimeout(() => {
      void command('library.query', { query, offset: 0, limit: 100 }).catch(() => {});
    }, 180);
    return () => clearTimeout(timeout);
  }, [query, snapshot.session, snapshot.epoch, command]);
  function remove() {
    const ids = [...selection];
    Alert.alert(
      'Remove selected books?',
      'Remove these cached book copies from this device? Reading statistics will be kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void command('delete', { ids, keepStatistics: true })
              .then(() => setSelection([]))
              .catch(() => {});
          }
        }
      ]
    );
  }
  return (
    <Screen
      title="Library"
      actions={
        <Action
          label={busy ? 'Importing…' : 'Import Books'}
          onPress={() => {
            void importBooks();
          }}
          disabled={busy || snapshot.loading}
          variant="filled"
        />
      }
    >
      <Host matchContents style={styles.search}>
        <TextInput
          value={search}
          placeholder="Search library"
          onChangeText={(value) => {
            search.value = value;
            setQuery(value);
          }}
        />
      </Host>
      {selection.length > 0 && (
        <View style={styles.row}>
          <Text>{selection.length} selected</Text>
          <Action label="Remove selected" onPress={remove} />
          <Action label="Cancel selection" onPress={() => setSelection([])} />
        </View>
      )}
      {snapshot.loading ? (
        <ActivityIndicator accessibilityLabel="Loading Library" />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(book) => String(book.id)}
          contentContainerStyle={styles.list}
          ListFooterComponent={
            <View style={styles.row}>
              <Text>{snapshot.totalBooks ?? visible.length} books</Text>
              <Action
                label="Previous page"
                disabled={!snapshot.libraryPage?.offset}
                onPress={() => {
                  void command('library.query', {
                    query,
                    offset: Math.max(0, (snapshot.libraryPage?.offset ?? 0) - 100),
                    limit: 100
                  }).catch(() => {});
                }}
              />
              <Action
                label="Next page"
                disabled={
                  (snapshot.libraryPage?.offset ?? 0) + visible.length >= (snapshot.totalBooks ?? 0)
                }
                onPress={() => {
                  void command('library.query', {
                    query,
                    offset: (snapshot.libraryPage?.offset ?? 0) + 100,
                    limit: 100
                  }).catch(() => {});
                }}
              />
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.heading}>
                {query ? 'No matching books' : 'Your books, ready to read'}
              </Text>
              <Text>
                Import an EPUB, HTMLZ, or text file. Books stay available offline on this device.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Read ${item.title}`}
              accessibilityState={{ selected: selection.includes(item.id) }}
              onLongPress={() =>
                setSelection((previous) =>
                  previous.includes(item.id)
                    ? previous.filter((id) => id !== item.id)
                    : [...previous, item.id]
                )
              }
              onPress={() => {
                if (selection.length)
                  setSelection((previous) =>
                    previous.includes(item.id)
                      ? previous.filter((id) => id !== item.id)
                      : [...previous, item.id]
                  );
                else
                  void command('open', { bookId: item.id })
                    .then(() => router.push({ pathname: '/b', params: { id: item.id } }))
                    .catch(() => {});
              }}
              style={[styles.book, selection.includes(item.id) && styles.selected]}
            >
              <View style={styles.cover}>
                <Text style={styles.coverText}>{item.title.slice(0, 6)}</Text>
              </View>
              <View style={styles.bookDetails}>
                <Text style={styles.title}>{item.title}</Text>
                {item.creators ? <Text>{item.creators}</Text> : null}
                <Text>
                  {item.characters > 0
                    ? `${Math.min(100, Math.round((item.progress / item.characters) * 100))}% read`
                    : 'Ready to read'}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
function Setting({ field }: { field: SettingField }) {
  const { command } = useReaderRuntime();
  const text = useNativeState(String(field.value));
  const [draft, setDraft] = useState(String(field.value));
  useEffect(() => {
    text.value = String(field.value);
    setDraft(String(field.value));
  }, [field.value]);
  const save = (value: unknown) => {
    void command('settings', { key: field.key, value }).catch(() => {});
  };
  if (field.kind === 'boolean')
    return (
      <View style={styles.setting}>
        <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
          <Switch label={field.label} value={!!field.value} onValueChange={save} />
        </Host>
      </View>
    );
  return (
    <View style={styles.setting}>
      <Text style={styles.title}>{field.label}</Text>
      {field.kind === 'choice' ? (
        <View style={styles.row}>
          {field.choices?.map((choice) => (
            <Action
              key={choice}
              label={choice}
              variant={choice === field.value ? 'filled' : 'outlined'}
              onPress={() => save(choice)}
            />
          ))}
        </View>
      ) : (
        <View style={styles.row}>
          <Host matchContents style={{ flex: 1 }}>
            <TextInput
              value={text}
              keyboardType={field.kind === 'number' ? 'decimal-pad' : 'default'}
              onChangeText={(value) => {
                text.value = value;
                setDraft(value);
              }}
            />
          </Host>
          <Action
            label={`Apply ${field.label}`}
            onPress={() => save(field.kind === 'number' ? Number(draft) : draft)}
          />
        </View>
      )}
    </View>
  );
}
export function NativeSettingsScreen() {
  const { snapshot } = useReaderRuntime();
  return (
    <Screen title="Settings">
      <ScrollView contentContainerStyle={styles.list}>
        {snapshot.settings.map((field) => (
          <Setting key={field.key} field={field} />
        ))}
      </ScrollView>
    </Screen>
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
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  navigation: {
    borderTopWidth: 1,
    borderTopColor: '#dce2db',
    padding: 8,
    flexDirection: 'row',
    justifyContent: 'space-around',
    flexWrap: 'wrap'
  },
  search: { paddingHorizontal: 16, paddingBottom: 12 },
  list: { padding: 16, gap: 12 },
  empty: { padding: 24, gap: 12 },
  book: {
    flexDirection: 'row',
    padding: 12,
    marginBottom: 10,
    gap: 16,
    borderRadius: 16,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e0e4dc'
  },
  selected: { borderColor: '#477d54', borderWidth: 2 },
  cover: {
    width: 72,
    minHeight: 100,
    borderRadius: 6,
    backgroundColor: '#e0ebdd',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8
  },
  coverText: { color: '#355a3c', fontSize: 18, fontWeight: '600' },
  bookDetails: { flex: 1, gap: 8, justifyContent: 'center' },
  setting: { gap: 8, padding: 14, borderRadius: 14, backgroundColor: 'white' },
  error: { margin: 12, padding: 12, backgroundColor: '#ffe8e2', borderRadius: 12, gap: 8 }
});
