/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { parseColor } from '../../lib/data/theme-option';
import { colorWithAlpha } from './theme-editor';
import type { ThemeColorInputProps } from './theme-color-input';

/** Native HTML color well and numeric alpha are confined to this browser leaf. */
export function ThemeColorInput({ label, value, onChange, disabled }: ThemeColorInputProps) {
  const [r, g, b, a] = parseColor(value)!;
  const hex =
    '#' + [r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('');
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <input
        aria-label={`${label} color`}
        type="color"
        value={hex}
        disabled={disabled}
        onChange={(event) => onChange(colorWithAlpha(event.target.value, a))}
        style={{
          width: 44,
          height: 44,
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 4,
          background: 'var(--background)'
        }}
      />
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          minWidth: 0,
          flex: 1
        }}
      >
        <span style={{ fontSize: '0.875rem' }}>Opacity</span>
        <input
          aria-label={`${label} opacity`}
          type="number"
          min="0"
          max="1"
          step="0.1"
          value={a}
          disabled={disabled}
          onChange={(event) =>
            onChange(colorWithAlpha(value, event.target.value ? Number(event.target.value) : NaN))
          }
          style={{
            boxSizing: 'border-box',
            flex: 1,
            width: '5em',
            minWidth: 64,
            maxWidth: '100%',
            minHeight: 44,
            border: '1px solid var(--input)',
            borderRadius: 10,
            padding: '8px 10px',
            background: 'var(--background)',
            color: 'var(--foreground)',
            font: 'inherit'
          }}
        />
      </label>
    </div>
  );
}
