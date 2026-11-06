/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { ThemeEditorInput } from './theme-editor-input';

export interface ThemeColorInputProps {
  label: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
}

/** Expo UI has no universal color well. Android retains editable hex/rgb/rgba. */
export function ThemeColorInput(props: ThemeColorInputProps) {
  return <ThemeEditorInput {...props} label={`${props.label} color`} />;
}
