/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import { Dom, useLatest, useReaderBindings, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import {
  createAppearanceSettings,
  type AppearanceSettingsProps
} from './appearance-settings-controller';
import { appearance$ } from '../lib/appearance/state';

import { BackgroundSettings } from './background-settings';
import { SettingsChoices } from '../features/settings/SettingsChoices';
export function AppearanceSettings(
  props: Partial<AppearanceSettingsProps> &
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
      createAppearanceSettings(
        props as AppearanceSettingsProps,
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
      <div className="react-settings-appearance-settings" style={{ display: 'contents' }}>
        <Dom as="section" aria-labelledby={'appearance-heading'}>
          <Dom as="h2" id={'appearance-heading'}>
            {'Color mode'}
          </Dom>
          <SettingsChoices
            label="Appearance mode"
            value={c.$appearance$}
            options={c.modes}
            onValueChange={(value) => appearance$.next(value)}
          />
          <Dom as="p" className={['description'].filter(Boolean).join(' ')}>
            {
              ' System follows your device’s light or dark appearance. Your theme applies to the whole app. '
            }
          </Dom>
          <Dom as="details">
            <Dom as="summary">{'Background images'}</Dom>
            <Dom as="p" className={['description'].filter(Boolean).join(' ')}>
              {
                ' Choose separate light and dark images for your library and reader. PNG, JPEG, or WebP, up to 8 MB. Images fill the screen without stretching. '
              }
            </Dom>
            <Dom as="p" className="description">
              Images stay in this browser and aren’t synced or included in book backups. Keep your
              originals to use them on another device.
            </Dom>
            <Dom as="div" className={['backgrounds'].filter(Boolean).join(' ')}>
              {(c.backgrounds ?? []).map((background, _index1) => (
                <React.Fragment key={background.target}>
                  <BackgroundSettings {...background}></BackgroundSettings>
                </React.Fragment>
              ))}
            </Dom>
          </Dom>
        </Dom>
      </div>
    </SettingsContext.Provider>
  );
}
