/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { TextFieldProps } from './TextField';
import { FieldFrame } from './FieldFrame';
export function TextField({
  label,
  value,
  onChangeText,
  type = 'text',
  editable = true,
  testID,
  accessibilityLabel,
  style,
  onSubmitEditing,
  ...props
}: TextFieldProps) {
  return (
    <FieldFrame label={label} style={style}>
      <input
        {...props}
        type={type}
        value={value}
        onChange={(event) => onChangeText(event.target.value)}
        disabled={!editable}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSubmitEditing?.();
        }}
        aria-label={accessibilityLabel ?? label}
        data-testid={testID}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          minHeight: 44,
          minWidth: 0,
          padding: '8px 10px',
          border: '1px solid var(--input)',
          borderRadius: 10,
          background: 'var(--background)',
          color: 'var(--foreground)',
          font: 'inherit',
          fontSize: '1rem',
          opacity: editable ? 1 : 0.5
        }}
      />
    </FieldFrame>
  );
}
