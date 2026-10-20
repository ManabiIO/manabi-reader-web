/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useRef } from 'react';
import type { DimensionSliderProps } from './dimension-slider';

/** Native input/change events distinguish preview from release or keyboard
 * completion; React's onChange for range inputs instead fires during dragging. */
export function DimensionSlider(props: DimensionSliderProps) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const element = input.current!;
    const preview = () => {
      if (!latest.current.disabled) latest.current.onPreview(element.valueAsNumber);
    };
    const commit = () => latest.current.onCommit();
    const cancel = () => latest.current.onCancel();
    element.addEventListener('input', preview);
    element.addEventListener('change', commit);
    element.addEventListener('blur', cancel);
    element.addEventListener('pointercancel', cancel);
    return () => {
      element.removeEventListener('input', preview);
      element.removeEventListener('change', commit);
      element.removeEventListener('blur', cancel);
      element.removeEventListener('pointercancel', cancel);
      cancel();
    };
  }, []);
  return (
    <input
      ref={input}
      type="range"
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      readOnly
      disabled={props.disabled}
      aria-label={props.label}
      aria-valuetext={props.valueText}
      style={{
        display: 'block',
        minHeight: 44,
        width: '100%',
        minWidth: 0,
        accentColor: 'var(--primary)'
      }}
    />
  );
}
