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
export function PageTurnEffectSelect(
  props: Partial<PageTurnEffectSelectProps> &
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
        <Dom
          as="label"
          className={['flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm']
            .filter(Boolean)
            .join(' ')}
        >
          <Dom as="span">{'Page turn effect'}</Dom>
          <Dom
            as="select"
            aria-label={'Page turn effect'}
            value={c.$pageTurnEffect$}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              pageTurnEffect$.next(normalizePageTurnEffect(event.currentTarget.value))
            }
            className={[
              'min-h-11 rounded-lg border border-border bg-background px-3 text-foreground'
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <Dom as="option" value={'slide'}>
              {'Slide'}
            </Dom>
            <Dom as="option" value={'none'}>
              {'None'}
            </Dom>
          </Dom>
        </Dom>
        <Dom as="p" className={['mt-2 text-xs text-muted-foreground'].filter(Boolean).join(' ')}>
          {
            ' Paginated EPUBs: slide over the next page, or change pages instantly. Scrolling is unchanged. '
          }
        </Dom>
      </div>
    </SettingsContext.Provider>
  );
}
