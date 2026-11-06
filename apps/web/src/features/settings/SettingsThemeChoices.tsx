/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { View } from 'react-native';
import { ActionButton } from '../../shared-ui/ActionButton';
import { SettingsChoices, type SettingsChoiceOption } from './SettingsChoices';

export interface SettingsThemeOption extends SettingsChoiceOption<string> {
  custom: boolean;
}

export function AddThemeButton({ disabled, onPress }: { disabled?: boolean; onPress(): void }) {
  return (
    <ActionButton
      variant="outline"
      size="lg"
      shape="rounded"
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 44, borderRadius: 8 }}
    >
      Add custom theme
    </ActionButton>
  );
}

/** The chooser shares presentation only. Callers retain editor and confirmation
 * lifetimes, original palettes, expected values and their existing save ports. */
export function SettingsThemeChoices({
  label = 'Theme',
  value,
  options,
  onValueChange,
  onEdit,
  onDelete,
  disabled,
  actionsDisabled,
  children
}: {
  label?: string;
  value: string;
  options: readonly SettingsThemeOption[];
  onValueChange(value: string): void;
  onEdit(value: string): void;
  onDelete(value: string): void;
  disabled?: boolean;
  actionsDisabled?: boolean;
  children?: ReactNode;
}) {
  const managementDisabled = disabled || actionsDisabled;
  return (
    <SettingsChoices
      label={label}
      value={value}
      options={options}
      disabled={disabled}
      onValueChange={onValueChange}
      renderAccessory={(id) => {
        const option = options.find((item) => item.value === id);
        if (!option?.custom || id !== value) return null;
        return (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: '100%' }}>
            <ActionButton
              variant="ghost"
              disabled={managementDisabled}
              accessibilityLabel={`Edit ${option.label} theme`}
              style={{ minHeight: 44 }}
              onPress={() => {
                if (!managementDisabled) onEdit(id);
              }}
            >
              Edit
            </ActionButton>
            <ActionButton
              variant="ghost"
              disabled={managementDisabled}
              accessibilityLabel={`Delete ${option.label} theme`}
              style={{ minHeight: 44 }}
              onPress={() => {
                if (!managementDisabled) onDelete(id);
              }}
            >
              Delete
            </ActionButton>
          </View>
        );
      }}
    >
      {children}
    </SettingsChoices>
  );
}
