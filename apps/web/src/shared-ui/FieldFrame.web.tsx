/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useId, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { StyleSheet } from 'react-native';
import type { FieldFrameProps } from './FieldFrame';
import { UiPresentation } from './Presentation';
export function FieldFrame({
  label,
  accessibilityLabel,
  accessibilityDescribedBy,
  hideLabel,
  children,
  style
}: FieldFrameProps) {
  const frame = useRef<HTMLLabelElement>(null);
  const labelId = useId();
  // Expo's universal Picker does not expose native HTML naming/description
  // props. Apply them only to its real select, within this browser leaf. TextField
  // already owns its input's ARIA props and must not be overwritten here.
  // Run after every committed render so changed props and replaced controls
  // receive current semantics, including removal of a previous override.
  useLayoutEffect(() => {
    const control = frame.current?.querySelector('select');
    if (!control) return;
    if (accessibilityLabel) control.setAttribute('aria-label', accessibilityLabel);
    else control.removeAttribute('aria-label');
    // Name the visible caption alone. An implicit wrapping label also contains
    // the Picker options, which can contaminate exact label lookup.
    if (label && !accessibilityLabel) control.setAttribute('aria-labelledby', labelId);
    else control.removeAttribute('aria-labelledby');
    if (accessibilityDescribedBy)
      control.setAttribute('aria-describedby', accessibilityDescribedBy);
    else control.removeAttribute('aria-describedby');
  });
  // Native HTML association labels the real select/input rendered by Expo UI.
  return (
    <>
      <UiPresentation />
      <label
        ref={frame}
        data-ui-field=""
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          flexWrap: 'nowrap',
          margin: 0,
          gap: 6,
          minWidth: 0,
          color: 'var(--foreground)',
          ...(StyleSheet.flatten(style) as CSSProperties)
        }}
      >
        {label || accessibilityLabel ? (
          <span
            id={labelId}
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
