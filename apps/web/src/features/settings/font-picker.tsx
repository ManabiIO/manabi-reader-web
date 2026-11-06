/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { ChoiceField } from '../../shared-ui/Fields';
import type { FontChoiceOption } from './font-choices';

export interface FontPickerProps {
  options: readonly FontChoiceOption[];
  value: string;
  label: string;
  disabled: boolean;
  onValueChange(value: string): void;
}

/** Native Expo Picker leaf; the common selector admits choices. */
export function FontPicker({ label, ...props }: FontPickerProps) {
  return <ChoiceField {...props} accessibilityLabel={label} />;
}
