/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { semantics } from '@expo/ui/jetpack-compose/modifiers';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { Host, TextInput, useNativeState } from '@expo/ui';
import { ExpoButton as Button } from '../shared-ui/ExpoButton';
import { Dialog } from '../shared-ui/ModalSurface';
import { ActionButton } from '../shared-ui/ActionButton';
import {
  SettingsFontManager,
  SettingsFontImportFields,
  type FontManagerView
} from '../features/settings/SettingsFontManager';
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
  const [view, setView] = useState<FontManagerView>('Stored');
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
      setView('Stored');
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
  return (
    <Dialog
      visible
      title={family === 'primary' ? 'Primary font files' : 'Sans-serif font files'}
      closeLabel="Close font manager"
      onClose={close}
      footer={
        <ActionButton variant="ghost" style={{ minHeight: 44 }} onPress={close}>
          Done
        </ActionButton>
      }
    >
      <SettingsFontManager
        description="Fonts are stored by the local reader. Importing a file does not change the selected font."
        fonts={
          data?.fonts.map((font) => ({ ...font, selected: data.selected[family] === font.name })) ??
          []
        }
        view={view}
        onViewChange={setView}
        checking={!data && !error}
        available={!!data}
        busy={busy}
        error={error}
        needsRefresh={needsRefresh}
        recoveryHint={
          needsRefresh
            ? 'Refresh saved fonts before retrying. An interrupted save is never replayed automatically.'
            : undefined
        }
        refresh={{
          label: 'Refresh stored fonts',
          onPress: () => {
            void run(() => command('settings.fonts.read', {}));
          }
        }}
        onSelect={(font) => {
          if (!data) return;
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
        }}
        onRemove={(font) => {
          if (!data) return;
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
          );
        }}
      >
        <SettingsFontImportFields
          busy={busy}
          help="WOFF2, WOFF, TTF or OTF. Native transfers are limited to 256 MB. Your original file is not changed."
          nameInput={
            <Host
              matchContents={{ vertical: true }}
              colorScheme={colors.mode}
              seedColor={colors.seedColor}
              accessibilityLabel="Font name"
              style={{ width: '100%', minHeight: 48 }}
            >
              <TextInput
                modifiers={[semantics({ contentDescription: 'Font name' })]}
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
          }
          submit={
            <Host matchContents colorScheme={colors.mode} seedColor={colors.seedColor}>
              <Button
                label="Choose font file and save"
                disabled={disabled || !nameText.trim()}
                onPress={() => {
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
                      setView('Stored');
                    }
                  });
                }}
              />
            </Host>
          }
        />
      </SettingsFontManager>
    </Dialog>
  );
}
