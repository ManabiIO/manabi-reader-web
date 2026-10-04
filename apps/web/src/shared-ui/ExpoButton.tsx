/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Button, OutlinedButton, TextButton, Text } from '@expo/ui/jetpack-compose';
import type { UiTheme } from './theme';
import { useUiTheme } from './theme';

/** Material's tonal seed creates chromatic controls even from black. Explicit
 * semantic colors keep the real Compose buttons neutral in both appearances. */
export function ExpoButton({
  label,
  onPress,
  disabled = false,
  variant = 'outlined',
  theme
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  variant?: 'filled' | 'outlined' | 'text';
  theme?: UiTheme;
}) {
  const provided = useUiTheme();
  const c = (theme ?? provided).colors;
  const Component =
    variant === 'filled' ? Button : variant === 'text' ? TextButton : OutlinedButton;
  return (
    <Component
      enabled={!disabled}
      onClick={disabled ? undefined : onPress}
      colors={{
        containerColor: variant === 'filled' ? c.primary : 'transparent',
        contentColor: variant === 'filled' ? c.primaryForeground : c.foreground,
        disabledContainerColor: variant === 'filled' ? c.secondary : 'transparent',
        disabledContentColor: c.mutedForeground
      }}
    >
      <Text
        color={
          disabled ? c.mutedForeground : variant === 'filled' ? c.primaryForeground : c.foreground
        }
      >
        {label}
      </Text>
    </Component>
  );
}
