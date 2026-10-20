/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Host, Picker, TextInput, useNativeState } from '@expo/ui';
import { SettingsThemeEditor } from '../features/settings/SettingsThemeEditor';
import { themeCopyOptions } from '../features/settings/theme-editor';
import { SettingsDimensionEditor } from '../features/settings/SettingsDimensionEditor';
import { SettingsSwitch } from '../features/settings/SettingsSwitch';
import { SettingsChoices } from '../features/settings/SettingsChoices';
import { SettingsThemeChoices, AddThemeButton } from '../features/settings/SettingsThemeChoices';
import { ExpoButton as Button } from '../shared-ui/ExpoButton';
import { MenuAction, NativeScreenHeader } from '../screens/NativeScreens';
import { ScreenStatusBar } from '../shared-ui/ScreenStatusBar';
import { Dialog } from '../shared-ui/ModalSurface';
import { useReaderRuntime } from '../platform/RuntimeProvider.native';
import { themeForMode, type ThemeOption } from '../lib/data/theme-option';
import { dimensionLabel } from '../lib/components/settings/dimension-presets';
import { matchesNativeSetting, parseSettingDraft, type SettingValue } from './schema';
import { NativeSettingsSession, type SettingsViewState } from './lifecycle';
import type {
  NativeSettingField,
  NativeSettingsAction,
  NativeSettingsState,
  NativeTheme
} from './contract';

import { createUiTheme, UiThemeProvider } from '../shared-ui/theme';
import { SettingsFieldGroup } from '../features/settings/SettingsFieldGroup';
import * as settingsFieldLayout from '../features/settings/field-layout';

import { SettingsWorkspace as SharedSettingsWorkspace } from '../features/settings/SettingsWorkspace';
import * as workspaceLayout from '../features/settings/workspace-layout';
import { createSettingsWorkspaceState } from '../features/settings/workspace-state';

import { NativeFontManager } from './NativeFontManager';

interface Colors {
  background: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  error: string;
  mode: 'light' | 'dark';
  seedColor: string;
}
type Act = (action: NativeSettingsAction) => Promise<boolean>;
function Action({
  label,
  onPress,
  disabled,
  selected,
  colors
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  selected?: boolean;
  colors: Colors;
}) {
  return (
    <Host
      matchContents={{ vertical: true }}
      style={{ width: '100%' }}
      colorScheme={colors.mode}
      seedColor={colors.seedColor}
    >
      <Button
        label={label}
        onPress={onPress}
        disabled={disabled}
        variant={selected ? 'filled' : 'outlined'}
      />
    </Host>
  );
}
function DraftInput({
  label,
  value,
  onChange,
  disabled,
  number = false,
  colors,
  placeholder
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  number?: boolean;
  colors: Colors;
  placeholder?: string;
}) {
  const nativeValue = useNativeState(value);
  useEffect(() => {
    nativeValue.value = value;
  }, [value, nativeValue]);
  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme={colors.mode}
      seedColor={colors.seedColor}
      accessibilityLabel={label}
      style={styles.input}
    >
      <TextInput
        value={nativeValue}
        editable={!disabled}
        placeholder={placeholder ?? label}
        keyboardType={number ? 'decimal-pad' : 'default'}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={1024}
        onChangeText={(next) => {
          nativeValue.value = next;
          onChange(next);
        }}
      />
    </Host>
  );
}
function Card({ colors, children }: { colors: Colors; children: ReactNode }) {
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {children}
    </View>
  );
}
function FieldEditor({
  field,
  data,
  act,
  busy,
  colors,
  refresh,
  themeActions
}: {
  field: NativeSettingField;
  refresh(): void;
  data: NativeSettingsState;
  act: Act;
  busy: boolean;
  colors: Colors;
  themeActions: {
    disabled: boolean;
    add(): void;
    edit(id: string): void;
    remove(id: string): void;
  };
}) {
  const [fontsOpen, setFontsOpen] = useState(false);
  const initial = field.value === null ? '' : String(field.value);
  const [draft, setDraft] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [base, setBase] = useState(field.value);
  const [error, setError] = useState('');
  const editRevision = useRef(0);
  useEffect(() => {
    if (!dirty) {
      setDraft(initial);
      setBase(field.value);
    }
  }, [initial, field.value, dirty]);
  const disabled = busy || !field.enabled;
  const save = async (value: SettingValue, expectedValue = field.value) => {
    setError('');
    const revision = editRevision.current;
    const ok = await act({ type: 'set', key: field.key, value, expectedValue });
    if (ok && revision === editRevision.current) setDirty(false);
  };
  const edit = (value: string) => {
    editRevision.current++;
    if (!dirty) setBase(field.value);
    setDraft(value);
    setDirty(true);
    setError('');
  };
  const cancel = () => {
    editRevision.current++;
    setDraft(initial);
    setBase(field.value);
    setDirty(false);
    setError('');
  };
  const isDimension =
    field.key === 'firstDimensionMargin' || field.key === 'secondDimensionMaxValue';
  const firstDimension = field.key === 'firstDimensionMargin';
  const vertical = data.fields.find((item) => item.key === 'writingMode')?.value === 'vertical-rl';
  const label = isDimension
    ? `${dimensionLabel(vertical, firstDimension)} (pixels${firstDimension ? ' per side' : ''})`
    : field.label;
  const fontNames =
    field.key === 'fontFamilyGroupOne'
      ? data.fonts.primary
      : field.key === 'fontFamilyGroupTwo'
        ? data.fonts.secondary
        : undefined;
  const shownChoices = field.choices ?? [];
  return (
    <SettingsFieldGroup
      layout={settingsFieldLayout}
      settingId={field.key}
      category={field.category}
      title={label}
      description={field.description}
      colors={colors}
    >
      {field.kind === 'boolean' ? (
        <SettingsSwitch
          label={field.label}
          value={field.value === true}
          disabled={disabled}
          onValueChange={(value) => {
            void save(value);
          }}
        />
      ) : field.kind === 'choice' && field.key !== 'theme' ? (
        <SettingsChoices
          label={field.label}
          value={String(field.value)}
          options={shownChoices}
          disabled={disabled}
          onValueChange={(value) => {
            void save(value);
          }}
        />
      ) : field.kind === 'choice' ? (
        <SettingsThemeChoices
          label={field.label}
          value={String(field.value)}
          options={data.themes.map((theme) => {
            const palette = themeForMode(
              theme.id,
              colors.mode,
              theme.custom ? { [theme.id]: theme.colors } : {}
            );
            return {
              value: theme.id,
              label: theme.label,
              custom: theme.custom,
              colors: { foreground: palette.fontColor, background: palette.backgroundColor }
            };
          })}
          disabled={disabled}
          actionsDisabled={disabled || themeActions.disabled}
          onValueChange={(value) => {
            void save(value);
          }}
          onEdit={themeActions.edit}
          onDelete={themeActions.remove}
        >
          <AddThemeButton disabled={disabled || themeActions.disabled} onPress={themeActions.add} />
        </SettingsThemeChoices>
      ) : (
        <>
          {fontNames && (
            <>
              <Action
                label={`Manage ${field.label} files`}
                colors={colors}
                disabled={disabled}
                onPress={() => setFontsOpen(true)}
              />
              {fontsOpen && (
                <NativeFontManager
                  family={field.key === 'fontFamilyGroupOne' ? 'primary' : 'secondary'}
                  colors={colors}
                  onClose={() => setFontsOpen(false)}
                  onChanged={refresh}
                />
              )}

              <Text style={{ color: colors.muted }}>
                {field.key === 'fontFamilyGroupOne'
                  ? `Effective font: ${data.fonts.effectivePrimary}`
                  : 'Choose a packaged font, or manage imported fonts'}
              </Text>
              <Host
                matchContents
                colorScheme={colors.mode}
                seedColor={colors.seedColor}
                accessibilityLabel={`Available ${field.label}`}
              >
                <Picker
                  selectedValue={String(field.value ?? '')}
                  enabled={!disabled}
                  onValueChange={(value) => {
                    void save(String(value));
                  }}
                >
                  {!fontNames.includes(String(field.value)) && (
                    <Picker.Item
                      label={`Saved preference: ${String(field.value)}`}
                      value={String(field.value ?? '')}
                    />
                  )}
                  {fontNames.map((name) => (
                    <Picker.Item key={name} label={name} value={name} />
                  ))}
                </Picker>
              </Host>
            </>
          )}
          {!fontNames && (
            <>
              <DraftInput
                label={field.label}
                value={draft}
                onChange={edit}
                disabled={disabled}
                number={field.kind === 'number'}
                colors={colors}
                placeholder={field.nullable ? 'Default' : undefined}
              />
              <View style={styles.row}>
                <Action
                  label={`Apply ${field.label}`}
                  colors={colors}
                  disabled={disabled || !dirty}
                  onPress={() => {
                    try {
                      void save(parseSettingDraft(field, draft), base);
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : 'Check this value.');
                    }
                  }}
                />
                {dirty && (
                  <Action label="Cancel edit" colors={colors} disabled={busy} onPress={cancel} />
                )}
              </View>
            </>
          )}
          {field.kind === 'number' && (
            <Text style={{ color: colors.muted }}>
              {field.min !== undefined ? `Minimum ${field.min}` : ''}
              {field.max !== undefined ? ` · Maximum ${field.max}` : ''}
              {field.step !== undefined ? ` · Step ${field.step}` : ''}
            </Text>
          )}
          {isDimension && (
            <SettingsDimensionEditor
              value={Number(field.value)}
              vertical={vertical}
              first={firstDimension}
              disabled={disabled || dirty}
              onValueChange={(value) => {
                void save(value);
              }}
            />
          )}
        </>
      )}
      {field.key === 'customReadingPointEnabled' && field.value === true && (
        <Action
          label="Reset reading points"
          colors={colors}
          disabled={disabled}
          onPress={() => {
            void act({ type: 'reading-point.reset' });
          }}
        />
      )}
      {!field.enabled && (
        <Text style={{ color: colors.muted }}>
          {field.unavailableReason ?? 'Available when its related reader preferences are enabled.'}
        </Text>
      )}
      {dirty && !Object.is(base, field.value) && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          The saved value changed. Cancel this edit to load it; applying the older edit will be
          rejected.
        </Text>
      )}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      ) : null}
    </SettingsFieldGroup>
  );
}
export function NativeSettingsScreen() {
  const { snapshot, command } = useReaderRuntime();
  const currentOwner = useRef({ session: snapshot.session, epoch: snapshot.epoch });
  currentOwner.current = { session: snapshot.session, epoch: snapshot.epoch };
  const [view, setView] = useState<SettingsViewState>({
    pending: false,
    error: '',
    reconcileRequired: false
  });
  const [workspace] = useState(() => createSettingsWorkspaceState());
  const { category, query } = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
    workspace.getSnapshot
  );
  const [editor, setEditor] = useState<{ original: NativeTheme | null; seed: ThemeOption } | null>(
    null
  );
  const [stateOwner, setStateOwner] = useState('');
  const ownerKey = `${snapshot.session}:${snapshot.epoch}`;
  const sessionRef = useRef<NativeSettingsSession | null>(null);
  useFocusEffect(
    useCallback(() => {
      // Scope also ends on navigation blur, and on React's development effect replay.
      const session = new NativeSettingsSession(
        { session: snapshot.session, epoch: snapshot.epoch },
        () => currentOwner.current,
        command,
        (value) => {
          setView(value);
          setStateOwner(ownerKey);
        }
      );
      sessionRef.current = session;
      setView({ pending: false, error: '', reconcileRequired: false });
      setEditor(null);
      session.start();
      return () => {
        session.dispose();
        if (sessionRef.current === session) sessionRef.current = null;
      };
    }, [snapshot.session, snapshot.epoch, command])
  );
  const data = stateOwner === ownerKey ? view.data : undefined;
  const deviceMode = useColorScheme();
  const appearance = data?.fields.find((field) => field.key === 'appearance')?.value;
  const mode =
    appearance === 'dark' || appearance === 'light'
      ? appearance
      : deviceMode === 'dark'
        ? 'dark'
        : 'light';
  const selectedTheme = data?.themes.find(
    (theme) => theme.id === data.fields.find((field) => field.key === 'theme')?.value
  );
  const resolved = themeForMode(
    selectedTheme?.id ?? 'manabi-theme',
    mode,
    selectedTheme?.custom ? { [selectedTheme.id]: selectedTheme.colors } : {}
  );
  const uiTheme = createUiTheme(
    selectedTheme?.id ?? 'manabi-theme',
    mode,
    selectedTheme?.custom ? { [selectedTheme.id]: selectedTheme.colors } : {}
  );
  const colors: Colors = {
    background: uiTheme.colors.background,
    card: uiTheme.colors.card,
    text: uiTheme.colors.foreground,
    muted: uiTheme.colors.mutedForeground,
    border: uiTheme.colors.border,
    error: uiTheme.colors.destructive,
    seedColor: uiTheme.seedColor,
    mode
  };
  const busy = view.pending || view.reconcileRequired || !data;
  // Capture this render's capability so delayed alerts cannot act through a newer session.
  const activeSession = sessionRef.current;
  const act: Act = (action) => activeSession?.act(action) ?? Promise.resolve(false);
  const themeActions = {
    disabled: busy || !!editor,
    add: () => setEditor({ original: null, seed: { ...resolved } }),
    edit: (id: string) => {
      const theme = data?.themes.find((item) => item.id === id);
      if (theme?.custom) setEditor({ original: theme, seed: { ...theme.colors } });
    },
    remove: (id: string) => {
      const theme = data?.themes.find((item) => item.id === id);
      if (!theme?.custom) return;
      // Capture both the existing palette and this render's admitted session
      // before displaying the asynchronous platform confirmation.
      Alert.alert(
        `Delete ${theme.label}?`,
        'This local custom theme will be removed. The existing Manabi preset will be selected.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void act({ type: 'theme.delete', name: theme.id, expectedColors: theme.colors });
            }
          }
        ]
      );
    }
  };
  const fields =
    data?.fields.filter(
      (field) =>
        matchesNativeSetting(field, category, query) &&
        (field.enabled || !!query.trim() || !!field.unavailableReason)
    ) ?? [];
  const gates =
    data?.gates.filter((gate) =>
      query.trim()
        ? query
            .toLowerCase()
            .trim()
            .split(/\s+/)
            .every((word) => `${gate.label} ${gate.reason}`.toLowerCase().includes(word))
        : category === 'all' || category === gate.category
    ) ?? [];
  return (
    <UiThemeProvider
      themeId={selectedTheme?.id ?? 'manabi-theme'}
      appearance={mode}
      customThemes={
        selectedTheme?.custom ? { [selectedTheme.id]: selectedTheme.colors } : undefined
      }
    >
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <ScreenStatusBar />
        <NativeScreenHeader
          title="Settings"
          theme={uiTheme}
          menuActions={(close) => (
            <MenuAction
              label="Refresh saved settings"
              disabled={view.pending || !snapshot.session}
              onPress={() => {
                close();
                void sessionRef.current?.refresh();
              }}
            />
          )}
        />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <SharedSettingsWorkspace
            layout={workspaceLayout}
            filter={{ category, query }}
            onSearch={workspace.search}
            onCategory={workspace.choose}
            colors={colors}
            saveDescription="Switches and choices save immediately. Text and numbers save when you tap Apply."
            resultText={
              data
                ? `${fields.length} matching controls · ${gates.length} integration notes`
                : 'Loading settings…'
            }
          >
            {view.pending ? (
              <ActivityIndicator accessibilityLabel="Loading settings" color={colors.text} />
            ) : null}
            {stateOwner === ownerKey && view.error ? (
              <Card colors={colors}>
                <Text accessibilityRole="alert" style={{ color: colors.error }}>
                  {view.error}
                </Text>
                {view.reconcileRequired && (
                  <Text style={{ color: colors.muted }}>
                    Refresh saved settings to reconcile before making another change. No command
                    will be replayed automatically.
                  </Text>
                )}
              </Card>
            ) : null}
            {!snapshot.session && (
              <Text style={{ color: colors.muted }}>The local reader is starting…</Text>
            )}
            {data &&
              fields.map((field) => (
                <FieldEditor
                  key={`${ownerKey}:${field.key}`}
                  field={field}
                  refresh={() => {
                    void sessionRef.current?.refresh();
                  }}
                  data={data}
                  act={act}
                  busy={busy}
                  colors={colors}
                  themeActions={themeActions}
                />
              ))}
            {editor && data && (
              <Dialog
                visible
                title={editor.original ? 'Edit custom theme' : 'New custom theme'}
                closeLabel="Close theme editor"
                closeDisabled={view.pending}
                onClose={() => setEditor(null)}
              >
                <SettingsThemeEditor
                  initialPalette={editor.seed}
                  previousName={editor.original?.id}
                  activeTheme={String(
                    data.fields.find((field) => field.key === 'theme')?.value ?? 'manabi-theme'
                  )}
                  options={themeCopyOptions(
                    data.themes,
                    mode,
                    Object.fromEntries(
                      data.themes
                        .filter((theme) => theme.custom)
                        .map((theme) => [theme.id, theme.colors])
                    )
                  )}
                  existingNames={data.themes
                    .filter((theme) => theme.custom)
                    .map((theme) => theme.id)}
                  busy={busy}
                  error={view.error}
                  onSave={(name, palette) =>
                    act({
                      type: 'theme.save',
                      name,
                      previousName: editor.original?.id ?? null,
                      expectedColors: editor.original?.colors ?? null,
                      colors: palette
                    })
                  }
                  onClose={() => setEditor(null)}
                />
              </Dialog>
            )}
            {gates.map((gate) => (
              <Card key={gate.id} colors={colors}>
                <Text accessibilityRole="header" style={[styles.label, { color: colors.text }]}>
                  {gate.label}
                </Text>
                <Text style={{ color: colors.muted }}>{gate.reason}</Text>
                {gate.id === 'storage-sources' && (
                  <Action
                    label="Accounts and libraries"
                    colors={colors}
                    onPress={() => router.push('/connections')}
                  />
                )}
              </Card>
            ))}
          </SharedSettingsWorkspace>
        </ScrollView>
      </SafeAreaView>
    </UiThemeProvider>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    minHeight: 64,
    paddingHorizontal: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10
  },
  heading: { fontSize: 26, fontWeight: '700' },
  label: { fontSize: 17, fontWeight: '600' },
  content: { padding: 16, gap: 14, width: '100%', maxWidth: 1000, alignSelf: 'center' },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  gap: { gap: 6 },
  input: { width: '100%', minHeight: 48 },
  navigation: {
    borderTopWidth: 1,
    padding: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    gap: 8
  }
});
