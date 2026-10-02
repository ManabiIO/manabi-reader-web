/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from './controller';
import {
  Dom,
  ReaderScope,
  Icon,
  Button,
  CloseButton,
  Sheet,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createAppearance, type AppearanceProps } from './appearance-controller';
import { appearance$, theme$ } from '$lib/appearance/state';
import { themeNames, themeForMode } from '$lib/data/theme-option';
import { fontFamilyGroupOne$, lineHeight$, viewMode$ } from '$lib/data/store';
import { ViewMode } from '$lib/data/view-mode';
import { PageTurnEffectSelect } from './extras';

export function ReaderAppearance(props: Partial<AppearanceProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createAppearance(props as AppearanceProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-appearance">
      <Sheet.Root
        open={c.open}
        bindings={{
          open: (value) => {
            c.open = value;
          }
        }}
      >
        <Sheet.Content
          side={'bottom'}
          overlayProps={{ onclick: () => (c.open = false) }}
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (c.returnFocus?.isConnected) {
              c.returnFocus.focus({ preventScroll: true });
              return;
            }
            const controls = document.querySelector<HTMLButtonElement>(
              'button[data-reader-controls]'
            );
            const trigger =
              controls?.getAttribute('aria-expanded') === 'true'
                ? document.querySelector<HTMLButtonElement>('[aria-label="Themes & Settings"]')
                : controls;
            trigger?.focus();
          }}
          className={[
            'reader-appearance writing-horizontal-tb mx-auto max-h-[min(90dvh,48rem)] max-w-md gap-[20px] overflow-y-auto rounded-t-[24px] p-[20px] pb-[max(20px,env(safe-area-inset-bottom))] sm:mb-5 sm:mr-5 sm:rounded-[24px]'
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <Sheet.Header
            className={['flex flex-row items-center justify-between gap-[12px] p-0']
              .filter(Boolean)
              .join(' ')}
          >
            <Sheet.Title className={['text-lg font-semibold'].filter(Boolean).join(' ')}>
              {'Themes & Settings'}
            </Sheet.Title>
            <CloseButton
              aria-label={'Close reading appearance'}
              onClick={() => (c.open = false)}
            ></CloseButton>
          </Sheet.Header>
          <Sheet.Description className={['sr-only'].filter(Boolean).join(' ')}>
            {c.description}
          </Sheet.Description>
          <Dom
            as="div"
            role={'group'}
            aria-label={'Text size'}
            className={['size-controls'].filter(Boolean).join(' ')}
          >
            <Button
              variant={'ghost'}
              aria-label={'Decrease text size'}
              disabled={c.$fontSize$ <= 8}
              onClick={() => c.changeSize(-1)}
              className={['min-h-12 text-lg'].filter(Boolean).join(' ')}
            >
              {'A'}
            </Button>
            <Dom
              as="output"
              aria-live={'polite'}
              className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}
            >
              {c.$fontSize$}
              {' px'}
            </Dom>
            <Button
              variant={'ghost'}
              aria-label={'Increase text size'}
              disabled={c.$fontSize$ >= 72}
              onClick={() => c.changeSize(1)}
              className={['min-h-12 text-2xl'].filter(Boolean).join(' ')}
            >
              {'A'}
            </Button>
          </Dom>
          <Dom
            as="div"
            role={'group'}
            aria-label={'Reading appearance mode'}
            className={['modes'].filter(Boolean).join(' ')}
          >
            {(c.modes ?? []).map((mode, index0) => (
              <React.Fragment key={mode}>
                <Button
                  variant={c.$appearance$ === mode ? 'secondary' : 'ghost'}
                  shape={'rounded'}
                  aria-pressed={c.$appearance$ === mode}
                  onClick={() => appearance$.next(mode)}
                  className={['min-h-11 capitalize'].filter(Boolean).join(' ')}
                >
                  {mode}
                </Button>
              </React.Fragment>
            ))}
          </Dom>
          <Dom
            as="div"
            role={'group'}
            aria-label={'Reading theme'}
            className={['theme-grid'].filter(Boolean).join(' ')}
          >
            {(c.themes ?? []).map((id, index1) => (
              <React.Fragment key={id}>
                {(() => {
                  const palette = themeForMode(id, c.$resolvedMode$ ?? 'light');
                  return (
                    <>
                      <Dom
                        as="button"
                        type={'button'}
                        aria-pressed={c.$theme$ === id}
                        aria-label={`${themeNames[id]} theme`}
                        onClick={() => theme$.next(id)}
                        className={['theme-tile'].filter(Boolean).join(' ')}
                        style={{ background: palette.backgroundColor, color: palette.fontColor }}
                      >
                        <Icon
                          name="TextAa"
                          aria-hidden={'true'}
                          className={['size-7'].filter(Boolean).join(' ')}
                        ></Icon>
                        <Dom as="span">{themeNames[id]}</Dom>
                        {c.$theme$ === id ? (
                          <>
                            <Icon
                              name="Check"
                              aria-hidden={'true'}
                              className={['absolute right-2 top-2 size-3']
                                .filter(Boolean)
                                .join(' ')}
                            ></Icon>
                          </>
                        ) : null}
                      </Dom>
                    </>
                  );
                })()}
              </React.Fragment>
            ))}
          </Dom>
          <Dom as="p" className={['-mt-3 text-xs text-muted-foreground'].filter(Boolean).join(' ')}>
            {' Theme and appearance apply throughout Manabi Reader. '}
          </Dom>
          <Dom as="label" className={['setting-row'].filter(Boolean).join(' ')}>
            <Dom as="span">{'Font'}</Dom>
            <Dom
              as="select"
              aria-label={'Reading font'}
              value={c.currentFont}
              onChange={(event) => fontFamilyGroupOne$.next(event.currentTarget.value)}
            >
              {(c.availableFonts ?? []).map((font, index2) => (
                <React.Fragment key={font}>
                  <Dom as="option" value={font}>
                    {font}
                  </Dom>
                </React.Fragment>
              ))}
            </Dom>
          </Dom>
          <Dom as="label" className={['setting-row'].filter(Boolean).join(' ')}>
            <Dom as="span">{'Line spacing'}</Dom>
            <Dom
              as="select"
              aria-label={'Reading line spacing'}
              value={c.$lineHeight$}
              onChange={(event) => lineHeight$.next(Number(event.currentTarget.value))}
            >
              {(
                [...new Set([1.4, 1.65, 1.9, 2.2, c.$lineHeight$])].sort((a, b) => a - b) ?? []
              ).map((value, index3) => (
                <React.Fragment key={value}>
                  <Dom as="option" value={value}>
                    {value}
                    {'×'}
                  </Dom>
                </React.Fragment>
              ))}
            </Dom>
          </Dom>
          {c.showLayout ? (
            <>
              <Dom
                as="div"
                role={'group'}
                aria-label={'Reading layout'}
                className={['modes'].filter(Boolean).join(' ')}
              >
                <Button
                  variant={c.$viewMode$ === ViewMode.Paginated ? 'secondary' : 'ghost'}
                  shape={'rounded'}
                  aria-pressed={c.$viewMode$ === ViewMode.Paginated}
                  onClick={() => viewMode$.next(ViewMode.Paginated)}
                  className={['min-h-11'].filter(Boolean).join(' ')}
                >
                  {'Pages'}
                </Button>
                <Button
                  variant={c.$viewMode$ === ViewMode.Continuous ? 'secondary' : 'ghost'}
                  shape={'rounded'}
                  aria-pressed={c.$viewMode$ === ViewMode.Continuous}
                  onClick={() => viewMode$.next(ViewMode.Continuous)}
                  className={['min-h-11'].filter(Boolean).join(' ')}
                >
                  {'Scroll'}
                </Button>
              </Dom>
              {c.$viewMode$ === ViewMode.Paginated ? (
                <>
                  <Dom as="div">
                    <PageTurnEffectSelect></PageTurnEffectSelect>
                  </Dom>
                </>
              ) : null}
            </>
          ) : null}
          <Button
            variant={'outline'}
            onClick={() => {
              c.open = false;
              c.dispatch('settingsClick');
            }}
            className={['min-h-11'].filter(Boolean).join(' ')}
          >
            {'All Settings…'}
          </Button>
        </Sheet.Content>
      </Sheet.Root>
    </ReaderScope>
  );
}
