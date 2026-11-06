/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, View } from 'react-native';
import { ActionButton } from '../../shared-ui/ActionButton';
import { UiText } from '../../shared-ui/Typography';
import { useUiTheme } from '../../shared-ui/theme';
import { createDimensionEditor } from './dimension-editor';
import { useDimensionViewport } from './dimension-viewport';
import { DimensionFrame } from './dimension-frame';
import { DimensionSlider } from './dimension-slider';

export interface SettingsDimensionEditorProps {
  value: number;
  vertical: boolean;
  first: boolean;
  disabled?: boolean;
  onValueChange(value: number): void;
}
/** One pixel-size editor. Owners retain save/expected-value/session authority. */
export function SettingsDimensionEditor({
  value,
  vertical,
  first,
  disabled = false,
  onValueChange
}: SettingsDimensionEditorProps) {
  const { width, height } = useDimensionViewport();
  const [editor] = useState(() =>
    createDimensionEditor({ value, vertical, first, width, height, disabled })
  );
  useLayoutEffect(() => {
    editor.configure({ value, vertical, first, width, height, disabled });
  }, [editor, value, vertical, first, width, height, disabled]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      editor.cancel();
    };
  }, [editor]);
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const { colors } = useUiTheme();
  const save = (next: number | null) => {
    if (mounted.current && !disabled && next !== null) onValueChange(next);
  };
  const suffix = first ? ' per side' : '';
  return (
    <DimensionFrame label={state.label}>
      <UiText style={{ color: colors.mutedForeground, fontSize: 14 }}>
        Current: <UiText style={{ fontSize: 14, fontWeight: '600' }}>{state.currentValue}</UiText>
      </UiText>
      <View style={{ gap: 4, minWidth: 0 }}>
        <UiText style={{ fontSize: 14, fontWeight: '500' }}>Quick size</UiText>
        <UiText style={{ color: colors.mutedForeground, fontSize: 12 }}>
          {state.percentage}% of the window{first ? ', split between both sides' : ''}
          {state.pixels === null ? '' : ` · ${state.pixels} px${suffix}`}
        </UiText>
        <DimensionSlider
          label={`Quick size for ${state.label.toLowerCase()}`}
          value={state.percentage}
          valueText={`${state.percentage}%${state.pixels === null ? '' : `, ${state.pixels} pixels${suffix}`}`}
          {...state.limits}
          disabled={disabled || !state.extent}
          onPreview={editor.preview}
          onCancel={editor.cancel}
          onCommit={() => save(editor.commit())}
        />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, minWidth: 0 }}>
        {[first ? 25 : 75, 50].map((percentage) => (
          <ActionButton
            key={percentage}
            variant="outline"
            accessibilityLabel={
              Platform.OS === 'web' ? undefined : `${state.label}: ${percentage}%`
            }
            style={{ minHeight: 44 }}
            disabled={disabled || !state.extent}
            onPress={() => save(editor.choose(percentage))}
          >
            {`${percentage}%`}
          </ActionButton>
        ))}
        {!first ? (
          <ActionButton
            variant="ghost"
            accessibilityLabel={
              Platform.OS === 'web' ? undefined : `Automatic ${state.label.toLowerCase()}`
            }
            style={{ minHeight: 44 }}
            disabled={disabled}
            onPress={() => save(editor.automatic())}
          >
            Automatic
          </ActionButton>
        ) : null}
      </View>
      <UiText style={{ color: colors.mutedForeground, fontSize: 12 }}>
        Choose a size to save it in pixels. Opening this panel or resizing the window does not
        change your setting.
      </UiText>
    </DimensionFrame>
  );
}
