/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { TextInput, type StyleProp, type ViewStyle } from 'react-native';
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
  min: _min,
  max: _max,
  step: _step,
  ...props
}: TextFieldProps) {
  const { colors } = useUiTheme();
  return (
    <FieldFrame label={label} style={style}>
      <TextInput
        {...props}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={props.accessibilityLabel ?? label}
        editable={editable}
        keyboardType={type === 'number' ? 'decimal-pad' : 'default'}
        placeholder={props.placeholder ?? (type === 'date' ? 'YYYY-MM-DD' : undefined)}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          minHeight: 44,
          minWidth: 0,
          paddingVertical: 8,
          paddingHorizontal: 10,
          borderWidth: 1,
          borderColor: colors.input,
          borderRadius: 10,
          backgroundColor: colors.background,
          color: colors.foreground,
          fontSize: 16,
          opacity: editable ? 1 : 0.5
        }}
      />
    </FieldFrame>
  );
}
