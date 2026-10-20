/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { View } from 'react-native';
import { ActionButton } from '../../shared-ui/ActionButton';
import { FieldFrame } from '../../shared-ui/FieldFrame';
import { UiText } from '../../shared-ui/Typography';
import { useUiTheme } from '../../shared-ui/theme';
import { SettingsChoices } from './SettingsChoices';
import { FontList, FontListItem } from './font-list';

export interface StoredFontEntry {
  key: string;
  name: string;
  fileName: string;
  available: boolean;
  selected?: boolean;
}
export type FontManagerView = 'Stored' | 'Add';
export interface SettingsFontManagerProps {
  description: string;
  fonts: readonly StoredFontEntry[];
  view: FontManagerView;
  onViewChange(view: FontManagerView): void;
  checking: boolean;
  available: boolean;
  busy: boolean;
  error?: string;
  recoveryHint?: string;
  needsRefresh?: boolean;
  refresh?: { label: string; onPress(): void };
  onSelect(font: StoredFontEntry): void;
  onRemove(font: StoredFontEntry): void;
  children: ReactNode;
}

/** Shared catalog and navigation. Entries are a projection only: owners retain
 * exact cache identities, native catalog tokens and every mutation lifetime. */
export function SettingsFontManager({
  description,
  fonts,
  view,
  onViewChange,
  checking,
  available,
  busy,
  error,
  recoveryHint,
  needsRefresh = false,
  refresh,
  onSelect,
  onRemove,
  children
}: SettingsFontManagerProps) {
  const { colors } = useUiTheme();
  const disabled = busy || checking || !available || needsRefresh;
  return (
    <View accessibilityState={{ busy: busy || checking }} style={{ minWidth: 0, gap: 16 }}>
      <UiText style={{ color: colors.mutedForeground, fontSize: 14 }}>{description}</UiText>
      <SettingsChoices<FontManagerView>
        label="Custom font views"
        value={view}
        options={[
          { value: 'Stored', label: 'Stored fonts' },
          { value: 'Add', label: 'Add font' }
        ]}
        disabled={disabled}
        onValueChange={onViewChange}
      />
      {error ? (
        <UiText accessibilityRole="alert" style={{ color: colors.destructive, fontSize: 14 }}>
          {error}
        </UiText>
      ) : null}
      {recoveryHint ? (
        <UiText style={{ color: colors.mutedForeground, fontSize: 14 }}>{recoveryHint}</UiText>
      ) : null}
      {refresh ? (
        <ActionButton
          variant="outline"
          style={{ minHeight: 44, alignSelf: 'flex-start' }}
          disabled={busy || checking}
          onPress={refresh.onPress}
        >
          {refresh.label}
        </ActionButton>
      ) : null}
      {checking ? (
        <UiText role="status" style={{ color: colors.mutedForeground, fontSize: 14 }}>
          Checking font storage…
        </UiText>
      ) : available ? (
        view === 'Stored' ? (
          <>
            {fonts.length ? (
              <FontList>
                {fonts.map((font) => (
                  <FontListItem key={font.key}>
                    <View
                      style={{
                        minWidth: 0,
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 12,
                        paddingVertical: 12,
                        borderBottomWidth: 1,
                        borderColor: colors.border
                      }}
                    >
                      <View style={{ minWidth: 0, flex: 1, flexBasis: 160, gap: 4 }}>
                        <UiText style={{ fontWeight: '500' }}>{font.name}</UiText>
                        <UiText style={{ color: colors.mutedForeground, fontSize: 12 }}>
                          {font.fileName}
                        </UiText>
                        <UiText style={{ color: colors.mutedForeground, fontSize: 12 }}>
                          {font.available
                            ? `Stored on this device${font.selected ? ' · Selected' : ''}`
                            : 'File unavailable. Remove this entry, then add the file again.'}
                        </UiText>
                      </View>
                      <View
                        style={{
                          minWidth: 0,
                          maxWidth: '100%',
                          flexDirection: 'row',
                          flexWrap: 'wrap',
                          gap: 8
                        }}
                      >
                        <ActionButton
                          variant="outline"
                          style={{ minHeight: 44 }}
                          disabled={disabled || !font.available}
                          accessibilityLabel={`Use ${font.name}`}
                          onPress={() => {
                            if (!disabled && font.available) onSelect(font);
                          }}
                        >
                          Use font
                        </ActionButton>
                        <ActionButton
                          variant="destructive"
                          style={{ minHeight: 44 }}
                          disabled={disabled}
                          accessibilityLabel={`Remove ${font.name}`}
                          onPress={() => {
                            if (!disabled) onRemove(font);
                          }}
                        >
                          Remove
                        </ActionButton>
                      </View>
                    </View>
                  </FontListItem>
                ))}
              </FontList>
            ) : (
              <View style={{ borderRadius: 16, backgroundColor: colors.muted, padding: 16 }}>
                <UiText style={{ color: colors.mutedForeground, fontSize: 14 }}>
                  No custom fonts yet. Add a font file to make it available here.
                </UiText>
              </View>
            )}
            {busy ? (
              <UiText role="status" style={{ color: colors.mutedForeground, fontSize: 14 }}>
                Updating fonts…
              </UiText>
            ) : null}
          </>
        ) : (
          children
        )
      ) : null}
    </View>
  );
}

/** The form composition is common. Web supplies its native form/file input and
 * explicit submit; Android supplies its Expo name input and picker/save action. */
export function SettingsFontImportFields({
  nameInput,
  fileInput,
  help,
  error,
  busy,
  submit
}: {
  nameInput: ReactNode;
  fileInput?: ReactNode;
  help: string;
  error?: string;
  busy: boolean;
  submit: ReactNode;
}) {
  const { colors } = useUiTheme();
  return (
    <View style={{ gap: 16, minWidth: 0 }}>
      <FieldFrame label="Font name">{nameInput}</FieldFrame>
      {fileInput ? <FieldFrame label="Font file">{fileInput}</FieldFrame> : null}
      <UiText style={{ color: colors.mutedForeground, fontSize: 14 }}>{help}</UiText>
      {error ? (
        <UiText accessibilityRole="alert" style={{ color: colors.destructive, fontSize: 14 }}>
          {error}
        </UiText>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 12,
          minWidth: 0
        }}
      >
        {busy ? (
          <UiText role="status" style={{ color: colors.mutedForeground, fontSize: 14 }}>
            Saving font…
          </UiText>
        ) : null}
        {submit}
      </View>
    </View>
  );
}
