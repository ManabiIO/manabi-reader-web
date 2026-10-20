/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { parseColor, type ThemeOption } from '../../lib/data/theme-option';
import { ActionButton } from '../../shared-ui/ActionButton';
import { ChoiceField } from '../../shared-ui/Fields';
import { UiText } from '../../shared-ui/Typography';
import { useUiTheme } from '../../shared-ui/theme';
import { ThemeEditorInput } from './theme-editor-input';
import { ThemeColorInput } from './theme-color-input';
import {
  themeDraftPalette,
  themeEditorFields,
  themeNameError,
  themePaletteError,
  type ThemeCopyOption
} from './theme-editor';

export interface SettingsThemeEditorProps {
  initialPalette: ThemeOption;
  previousName?: string;
  activeTheme: string;
  options: readonly ThemeCopyOption[];
  existingNames: readonly string[];
  busy?: boolean;
  error?: string;
  onSave(name: string, palette: ThemeOption): boolean | string | Promise<boolean | string>;
  onClose(): void;
  renderLayout?(body: ReactNode, actions: ReactNode): ReactNode;
}

/** One visit-local draft and editor composition. Owners still authorize and save;
 * native session/expected-palette guards and web storage never enter this module. */
export function SettingsThemeEditor({
  initialPalette,
  previousName = '',
  activeTheme,
  options,
  existingNames,
  busy = false,
  error,
  onSave,
  onClose,
  renderLayout
}: SettingsThemeEditorProps) {
  const { colors } = useUiTheme();
  const [name, setName] = useState(previousName);
  const [palette, setPalette] = useState(() => themeDraftPalette(initialPalette));
  const [copyId, setCopyId] = useState(activeTheme);
  const [nameError, setNameError] = useState('');
  const [draftError, setDraftError] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const disabled = busy || saving;
  const copy = options.find((option) => option.id === copyId);
  const copyOptions = options.map(({ id, label }) => ({ value: id, label }));
  if (!copy) copyOptions.unshift({ value: copyId, label: `Unavailable theme: ${copyId}` });
  const save = async () => {
    if (disabled || inFlight.current) return;
    const trimmed = name.trim();
    setName(trimmed);
    const invalidName = themeNameError(trimmed, previousName, existingNames);
    const invalidPalette = themePaletteError(palette);
    setNameError(invalidName);
    setDraftError(invalidPalette);
    if (invalidName || invalidPalette) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const result = await onSave(trimmed, { ...palette });
      if (!mounted.current) return;
      if (result === true) onClose();
      else if (typeof result === 'string') setDraftError(result);
    } catch (reason) {
      if (!mounted.current) return;
      setDraftError(
        reason instanceof Error ? reason.message : 'Could not save this theme. Try again.'
      );
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const body = (
    <View style={{ gap: 16, minWidth: 0 }}>
      <UiText style={{ color: colors.mutedForeground, fontSize: 14 }}>
        Colors stay in this draft until you choose Save.
        {Platform.OS === 'android' ? ' Enter #RRGGBB, rgb(…), or rgba(…) colors.' : ''}
      </UiText>
      <View style={{ gap: 6, minWidth: 0 }}>
        <UiText>Theme name</UiText>
        <ThemeEditorInput
          label="Theme name"
          placeholder="Theme Name"
          value={name}
          disabled={disabled}
          error={nameError}
          onChange={(next) => {
            setName(next);
            setNameError('');
            setDraftError('');
          }}
        />
      </View>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'flex-end',
          minWidth: 0
        }}
      >
        <ChoiceField<string>
          label="Copy colors from theme"
          accessibilityLabel="Copy colors from theme"
          value={copyId}
          options={copyOptions}
          onValueChange={setCopyId}
          disabled={disabled}
          style={{ flex: 1, flexBasis: 200, maxWidth: '100%' }}
        />
        <ActionButton
          variant="outline"
          style={{ minHeight: 44 }}
          disabled={disabled || !copy}
          onPress={() => {
            if (!disabled && copy) {
              setPalette(themeDraftPalette(copy.colors));
              setDraftError('');
            }
          }}
        >
          Copy
        </ActionButton>
      </View>
      {themeEditorFields.map(({ key, label }) => (
        <View
          key={key}
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            minWidth: 0
          }}
        >
          <UiText style={{ flex: 1, flexBasis: 180, minWidth: 0 }}>{label}</UiText>
          <View style={{ flex: 1, flexBasis: 220, minWidth: 0, maxWidth: '100%' }}>
            <ThemeColorInput
              label={label}
              value={palette[key]}
              disabled={disabled}
              onChange={(value) => {
                setPalette((previous) => ({ ...previous, [key]: value }));
                setDraftError('');
              }}
            />
          </View>
        </View>
      ))}
      <View
        {...(Platform.OS === 'web' ? { dataSet: { themePreview: 'true' } } : {})}
        accessible={false}
        aria-hidden
        style={{
          minHeight: 56,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 12,
          borderWidth: 1,
          borderRadius: 12,
          borderColor: colors.border,
          backgroundColor: parseColor(palette.backgroundColor)
            ? palette.backgroundColor
            : colors.background
        }}
      >
        <UiText
          style={{
            fontSize: 24,
            color: parseColor(palette.fontColor) ? palette.fontColor : colors.foreground
          }}
        >
          ぁあ
        </UiText>
      </View>
      {nameError || draftError || error ? (
        <UiText accessibilityRole="alert" style={{ color: colors.destructive }}>
          {nameError || draftError || error}
        </UiText>
      ) : null}
    </View>
  );
  const actions = (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: 12,
        width: '100%'
      }}
    >
      <ActionButton variant="ghost" style={{ minHeight: 44 }} disabled={disabled} onPress={onClose}>
        Cancel
      </ActionButton>
      <ActionButton
        variant="secondary"
        style={{ minHeight: 44 }}
        disabled={disabled}
        onPress={() => {
          void save();
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </ActionButton>
    </View>
  );
  return renderLayout ? (
    renderLayout(body, actions)
  ) : (
    <View style={{ gap: 20, minWidth: 0 }}>
      {body}
      {actions}
    </View>
  );
}
