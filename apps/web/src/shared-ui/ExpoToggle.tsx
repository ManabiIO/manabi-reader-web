/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ComponentProps } from 'react';
import type { Switch as UniversalSwitch, Checkbox as UniversalCheckbox } from '@expo/ui';
import {
  Switch as ComposeSwitch,
  Checkbox as ComposeCheckbox,
  Row,
  Text
} from '@expo/ui/jetpack-compose';
import {
  clickable,
  semantics,
  testID as testIDModifier,
  weight
} from '@expo/ui/jetpack-compose/modifiers';
import { useUiTheme } from './theme';

export function Switch({
  value,
  onValueChange,
  label,
  disabled,
  testID,
  modifiers
}: ComponentProps<typeof UniversalSwitch>) {
  const { colors: c } = useUiTheme();
  const toggle = (
    <ComposeSwitch
      value={value}
      enabled={!disabled}
      onCheckedChange={disabled ? undefined : onValueChange}
      modifiers={[
        ...(modifiers ?? []),
        ...(testID ? [testIDModifier(testID)] : []),
        ...(label != null ? [semantics({ contentDescription: label })] : [])
      ]}
      colors={{
        checkedTrackColor: c.primary,
        checkedThumbColor: c.primaryForeground,
        checkedBorderColor: c.primary,
        uncheckedTrackColor: c.secondary,
        uncheckedThumbColor: c.mutedForeground,
        uncheckedBorderColor: c.mutedForeground,
        disabledCheckedTrackColor: c.secondary,
        disabledCheckedThumbColor: c.mutedForeground,
        disabledUncheckedTrackColor: c.secondary,
        disabledUncheckedThumbColor: c.mutedForeground
      }}
    />
  );
  return label == null ? (
    toggle
  ) : (
    <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 8 }}>
      <Text color={c.foreground} modifiers={[weight(1)]}>
        {label}
      </Text>
      {toggle}
    </Row>
  );
}

export function Checkbox({
  value,
  onValueChange,
  label,
  disabled,
  testID,
  modifiers
}: ComponentProps<typeof UniversalCheckbox>) {
  const { colors: c } = useUiTheme();
  const toggle = (
    <ComposeCheckbox
      value={value}
      enabled={!disabled}
      onCheckedChange={disabled ? undefined : onValueChange}
      modifiers={[
        ...(modifiers ?? []),
        ...(testID ? [testIDModifier(testID)] : []),
        ...(label != null ? [semantics({ contentDescription: label })] : [])
      ]}
      colors={{
        checkedColor: c.primary,
        checkmarkColor: c.primaryForeground,
        uncheckedColor: c.mutedForeground,
        disabledCheckedColor: c.mutedForeground,
        disabledUncheckedColor: c.mutedForeground
      }}
    />
  );
  return label == null ? (
    toggle
  ) : (
    <Row
      verticalAlignment="center"
      horizontalArrangement={{ spacedBy: 8 }}
      modifiers={[clickable(() => !disabled && onValueChange(!value))]}
    >
      {toggle}
      <Text color={c.foreground}>{label}</Text>
    </Row>
  );
}
