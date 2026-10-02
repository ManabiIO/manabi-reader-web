/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { CSSProperties } from 'react';
import { StyleSheet } from 'react-native';
import type { FieldFrameProps } from './FieldFrame';
import { UiPresentation } from './Presentation';
export function FieldFrame({
  label,
  accessibilityLabel,
  hideLabel,
  children,
  style
}: FieldFrameProps) {
  // Native HTML association labels the real select/input rendered by Expo UI.
  return (
    <>
      <UiPresentation />
      <label
        data-ui-field=""
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          minWidth: 0,
          color: 'var(--foreground)',
          ...(StyleSheet.flatten(style) as CSSProperties)
        }}
      >
        {label || accessibilityLabel ? (
          <span
            style={
              hideLabel || !label
                ? {
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    padding: 0,
                    overflow: 'hidden',
                    clipPath: 'inset(50%)',
                    whiteSpace: 'nowrap'
                  }
                : { fontSize: '0.875rem' }
            }
          >
            {label ?? accessibilityLabel}
          </span>
        ) : null}
        {children}
      </label>
    </>
  );
}
