/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useRef } from 'react';
import { Host, TextInput, useNativeState, type TextInputRef } from '@expo/ui';
import { useUiTheme } from '../../shared-ui/theme';

export interface ThemeEditorInputProps {
  label: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  placeholder?: string;
  error?: string;
}

/** Bounded Expo native text leaf. Drafts and validation live in the shared editor. */
export function ThemeEditorInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  error
}: ThemeEditorInputProps) {
  const theme = useUiTheme();
  const nativeValue = useNativeState(value);
  const input = useRef<TextInputRef>(null);
  useEffect(() => {
    if (error) input.current?.focus();
  }, [error]);
  useEffect(() => {
    nativeValue.value = value;
  }, [value, nativeValue]);
  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme={theme.mode}
      seedColor={theme.seedColor}
      accessibilityLabel={label}
      style={{ minHeight: 48, width: '100%' }}
    >
      <TextInput
        ref={input}
        value={nativeValue}
        editable={!disabled}
        placeholder={placeholder ?? label}
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
