/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { ActionButton } from '../../shared-ui/ActionButton';
import { UiText } from '../../shared-ui/Typography';
import { useUiTheme } from '../../shared-ui/theme';

export interface SettingsChoicesProps<T extends string | number> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onValueChange(value: T): void;
  disabled?: boolean;
  children?: ReactNode;
}

/** Short, visible choices wrap with the available pane and text size.
 * Selection and persistence belong to the caller, including unknown saved IDs.
 * Long catalogs and theme editors keep their specialized controls. */
export function SettingsChoices<T extends string | number>({
  label,
  value,
  options,
  onValueChange,
  disabled,
  children
}: SettingsChoicesProps<T>) {
  const { colors } = useUiTheme();
  const known = options.some((option) => option.value === value);
  return (
    <View style={{ minWidth: 0, gap: 8 }}>
      {!known && (
        <UiText style={{ color: colors.mutedForeground, fontSize: 14 }}>
          {`Saved value: ${String(value)}`}
        </UiText>
      )}
      <View
        {...(Platform.OS === 'web' ? { role: 'group', accessibilityLabel: label } : {})}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, minWidth: 0 }}
      >
        {options.map((option) => (
          <ActionButton
            key={`${typeof option.value}:${option.value}`}
            title={String(option.value)}
            variant={option.value === value ? 'secondary' : 'outline'}
            selected={option.value === value}
            disabled={disabled}
            accessibilityLabel={Platform.OS === 'web' ? undefined : `${label}: ${option.label}`}
            style={{
              minHeight: 44,
              borderWidth: 2,
              borderColor: option.value === value ? colors.primary : colors.border
            }}
            onPress={() => {
              if (!disabled && option.value !== value) onValueChange(option.value);
            }}
          >
            {option.label}
          </ActionButton>
        ))}
        {children}
      </View>
    </View>
  );
}
