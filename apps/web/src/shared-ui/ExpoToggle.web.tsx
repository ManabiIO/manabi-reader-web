/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useLayoutEffect, useRef, type ComponentProps } from 'react';
import { Switch as UniversalSwitch } from '@expo/ui';
export { Checkbox } from '@expo/ui';

/** Expo's universal Switch has a visible label but no separate accessible-name
 * prop. Name its real input when a screen uses a shorter visible state label. */
export function Switch({
  accessibilityLabel,
  ...props
}: ComponentProps<typeof UniversalSwitch> & { accessibilityLabel?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const input = root.current?.querySelector('input');
    if (!input) return;
    if (accessibilityLabel) input.setAttribute('aria-label', accessibilityLabel);
    else input.removeAttribute('aria-label');
  });
  return (
    <div ref={root} style={{ display: 'contents' }}>
      <UniversalSwitch {...props} />
    </div>
  );
}
