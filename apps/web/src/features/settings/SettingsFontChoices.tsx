/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { FontPicker } from './font-picker';
import { fontChoices } from './font-choices';

export function SettingsFontChoices({
  available,
  value,
  effectiveValue = value,
  label,
  disabled = false,
  onValueChange
}: {
  available: readonly string[];
  value: string;
  effectiveValue?: string;
  label: string;
  disabled?: boolean;
  onValueChange(value: string): void;
}) {
  const choices = fontChoices(available, value, effectiveValue);
  return (
    <FontPicker
      options={choices.options}
      value={choices.value}
      label={label}
      disabled={disabled}
      onValueChange={(next) => {
        const chosen = choices.choose(next, disabled);
        if (chosen !== null) onValueChange(chosen);
      }}
    />
  );
}
