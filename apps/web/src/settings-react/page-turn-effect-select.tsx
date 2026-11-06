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
  createPageTurnEffectSelect,
  type PageTurnEffectSelectProps
} from './page-turn-effect-select-controller';
import { pageTurnEffect$ } from '$lib/data/page-turn-preferences';
import { normalizePageTurnEffect } from '$lib/foliate-epub/page-turn-effect';
import { SettingsPageTurnEffect } from '../features/settings/SettingsPageTurnEffect';
export function PageTurnEffectSelect(
  props: Partial<PageTurnEffectSelectProps> &
    ReaderViewProps & {
      children?: React.ReactNode;
      onClose?: () => void;
      slot?: string;
    }
) {
  const latest = useLatest(props);
  const help = React.useId();
  const context = useSettingsContext();
  const c = useReaderController(
    () =>
      createPageTurnEffectSelect(
        props as PageTurnEffectSelectProps,
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
      <div className="react-settings-page-turn-effect-select" style={{ display: 'contents' }}>
        <SettingsPageTurnEffect
          value={c.$pageTurnEffect$}
          accessibilityDescribedBy={help}
          onValueChange={(value) => pageTurnEffect$.next(normalizePageTurnEffect(value))}
        />
        <Dom
          as="p"
          id={help}
          className={['mt-2 text-xs text-muted-foreground'].filter(Boolean).join(' ')}
        >
          {
            ' Paginated EPUBs: slide over the next page, or change pages instantly. Scrolling is unchanged. '
          }
        </Dom>
      </div>
    </SettingsContext.Provider>
  );
}
