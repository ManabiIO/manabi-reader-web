/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { useReaderController } from '../reader-react/controller';
import { Dom, DialogTemplate, useLatest, type ReaderViewProps } from './primitives';
import {
  createSettingsCustomTheme,
  type SettingsCustomThemeProps
} from './settings-custom-theme-controller';
import { SettingsThemeEditor } from '../features/settings/SettingsThemeEditor';

export function SettingsCustomTheme(
  props: Partial<SettingsCustomThemeProps> &
    ReaderViewProps & { children?: ReactNode; onClose?: () => void; slot?: string }
) {
  const latest = useLatest(props);
  const owner = useReaderController(() => createSettingsCustomTheme(props), props);
  if (!owner) return null;
  return (
    <SettingsThemeEditor
      initialPalette={owner.initialPalette}
      previousName={owner.previousName}
      activeTheme={owner.activeTheme}
      options={owner.options}
      existingNames={owner.existingNames}
      onSave={owner.save}
      onClose={() => {
        latest.current.events?.close?.({ detail: undefined });
        latest.current.onClose?.();
      }}
      renderLayout={(body, actions) => (
        <DialogTemplate>
          <Dom as="span" slot="header">
            {owner.previousName ? 'Edit custom theme' : 'New custom theme'}
          </Dom>
          <Dom as="div" slot="content">
            {body}
          </Dom>
          <Dom as="div" slot="footer" style={{ width: '100%' }}>
            {actions}
          </Dom>
        </DialogTemplate>
      )}
    />
  );
}
