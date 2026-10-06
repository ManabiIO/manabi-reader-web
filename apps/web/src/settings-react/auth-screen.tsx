/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import { Dom, AppIcon, useLatest, useReaderBindings, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createAuthScreen, type AuthScreenProps } from './auth-screen-controller';

const faSpinner = 'faSpinner';
export function AuthScreen(
  props: Partial<AuthScreenProps> &
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
      createAuthScreen(
        props as AuthScreenProps,
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
      <div className="react-settings-auth-screen" style={{ display: 'contents' }}>
        <Dom
          as="div"
          className={['fixed inset-0 flex h-full w-full items-center justify-center text-7xl']
            .filter(Boolean)
            .join(' ')}
        >
          <>
            {c.errorMessage ? (
              <p role="alert" className="max-w-lg p-6 text-base">
                {c.errorMessage}
              </p>
            ) : (
              <AppIcon icon={faSpinner} spin={true} />
            )}
          </>
        </Dom>
      </div>
    </SettingsContext.Provider>
  );
}
