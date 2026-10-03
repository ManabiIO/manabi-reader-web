/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import { Dom, Input, useLatest, useReaderBindings, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import {
  createSettingsCustomThemeInput,
  type SettingsCustomThemeInputProps
} from './settings-custom-theme-input-controller';

export function SettingsCustomThemeInput(
  props: Partial<SettingsCustomThemeInputProps> &
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
      createSettingsCustomThemeInput(
        props as SettingsCustomThemeInputProps,
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
      <div className="react-settings-settings-custom-theme-input" style={{ display: 'contents' }}>
        <Dom as="span">{c.label}</Dom>
        <Dom
          as="input"
          aria-label={`${c.label} color`}
          type={'color'}
          value={c.values.hexExpression}
          className={['size-11 rounded-xl border border-border bg-background p-1']
            .filter(Boolean)
            .join(' ')}
          events={{ change: c.handleColorChange }}
        />
        <Input
          aria-label={`${c.label} opacity`}
          type={'number'}
          step={'0.1'}
          min={'0'}
          max={'1'}
          value={c.values.alphaValue}
          onChange={c.handleAlphaChange}
          className={['min-h-11'].filter(Boolean).join(' ')}
        ></Input>
      </div>
    </SettingsContext.Provider>
  );
}
