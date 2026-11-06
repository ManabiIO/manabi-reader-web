/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { SettingsFontImportFields } from '../features/settings/SettingsFontManager';
import { useReaderController } from '../reader-react/controller';
import {
  Dom,
  Button,
  Input,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import {
  createSettingsUserFontAdd,
  type SettingsUserFontAddProps
} from './settings-user-font-add-controller';

export function SettingsUserFontAdd(
  props: Partial<SettingsUserFontAddProps> &
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
      createSettingsUserFontAdd(
        props as SettingsUserFontAddProps,
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
      <div className="react-settings-settings-user-font-add" style={{ display: 'contents' }}>
        <Dom
          as="form"
          aria-busy={c.isLoading}
          className={['min-w-0 space-y-4'].filter(Boolean).join(' ')}
          events={{
            submit: (event: Event & { currentTarget: HTMLFormElement }) => {
              event.preventDefault();
              Reflect.apply(c.addFont, undefined, [event]);
            }
          }}
        >
          <SettingsFontImportFields
            busy={c.isLoading}
            error={c.currentError}
            help="WOFF2, WOFF, TTF, or OTF. The file is saved only in this browser; it is not uploaded to your account."
            nameInput={
              <Input
                id={`${c.formId}-name`}
                aria-label="Font name"
                type="text"
                required
                maxLength={200}
                disabled={c.isLoading}
                value={c.fontName}
                onInput={() => c.controller.changed((c.currentError = ''))}
                onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                  if (
                    event.key === 'Enter' &&
                    (event.nativeEvent.isComposing || event.keyCode === 229)
                  )
                    event.preventDefault();
                }}
                bindings={{
                  value: (value: typeof c.fontName) => {
                    c.controller.changed((c.fontName = value));
                  }
                }}
              />
            }
            fileInput={
              <Input
                id={`${c.formId}-file`}
                aria-label="Font file"
                type="file"
                required
                disabled={c.isLoading}
                accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
                ref={c.fileElement}
                onChange={c.handleFileChange}
                bindings={{
                  ref: (value: typeof c.fileElement) => {
                    c.controller.changed((c.fileElement = value));
                  }
                }}
              />
            }
            submit={
              <Button type="submit" disabled={c.isLoading} className="min-h-11">
                Save font
              </Button>
            }
          />
        </Dom>
      </div>
    </SettingsContext.Provider>
  );
}
