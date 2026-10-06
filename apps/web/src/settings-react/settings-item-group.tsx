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
  createSettingsItemGroup,
  type SettingsItemGroupProps
} from './settings-item-group-controller';

import { SettingsFieldGroup } from '../features/settings/SettingsFieldGroup';
import * as settingsFieldLayout from '../features/settings/field-layout.web';

export function SettingsItemGroup(
  props: Partial<SettingsItemGroupProps> &
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
      createSettingsItemGroup(
        props as SettingsItemGroupProps,
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
      <div className="react-settings-settings-item-group" style={{ display: 'contents' }}>
        <SettingsFieldGroup
          layout={settingsFieldLayout}
          settingId={c.settingId || c.title}
          category={c.category}
          title={c.title}
          headingId={c.headingId}
          visible={c.visible}
          showHeading={c.showHeading}
          emphasizeHeading={c.applyHeaderClasses}
          description={c.tooltip}
          wide={[
            'appearance',
            'selected-theme',
            'storage-sources',
            'reading-goals',
            'font-defaults'
          ].includes(c.settingId)}
          header={slotContent(props.children, 'header')}
        >
          {slotContent(props.children, undefined)}
        </SettingsFieldGroup>
      </div>
    </SettingsContext.Provider>
  );
}
