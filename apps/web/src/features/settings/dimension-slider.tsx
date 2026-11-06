/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Host, Slider } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, semantics } from '@expo/ui/jetpack-compose/modifiers';
import { useUiTheme } from '../../shared-ui/theme';

export interface DimensionSliderProps {
  label: string;
  value: number;
  valueText: string;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onPreview(value: number): void;
  onCommit(): void;
  onCancel(): void;
}

/** Universal Slider omits the completion callback. This bounded Compose leaf
 * supplies it; shared draft admission still decides whether a save is allowed. */
export function DimensionSlider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onPreview,
  onCommit
}: DimensionSliderProps) {
  const theme = useUiTheme();
  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme={theme.mode}
      style={{ width: '100%', minHeight: 44 }}
    >
      <Slider
        value={value}
        min={min}
        max={max}
        steps={Math.max(0, Math.round((max - min) / step) - 1)}
        enabled={!disabled}
        colors={{
          thumbColor: theme.colors.primary,
          activeTrackColor: theme.colors.primary,
          inactiveTrackColor: theme.colors.muted
        }}
        modifiers={[fillMaxWidth(), semantics({ contentDescription: label })]}
        onValueChange={(percentage) => {
          if (!disabled) onPreview(Math.round((percentage - min) / step) * step + min);
        }}
        onValueChangeFinished={() => {
          if (!disabled) onCommit();
        }}
      />
    </Host>
  );
}
