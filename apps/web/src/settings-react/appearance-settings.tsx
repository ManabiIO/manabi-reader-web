/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import { Dom, Button, useLatest, useReaderBindings, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import {
  createAppearanceSettings,
  type AppearanceSettingsProps
} from './appearance-settings-controller';
import { appearance$ } from '../lib/appearance/state';

import { BackgroundSettings } from './background-settings';
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
          <Dom
            as="div"
            role={'group'}
            aria-label={'Appearance mode'}
            className={['modes'].filter(Boolean).join(' ')}
          >
            {(c.modes ?? []).map((mode, _index0) => (
              <React.Fragment key={mode.value}>
                <Button
                  variant={c.$appearance$ === mode.value ? 'secondary' : 'ghost'}
                  shape={'rounded'}
                  aria-pressed={c.$appearance$ === mode.value}
                  onClick={() => appearance$.next(mode.value)}
                >
                  {mode.label}
                </Button>
              </React.Fragment>
            ))}
          </Dom>
          <Dom as="p" className={['description'].filter(Boolean).join(' ')}>
            {
              ' System follows your device’s light or dark appearance. Your theme applies to the whole app. '
            }
          </Dom>
          <Dom as="details">
            <Dom as="summary">{'Background images'}</Dom>
            <Dom as="p" className={['description'].filter(Boolean).join(' ')}>
              {
                ' Book browser and reader images can each be different in Light and Dark mode. Images fill the screen without stretching and are saved only in this browser, never uploaded or included in account settings sync. PNG, JPEG, or WebP, up to 8 MB. Remove either image independently or remove both for a surface. A mode without an image uses the plain theme background. '
              }
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
