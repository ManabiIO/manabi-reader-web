/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Host, TextInput, useNativeState } from '@expo/ui';
import { useReaderRuntime } from '../platform/RuntimeProvider.native';
import { isNativeFontState, type FontFamily, type NativeFontState } from './font-contract';
interface FontColors {
  background: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  error: string;
  mode: 'light' | 'dark';
  seedColor: string;
}
export function NativeFontManager({
  family,
  colors,
  onClose,
  onChanged
}: {
  family: FontFamily;
  colors: FontColors;
  onClose(): void;
  onChanged(): void;
}) {
  const { snapshot, command, importFont } = useReaderRuntime();
  const lifetime = useMemo(() => new AbortController(), [snapshot.session, snapshot.epoch, family]);
  const mounted = useRef(false);
  const started = useRef<AbortController | undefined>(undefined);
  const active = useRef(lifetime);
  active.current = lifetime;
  const lease = useRef<symbol | undefined>(undefined);
  const [data, setData] = useState<NativeFontState>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [needsRefresh, setNeedsRefresh] = useState(false);
  const name = useNativeState('');
  const [nameText, setNameText] = useState('');
  const nameRevision = useRef(0);
  const current = () => mounted.current && active.current === lifetime && !lifetime.signal.aborted;
  async function run(work: () => Promise<unknown>, changed = false) {
    if (!current() || lease.current) return false;
    const token = Symbol('font-ui');
    lease.current = token;
    setBusy(true);
    setError('');
    try {
      const result = await work();
      if (!current()) return false;
      if (result !== undefined) {
        if (!isNativeFontState(result))
          throw new Error(
            'Stored fonts returned an incompatible response. Refresh before continuing.'
          );
        setData(result);
        setNeedsRefresh(false);
        if (changed) onChanged();
      }
      return result !== undefined;
    } catch (cause) {
      if (current()) {
        setError(
          cause instanceof Error ? cause.message : 'Font storage is unavailable. Try again.'
        );
        setNeedsRefresh(true);
      }
      return false;
    } finally {
      if (lease.current === token) lease.current = undefined;
      if (current()) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (started.current !== lifetime) {
      started.current = lifetime;
      nameRevision.current++;
      name.value = '';
      setNameText('');
      setData(undefined);
      setNeedsRefresh(false);
      lease.current = undefined;
      void run(() => command('settings.fonts.read', {}));
    }
    return () => {
      mounted.current = false;
      // React development effect replay keeps the same admitted read; a real
      // unmount or replacement lifetime still retires the picker/upload.
      queueMicrotask(() => {
        if (!mounted.current || active.current !== lifetime) lifetime.abort();
      });
    };
  }, [lifetime]);
  const close = () => {
    lifetime.abort();
    onClose();
  };
  const disabled = busy || needsRefresh || !data;
  const action = (label: string, onPress: () => void, off = false) => (
    <Host matchContents colorScheme={colors.mode} seedColor={colors.seedColor}>
      <Button label={label} onPress={onPress} disabled={off} />
    </Host>
  );
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
            {family === 'primary' ? 'Primary font files' : 'Sans-serif font files'}
          </Text>
          {action('Close font manager', close)}
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text style={{ color: colors.muted }}>
            Fonts are stored by the local reader. Importing a file does not change the selected
            font.
          </Text>
          {busy ? (
            <ActivityIndicator accessibilityLabel="Loading or saving fonts" color={colors.text} />
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {error}
            </Text>
          ) : null}
          {needsRefresh ? (
            <Text style={{ color: colors.muted }}>
              Refresh saved fonts before retrying. An interrupted save is never replayed
              automatically.
            </Text>
          ) : null}
          {action(
            'Refresh stored fonts',
            () => {
              void run(() => command('settings.fonts.read', {}));
            },
            busy
          )}
          {data?.fonts.length === 0 ? (
            <Text style={{ color: colors.text }}>
              No stored custom fonts. Built-in fonts remain available in Settings.
            </Text>
          ) : null}
          {data?.fonts.map((font) => (
            <View
              key={font.key}
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.label, { color: colors.text }]}>{font.name}</Text>
              <Text style={{ color: colors.muted }}>{font.fileName}</Text>
              <Text style={{ color: colors.muted }}>
                {font.available
                  ? 'Stored on this device'
                  : 'File missing; import it again to use it'}
                {data.selected[family] === font.name ? ' · Selected' : ''}
              </Text>
              <View style={styles.row}>
                {action(
                  `Use ${font.name}`,
                  () => {
                    void run(
                      () =>
                        command('settings.fonts.action', {
                          type: 'select',
                          token: data.token,
                          key: font.key,
                          family
                        }),
                      true
                    ).then((saved) => {
                      if (saved && current()) close();
                    });
                  },
                  disabled || !font.available
                )}
                {action(
                  `Remove ${font.name}`,
                  () =>
                    Alert.alert(
                      `Remove ${font.name}?`,
                      'Remove this stored font file. Only this exact font can reset the selected family.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => {
                            void run(
                              () =>
                                command('settings.fonts.action', {
                                  type: 'remove',
                                  token: data.token,
                                  key: font.key,
                                  family
                                }),
                              true
                            );
                          }
                        }
                      ]
                    ),
                  disabled
                )}
              </View>
            </View>
          ))}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text accessibilityRole="header" style={[styles.label, { color: colors.text }]}>
              Add font file
            </Text>
            <Text style={{ color: colors.muted }}>
              WOFF2, WOFF, TTF or OTF. Native transfers are limited to 256 MB. Your original file is
              not changed.
            </Text>
            <Host
              matchContents={{ vertical: true }}
              colorScheme={colors.mode}
              seedColor={colors.seedColor}
              accessibilityLabel="Font name"
              style={{ width: '100%', minHeight: 48 }}
            >
              <TextInput
                value={name}
                placeholder="Font name"
                maxLength={200}
                editable={!disabled}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => {
                  nameRevision.current++;
                  name.value = value;
                  setNameText(value);
                }}
              />
            </Host>
            {action(
              'Choose font file and save',
              () => {
                const chosenName = nameText,
                  revision = nameRevision.current;
                void run(async () => {
                  if (!(await importFont(chosenName, lifetime.signal)) || !current())
                    return undefined;
                  return command('settings.fonts.read', {});
                }, true).then((saved) => {
                  if (saved && current() && nameRevision.current === revision) {
                    name.value = '';
                    setNameText('');
                  }
                });
              },
              disabled || !nameText.trim()
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    padding: 16,
    gap: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  heading: { fontSize: 22, fontWeight: '600', flexShrink: 1 },
  content: { padding: 16, gap: 16 },
  card: { padding: 16, borderRadius: 16, borderWidth: 1, gap: 10 },
  label: { fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
});
