/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  useWindowDimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Button, Host, Picker, Switch, TextInput, useNativeState } from '@expo/ui';
import { useReaderRuntime } from '../platform/RuntimeProvider.native';
import { themeForMode, type ThemeOption } from '../lib/data/theme-option';
import {
  dimensionExtent,
  dimensionLabel,
  dimensionLimits,
  dimensionPixels
} from '../lib/components/settings/dimension-presets';
import {
  matchesNativeSetting,
  parseSettingDraft,
  settingCategories,
  type SettingValue
} from './schema';
import { NativeSettingsSession, type SettingsViewState } from './lifecycle';
import type {
  NativeSettingField,
  NativeSettingsAction,
  NativeSettingsState,
  NativeTheme
} from './contract';

import { createUiTheme } from '../shared-ui/theme';
import { SettingsFieldGroup } from '../features/settings/SettingsFieldGroup';
import * as settingsFieldLayout from '../features/settings/field-layout';

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
    <Host matchContents colorScheme={colors.mode} seedColor={colors.seedColor}>
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
  colors
}: {
  field: NativeSettingField;
  data: NativeSettingsState;
  act: Act;
  busy: boolean;
  colors: Colors;
}) {
  const initial = field.value === null ? '' : String(field.value);
  const [draft, setDraft] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [base, setBase] = useState(field.value);
  const [error, setError] = useState('');
  const editRevision = useRef(0);
  const dimensions = useWindowDimensions();
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
  const availableChoice = shownChoices.some((choice) => choice.value === field.value);
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
        <Host matchContents colorScheme={colors.mode} seedColor={colors.seedColor}>
          <Switch
            label={field.label}
            value={field.value === true}
            disabled={disabled}
            onValueChange={(value) => {
              void save(value);
            }}
          />
        </Host>
      ) : field.kind === 'choice' ? (
        <Host
          matchContents
          colorScheme={colors.mode}
          seedColor={colors.seedColor}
          accessibilityLabel={field.label}
        >
          <Picker
            selectedValue={typeof field.value === 'string' ? field.value : ''}
            enabled={!disabled}
            onValueChange={(value) => {
              void save(String(value));
            }}
          >
            {!availableChoice && (
              <Picker.Item
                label={`Saved value: ${String(field.value)}`}
                value={typeof field.value === 'string' ? field.value : ''}
              />
            )}
            {shownChoices.map((choice) => (
              <Picker.Item key={choice.value} label={choice.label} value={choice.value} />
            ))}
          </Picker>
        </Host>
      ) : (
        <>
          {fontNames && (
            <>
              <Text style={{ color: colors.muted }}>
                {field.key === 'fontFamilyGroupOne'
                  ? `Effective font: ${data.fonts.effectivePrimary}`
                  : 'Choose a packaged or previously imported font'}
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
          {field.kind === 'number' && (
            <Text style={{ color: colors.muted }}>
              {field.min !== undefined ? `Minimum ${field.min}` : ''}
              {field.max !== undefined ? ` · Maximum ${field.max}` : ''}
              {field.step !== undefined ? ` · Step ${field.step}` : ''}
            </Text>
          )}
          {isDimension && (
            <View style={styles.row}>
              {(() => {
                const limits = dimensionLimits(firstDimension);
                const extent = dimensionExtent(
                  vertical,
                  firstDimension,
                  dimensions.width,
                  dimensions.height
                );
                return Array.from(
                  { length: (limits.max - limits.min) / limits.step + 1 },
                  (_, index) => limits.min + index * limits.step
                ).map((percentage) => {
                  const pixels = dimensionPixels(percentage, extent, firstDimension);
                  return (
                    <Action
                      key={percentage}
                      label={`${percentage}% (${pixels ?? '—'} px)`}
                      colors={colors}
                      disabled={disabled || pixels === null || dirty}
                      onPress={() => {
                        if (pixels !== null) void save(pixels);
                      }}
                    />
                  );
                });
              })()}
            </View>
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
const colorLabels: Record<keyof ThemeOption, string> = {
  fontColor: 'Text',
  backgroundColor: 'Background',
  selectionFontColor: 'Selected text',
  selectionBackgroundColor: 'Selection background',
  hintFuriganaShadowColor: 'Furigana hint shadow',
  hintFuriganaFontColor: 'Furigana hint text',
  tooltipTextFontColor: 'Tooltip text'
};
function ThemeEditor({
  original,
  seed,
  data,
  act,
  busy,
  colors,
  close
}: {
  original: NativeTheme | null;
  seed: ThemeOption;
  data: NativeSettingsState;
  act: Act;
  busy: boolean;
  colors: Colors;
  close(): void;
}) {
  const [name, setName] = useState(original?.id ?? '');
  const [palette, setPalette] = useState(seed);
  const [copyId, setCopyId] = useState(data.themes[0]?.id ?? '');
  return (
    <Card colors={colors}>
      <Text accessibilityRole="header" style={[styles.label, { color: colors.text }]}>
        {original ? 'Edit custom theme' : 'New custom theme'}
      </Text>
      <Text style={{ color: colors.muted }}>
        Theme colors accept #RRGGBB, rgb(…), or rgba(…). Nothing is saved until you choose Save
        theme.
      </Text>
      <DraftInput
        label="Theme name"
        value={name}
        onChange={setName}
        disabled={busy}
        colors={colors}
      />
      <Host
        matchContents
        colorScheme={colors.mode}
        seedColor={colors.seedColor}
        accessibilityLabel="Theme to copy"
      >
        <Picker selectedValue={copyId} enabled={!busy} onValueChange={setCopyId}>
          {data.themes.map((theme) => (
            <Picker.Item key={theme.id} label={theme.label} value={theme.id} />
          ))}
        </Picker>
      </Host>
      <Action
        label="Copy selected theme colors"
        colors={colors}
        disabled={busy}
        onPress={() => {
          const theme = data.themes.find((item) => item.id === copyId);
          if (theme) setPalette({ ...theme.colors });
        }}
      />
      {(Object.keys(colorLabels) as (keyof ThemeOption)[]).map((key) => (
        <View key={key} style={styles.gap}>
          <Text style={{ color: colors.text }}>{colorLabels[key]}</Text>
          <DraftInput
            label={colorLabels[key]}
            value={palette[key]}
            onChange={(value) => setPalette((previous) => ({ ...previous, [key]: value }))}
            disabled={busy}
            colors={colors}
          />
        </View>
      ))}
      <View style={styles.row}>
        <Action
          label="Save theme"
          selected
          colors={colors}
          disabled={busy}
          onPress={() => {
            void act({
              type: 'theme.save',
              name: name.trim(),
              previousName: original?.id ?? null,
              expectedColors: original?.colors ?? null,
              colors: palette
            }).then((saved) => {
              if (saved) close();
            });
          }}
        />
        <Action label="Cancel theme edit" colors={colors} disabled={busy} onPress={close} />
      </View>
    </Card>
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
  const [category, setCategory] = useState<string>('appearance');
  const [query, setQuery] = useState('');
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
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
          Settings
        </Text>
        <Action
          label="Refresh saved settings"
          colors={colors}
          disabled={view.pending || !snapshot.session}
          onPress={() => {
            void sessionRef.current?.refresh();
          }}
        />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={{ color: colors.muted }}>
          Reader preferences are stored by the local reader. Switches and choices save immediately.
          Text and numbers save when you tap Apply.
        </Text>
        <DraftInput label="Search all settings" value={query} onChange={setQuery} colors={colors} />
        <View style={styles.row}>
          {settingCategories.map((item) => (
            <Action
              key={item.id}
              label={item.label}
              selected={category === item.id && !query.trim()}
              colors={colors}
              onPress={() => {
                setCategory(item.id);
                setQuery('');
              }}
            />
          ))}
        </View>
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
                Refresh saved settings to reconcile before making another change. No command will be
                replayed automatically.
              </Text>
            )}
          </Card>
        ) : null}
        {!snapshot.session && (
          <Text style={{ color: colors.muted }}>The local reader is starting…</Text>
        )}
        {query.trim() && data ? (
          <Text accessibilityRole="text" style={{ color: colors.muted }}>
            {fields.length} matching controls · {gates.length} integration notes
          </Text>
        ) : null}
        {data && (category === 'appearance' || category === 'all') && !query.trim() && (
          <Card colors={colors}>
            <Text style={[styles.label, { color: colors.text }]}>Custom themes</Text>
            <View style={styles.row}>
              <Action
                label="Add custom theme"
                colors={colors}
                disabled={busy || !!editor}
                onPress={() => setEditor({ original: null, seed: { ...resolved } })}
              />
              {selectedTheme?.custom && (
                <>
                  <Action
                    label="Edit selected theme"
                    colors={colors}
                    disabled={busy || !!editor}
                    onPress={() =>
                      setEditor({ original: selectedTheme, seed: { ...selectedTheme.colors } })
                    }
                  />
                  <Action
                    label="Delete selected theme"
                    colors={colors}
                    disabled={busy || !!editor}
                    onPress={() =>
                      Alert.alert(
                        `Delete ${selectedTheme.label}?`,
                        'This local custom theme will be removed. The existing Manabi preset will be selected.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => {
                              void act({
                                type: 'theme.delete',
                                name: selectedTheme.id,
                                expectedColors: selectedTheme.colors
                              });
                            }
                          }
                        ]
                      )
                    }
                  />
                </>
              )}
            </View>
          </Card>
        )}
        {editor && data && (
          <ThemeEditor
            original={editor.original}
            seed={editor.seed}
            data={data}
            act={act}
            busy={busy}
            colors={colors}
            close={() => setEditor(null)}
          />
        )}
        {data &&
          fields.map((field) => (
            <FieldEditor
              key={`${ownerKey}:${field.key}`}
              field={field}
              data={data}
              act={act}
              busy={busy}
              colors={colors}
            />
          ))}
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
      </ScrollView>
      <View style={[styles.navigation, { borderColor: colors.border }]}>
        <Action label="Library" colors={colors} onPress={() => router.replace('/manage')} />
        <Action label="Statistics" colors={colors} onPress={() => router.push('/statistics')} />
        <Action label="Accounts" colors={colors} onPress={() => router.push('/connections')} />
      </View>
    </SafeAreaView>
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
  content: { padding: 16, gap: 14 },
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
