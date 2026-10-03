/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useState, type ComponentProps } from 'react';
import { Dom } from './dom';

/** Keep the editable draft until the browser commits a number on blur/Enter.
 * A controlled number with only a native change listener is restored by React
 * on every input event, before that listener can see the user's new value. */
export function AudioNumberInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'type' | 'onChange'> & {
  value: number;
  onCommit(event: Event): void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <Dom
      {...props}
      as="input"
      type="number"
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      events={{
        change: (event) => {
          onCommit(event);
          // Validation may restore or clamp the DOM value at commit time.
          setDraft((event.currentTarget as HTMLInputElement).value);
        }
      }}
    />
  );
}
