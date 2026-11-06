/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useLayoutEffect, useReducer } from 'react';
import { Host, TextInput, useNativeState } from '@expo/ui';
import { fillMaxWidth, semantics } from '@expo/ui/jetpack-compose/modifiers';
import { Platform } from 'react-native';
import { FieldFrame } from './FieldFrame';
import { useUiTheme } from './theme';

/** Universal secure/multiline entry. Constrained HTML date/number forms use TextField. */
export function TextEntry({
  label,
  value,
  onChangeText,
  editable = true,
  secure = false,
  multiline = false,
  maxLength = 1024
}: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  editable?: boolean;
  secure?: boolean;
  multiline?: boolean;
  maxLength?: number;
}) {
  const { colors, mode, seedColor } = useUiTheme();
  const nativeValue = useNativeState(value);
  const [, reconcile] = useReducer((revision: number) => revision + 1, 0);
  useLayoutEffect(() => {
    if (nativeValue.value !== value) nativeValue.value = value;
  });
  return (
    <FieldFrame label={label} universalInput>
      <Host
        matchContents={{ vertical: true }}
        ignoreSafeArea={Platform.OS === 'web' ? 'all' : undefined}
        colorScheme={mode}
        seedColor={seedColor}
        style={{ minHeight: multiline ? 112 : 44, width: '100%' }}
      >
        <TextInput
          value={nativeValue}
          editable={editable}
          secureTextEntry={secure}
          multiline={multiline && !secure}
          numberOfLines={multiline && !secure ? 4 : 1}
          maxLength={maxLength}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(next) => {
            if (editable) onChangeText(next);
            reconcile();
          }}
          modifiers={[fillMaxWidth(), semantics({ contentDescription: label })]}
          style={{
            width: '100%',
            padding: 12,
            borderWidth: 1,
            borderColor: colors.input,
            borderRadius: 10,
            backgroundColor: colors.background,
            opacity: editable ? 1 : 0.5
          }}
          textStyle={{ color: colors.foreground, fontSize: 16 }}
        />
      </Host>
    </FieldFrame>
  );
}
