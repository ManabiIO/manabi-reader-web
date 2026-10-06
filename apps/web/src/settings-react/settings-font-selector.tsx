/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import { ActionMenu, Menu, useLatest, useReaderBindings, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import {
  createSettingsFontSelector,
  type SettingsFontSelectorProps
} from './settings-font-selector-controller';

export function SettingsFontSelector(
  props: Partial<SettingsFontSelectorProps> &
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
      createSettingsFontSelector(
        props as SettingsFontSelectorProps,
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
      <div className="react-settings-settings-font-selector" style={{ display: 'contents' }}>
        <ActionMenu label={'Choose font'} title={c.label}>
          <Menu.Label>{'Available fonts'}</Menu.Label>
          <Menu.RadioGroup
            value={c.selectedFont ?? c.fontValue}
            onValueChange={(value: string) => c.controller.changed((c.fontValue = value))}
          >
            {(c.availableFonts ?? []).map((font, _index0) => (
              <React.Fragment key={font}>
                <Menu.RadioItem value={font}>{font}</Menu.RadioItem>
              </React.Fragment>
            ))}
          </Menu.RadioGroup>
        </ActionMenu>
      </div>
    </SettingsContext.Provider>
  );
}
