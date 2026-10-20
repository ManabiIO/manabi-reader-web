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
  createBackgroundSettings,
  type BackgroundSettingsProps
} from './background-settings-controller';
import { removeBackground, removeBackgrounds } from '../lib/appearance/backgrounds';
import { SettingsBackgroundImages } from '../features/settings/SettingsBackgroundImages';
import { SwitchField } from '../shared-ui/Fields';

export function BackgroundSettings(
  props: Partial<BackgroundSettingsProps> &
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
      createBackgroundSettings(
        props as BackgroundSettingsProps,
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
      <div className="react-settings-background-settings" style={{ display: 'contents' }}>
        <SettingsBackgroundImages
          target={c.target}
          label={c.label}
          fade={c.opacity}
          slots={c.modes.map((mode) => ({
            mode: mode.value,
            present: !!c.state[mode.value].url || !!c.state[mode.value].error,
            uri: c.state[mode.value].url,
            name: c.state[mode.value].name,
            busy: c.state[mode.value].busy,
            error: c.state[mode.value].error,
            input: (
              <input
                id={`background-${c.target}-${mode.value}`}
                type="file"
                className="sr-only"
                aria-label={`Choose ${mode.value} ${c.label.toLowerCase()}`}
                accept="image/png,image/jpeg,image/webp"
                disabled={c.state[mode.value].busy}
                onChange={(event) =>
                  void c.select(mode.value, {
                    currentTarget: event.currentTarget
                  } as unknown as Event)
                }
              />
            )
          }))}
          onChoose={(mode) => document.getElementById(`background-${c.target}-${mode}`)?.click()}
          onRemove={(mode) => {
            void removeBackground(c.target, mode).catch(() => undefined);
          }}
          onRemoveBoth={() => {
            void removeBackgrounds(c.target).catch(() => undefined);
          }}
        >
          <Dom as="div" className="fade-toggle">
            <SwitchField
              label={`Fade ${c.label.toLowerCase()}`}
              value={c.$options.fade}
              onValueChange={(fade) => c.options.next({ ...c.$options, fade })}
            />
          </Dom>
          <Dom
            as="label"
            htmlFor={'fade-' + String(c.target ?? '')}
            className={['fade-label'].filter(Boolean).join(' ')}
          >
            {'Fade amount '}
            <Dom as="output" htmlFor={'fade-' + String(c.target ?? '')}>
              {c.$options.amount}
              {'%'}
            </Dom>
          </Dom>
          <Dom
            as="input"
            id={'fade-' + String(c.target ?? '')}
            type={'range'}
            min={'0'}
            max={'100'}
            step={'1'}
            value={c.$options.amount}
            disabled={!c.$options.fade}
            events={{
              input: (event: Event & { currentTarget: HTMLInputElement }) =>
                c.options.next({ ...c.$options, amount: event.currentTarget.valueAsNumber })
            }}
          />
          <Dom as="p" className={['fade-note'].filter(Boolean).join(' ')}>
            {'Light fades toward white; dark fades toward black.'}
          </Dom>
        </SettingsBackgroundImages>
      </div>
    </SettingsContext.Provider>
  );
}
