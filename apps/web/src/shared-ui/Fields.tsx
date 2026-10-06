/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { Host, Picker } from '@expo/ui';
import { Checkbox, Switch } from './ExpoToggle';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { useUiTheme } from './theme';
import { UiPresentation } from './Presentation';
import { FieldFrame } from './FieldFrame';
function ControlHost({
  children,
  kind,
  compact = false
}: {
  children: ReactNode;
  compact?: boolean;
  kind: 'picker' | 'checkbox' | 'switch';
}) {
  const theme = useUiTheme();
  const semanticVariables =
    Platform.OS === 'web'
      ? ({
          '--expo-ui-background': 'var(--background)',
          '--expo-ui-foreground': 'var(--foreground)',
          '--expo-ui-gray-900': 'var(--foreground)',
          '--expo-ui-gray-500': 'var(--muted-foreground)',
          '--expo-ui-gray-200': 'var(--input)',
          '--expo-ui-gray-300': 'var(--border)',
          '--expo-ui-primary-500': 'var(--primary)',
          '--expo-ui-primary-foreground': 'var(--primary-foreground)'
        } as ViewStyle)
      : undefined;
  return (
    <>
      <UiPresentation />
      <View
        {...(Platform.OS === 'web'
          ? {
              dataSet:
                kind === 'picker'
                  ? { uiControl: 'picker', compact: String(compact) }
                  : { uiToggle: kind }
            }
          : {})}
        style={{ minWidth: 0 }}
      >
        <Host
          matchContents={{ vertical: true }}
          // The enclosing web screen owns insets. Android's separate keyboard
          // inset contract still requires qualification; do not send an ignored prop.
          ignoreSafeArea={Platform.OS === 'web' ? 'all' : undefined}
          colorScheme={theme.mode}
          seedColor={theme.seedColor}
          style={[{ minHeight: 44, width: '100%' }, semanticVariables]}
        >
          {children}
        </Host>
      </View>
    </>
  );
}
export interface ChoiceFieldProps<T extends string | number> {
  label?: string;
  value: T;
  onValueChange(value: T): void;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** Browser element IDs describing the select. */
  accessibilityDescribedBy?: string;
  compact?: boolean;
}
export function ChoiceField<T extends string | number>({
  label,
  value,
  onValueChange,
  options,
  disabled,
  testID,
  style,
  accessibilityLabel,
  accessibilityDescribedBy,
  compact
}: ChoiceFieldProps<T>) {
  return (
    <FieldFrame
      label={label}
      testID={Platform.OS === 'android' ? testID : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityDescribedBy={accessibilityDescribedBy}
      hideLabel={compact}
      style={style}
    >
      <ControlHost kind="picker" compact={compact}>
        <Picker
          selectedValue={value}
          onValueChange={onValueChange}
          enabled={!disabled}
          // SDK 57's Android implementation drops this prop; the RN field
          // wrapper owns that ID. This does not establish TalkBack labeling.
          testID={Platform.OS === 'web' ? testID : undefined}
        >
          {options.map((option) => (
            <Picker.Item key={String(option.value)} value={option.value} label={option.label} />
          ))}
        </Picker>
      </ControlHost>
    </FieldFrame>
  );
}
export interface ToggleFieldProps {
  label: string;
  value: boolean;
  onValueChange(value: boolean): void;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}
export function CheckboxField({ style, ...props }: ToggleFieldProps) {
  return (
    <View style={style}>
      <ControlHost kind="checkbox">
        <Checkbox {...props} />
      </ControlHost>
    </View>
  );
}
export function SwitchField({ style, ...props }: ToggleFieldProps) {
  return (
    <View style={style}>
      <ControlHost kind="switch">
        <Switch {...props} />
      </ControlHost>
    </View>
  );
}
