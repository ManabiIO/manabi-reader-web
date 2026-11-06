/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useLayoutEffect, useReducer } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Host, TextInput, useNativeState } from '@expo/ui';
import { fillMaxWidth, semantics } from '@expo/ui/jetpack-compose/modifiers';
import { FieldFrame } from './FieldFrame';
import { useUiTheme } from './theme';
export interface TextFieldProps {
  label?: string;
  value: string;
  onChangeText(value: string): void;
  placeholder?: string;
  type?: 'text' | 'number' | 'date' | 'search';
  editable?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  autoFocus?: boolean;
  onSubmitEditing?(): void;
  onBlur?(): void;
  min?: string | number;
  max?: string | number;
  step?: string | number;
}
export function TextField({
  label,
  value,
  onChangeText,
  type = 'text',
  editable = true,
  style,
  accessibilityLabel,
  min: _min,
  max: _max,
  step: _step,
  ...props
}: TextFieldProps) {
  const { colors, mode, seedColor } = useUiTheme();
  const nativeValue = useNativeState(value);
  const [, reconcileEdit] = useReducer((revision: number) => revision + 1, 0);
  // Expo's observable is the native edit buffer; the owner still controls the
  // field. Reconcile every owner render, including a rejected edit or reset to
  // the previous value, without replacing the focused native input.
  useLayoutEffect(() => {
    if (nativeValue.value !== value) nativeValue.value = value;
  });
  const name = accessibilityLabel ?? label;
  return (
    <FieldFrame label={label} style={style}>
      <Host
        matchContents={{ vertical: true }}
        colorScheme={mode}
        seedColor={seedColor}
        style={{ minHeight: 44, width: '100%' }}
      >
        <TextInput
          {...props}
          value={nativeValue}
          onChangeText={(next) => {
            if (editable) onChangeText(next);
            // Native observable edits do not render React. Reconcile even when
            // the owner rejects this edit and keeps its existing value.
            reconcileEdit();
          }}
          editable={editable}
          keyboardType={type === 'number' ? 'decimal-pad' : 'default'}
          returnKeyType={type === 'search' ? 'search' : undefined}
          placeholder={props.placeholder ?? (type === 'date' ? 'YYYY-MM-DD' : undefined)}
          autoCapitalize="none"
          autoCorrect={false}
          modifiers={[fillMaxWidth(), ...(name ? [semantics({ contentDescription: name })] : [])]}
          style={{
            paddingVertical: 12,
            paddingHorizontal: 10,
            borderWidth: 1,
            borderColor: colors.input,
            borderRadius: 10,
            backgroundColor: colors.background,
            opacity: editable ? 1 : 0.5
          }}
          textStyle={{ color: colors.foreground, fontSize: 16 }}
          placeholderTextColor={colors.mutedForeground}
        />
      </Host>
    </FieldFrame>
  );
}
