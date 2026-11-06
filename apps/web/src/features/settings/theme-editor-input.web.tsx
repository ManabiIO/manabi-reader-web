/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useId, useRef } from 'react';
import type { ThemeEditorInputProps } from './theme-editor-input';

export function ThemeEditorInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  error
}: ThemeEditorInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  useEffect(() => {
    input.current?.setCustomValidity(error ?? '');
    if (error) input.current?.focus();
  }, [error]);
  return (
    <>
      <input
        ref={input}
        type="text"
        aria-label={label}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          minWidth: 0,
          minHeight: 44,
          border: '1px solid var(--input)',
          borderRadius: 10,
          padding: '8px 10px',
          background: 'var(--background)',
          color: 'var(--foreground)',
          font: 'inherit'
        }}
      />
      {error ? (
        <span
          id={errorId}
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            overflow: 'hidden',
            clipPath: 'inset(50%)'
          }}
        >
          {error}
        </span>
      ) : null}
    </>
  );
}
