/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import {
  Button,
  DialogTemplate,
  useLatest,
  useReaderBindings,
  Slot,
  type ReaderViewProps
} from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import {
  createSettingsUserFontDialog,
  type SettingsUserFontDialogProps
} from './settings-user-font-dialog-controller';

import { SettingsUserFontAdd } from './settings-user-font-add';
import { SettingsFontManager } from '../features/settings/SettingsFontManager';
export function SettingsUserFontDialog(
  props: Partial<SettingsUserFontDialogProps> &
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
      createSettingsUserFontDialog(
        props as SettingsUserFontDialogProps,
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
      <div className="react-settings-settings-user-font-dialog" style={{ display: 'contents' }}>
        <DialogTemplate>
          <Slot name="header">{'Custom fonts'}</Slot>
          <div slot="content" className="font-manager min-w-0">
            <SettingsFontManager
              description="Manage fonts stored in this browser. Choose a font to use it for this text style."
              fonts={c.$userFonts$.map((font) => ({
                key: font.path,
                name: font.name,
                fileName: font.fileName,
                available: c.availablePaths.has(font.path),
                selected: c.selectedFont === font.name
              }))}
              view={c.currentTab}
              onViewChange={(view) => c.controller.changed((c.currentTab = view))}
              checking={!c.cacheLoaded}
              available={!!c.fontCache}
              busy={c.isLoading}
              error={c.error}
              recoveryHint={
                c.cacheLoaded && !c.fontCache
                  ? 'Your saved font list has not been changed.'
                  : undefined
              }
              refresh={
                c.cacheLoaded && !c.fontCache
                  ? { label: 'Retry font storage', onPress: c.loadCache }
                  : undefined
              }
              onSelect={(entry) => {
                void c.selectFont({ path: entry.key, name: entry.name, fileName: entry.fileName });
              }}
              onRemove={(entry) => {
                void c.removeFont(entry.key);
              }}
            >
              {c.fontCache && (
                <SettingsUserFontAdd
                  fontCache={c.fontCache}
                  isLoading={c.isLoading}
                  events={{
                    saved: () => {
                      c.controller.changed((c.currentTab = 'Stored'));
                      void c.loadCache();
                    }
                  }}
                  bindings={{
                    isLoading: (value: typeof c.isLoading) => {
                      c.controller.changed((c.isLoading = value));
                    }
                  }}
                />
              )}
            </SettingsFontManager>
          </div>
          <Slot name="footer">
            <Button
              variant={'ghost'}
              onClick={() => c.dispatch('close')}
              className={['min-h-11'].filter(Boolean).join(' ')}
            >
              {'Done'}
            </Button>
          </Slot>
        </DialogTemplate>
      </div>
    </SettingsContext.Provider>
  );
}
