/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { DimensionFrameProps } from './dimension-frame';
export function DimensionFrame({ label, children }: DimensionFrameProps) {
  return (
    <fieldset
      className="dimension-presets"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, padding: 12 }}
    >
      <legend style={{ maxWidth: '100%', padding: '0 4px', fontSize: '0.875rem', fontWeight: 600 }}>
        {label}
      </legend>
      {children}
    </fieldset>
  );
}
