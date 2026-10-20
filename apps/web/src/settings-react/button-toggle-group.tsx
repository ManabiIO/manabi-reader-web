/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import { useLatest, useReaderBindings, slotContent, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import {
  createButtonToggleGroup,
  type ButtonToggleGroupProps
} from './button-toggle-group-controller';

import { availableThemes } from '$lib/data/theme-option';
import { SettingsSwitch } from '../features/settings/SettingsSwitch';
import { SettingsChoices } from '../features/settings/SettingsChoices';
import { SettingsThemeChoices } from '../features/settings/SettingsThemeChoices';
export function ButtonToggleGroup(
  props: Partial<ButtonToggleGroupProps> &
    ReaderViewProps & {
      children?: React.ReactNode;
      onClose?: () => void;
      slot?: string;
    }
) {
  const latest = useLatest(props);
  const context = useSettingsContext();
  const c = useReaderController(
    () =>
      createButtonToggleGroup(
        props as ButtonToggleGroupProps,
        (name, detail) => {
          latest.current.events?.[name]?.({ detail });
          if (name === 'close') latest.current.onClose?.();
        },
        context
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <SettingsContext.Provider value={context}>
      <div className="react-settings-button-toggle-group" style={{ display: 'contents' }}>
        {c.isBoolean ? (
          <SettingsSwitch
            label={c.fieldName()}
            value={c.selectedOptionId === true}
            onValueChange={(value) => c.controller.changed((c.selectedOptionId = value))}
          />
        ) : (
          <div className={c.invertColors ? 'legacy-invert' : undefined}>
            {c.options.some((option) => option.showIcons) ? (
              <SettingsThemeChoices
                label={c.fieldName()}
                value={c.selectedOptionId}
                options={c.options.map((option) => ({
                  value: option.id,
                  label: option.text,
                  custom: !!option.showIcons && !availableThemes.has(option.id),
                  colors: option.style
                    ? {
                        foreground: option.style.color,
                        background: option.style['background-color']
                      }
                    : undefined
                }))}
                onValueChange={(value) => c.controller.changed((c.selectedOptionId = value))}
                onEdit={(value) => c.dispatch('edit', value)}
                onDelete={(value) => c.dispatch('delete', value)}
              >
                {slotContent(props.children, undefined)}
              </SettingsThemeChoices>
            ) : (
              <SettingsChoices
                label={c.fieldName()}
                value={c.selectedOptionId}
                options={c.options.map((option) => ({ value: option.id, label: option.text }))}
                onValueChange={(value) => c.controller.changed((c.selectedOptionId = value))}
              >
                {slotContent(props.children, undefined)}
              </SettingsChoices>
            )}
          </div>
        )}
      </div>
    </SettingsContext.Provider>
  );
}
