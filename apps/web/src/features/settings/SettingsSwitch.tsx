/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { SwitchField, type ToggleFieldProps } from '../../shared-ui/Fields';

/** The enclosing card already names the setting; keep its state label concise. */
export function SettingsSwitch(props: ToggleFieldProps) {
  return (
    <SwitchField {...props} accessibilityLabel={props.label} label={props.value ? 'On' : 'Off'} />
  );
}
