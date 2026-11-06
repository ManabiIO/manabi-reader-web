/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { ChoiceField } from '../../shared-ui/Fields';
import {
  pageTurnEffectOptions,
  type PageTurnEffect
} from '../../lib/foliate-epub/page-turn-effect';

/** The owner retains persistence, expected-value checks and account lifetime. */
export function SettingsPageTurnEffect({
  value,
  onValueChange,
  disabled,
  showLabel = true,
  accessibilityDescribedBy
}: {
  value: string;
  onValueChange(value: PageTurnEffect): void;
  disabled?: boolean;
  showLabel?: boolean;
  accessibilityDescribedBy?: string;
}) {
  const known = pageTurnEffectOptions.some((option) => option.value === value);
  const options = known
    ? pageTurnEffectOptions
    : [
        { value, label: `Unavailable saved option (${value || 'empty'})` },
        ...pageTurnEffectOptions
      ];
  return (
    <ChoiceField
      label={showLabel ? 'Page turn effect' : undefined}
      accessibilityLabel="Page turn effect"
      accessibilityDescribedBy={accessibilityDescribedBy}
      testID="settings-page-turn-effect"
      value={value}
      options={options}
      disabled={disabled}
      onValueChange={(next) => {
        if (!disabled && next !== value && (next === 'slide' || next === 'none'))
          onValueChange(next);
      }}
    />
  );
}
