/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import {
  Dom,
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
          <Dom
            as="div"
            slot={'content'}
            aria-busy={c.isLoading || !c.cacheLoaded}
            className={['font-manager min-w-0 space-y-4'].filter(Boolean).join(' ')}
          >
            <Dom as="p" className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}>
              {
                ' Manage fonts stored in this browser. Choose a font to use it for this text style. '
              }
            </Dom>
            <Dom
              as="div"
              role={'group'}
              aria-label={'Custom font views'}
              className={['section-navigation'].filter(Boolean).join(' ')}
            >
              {['Stored', 'Add'].map((tab, _index0) => (
                <React.Fragment key={tab}>
                  <Button
                    variant={'ghost'}
                    shape={'rounded'}
                    data-section-link={true}
                    aria-pressed={c.currentTab === tab}
                    disabled={c.isLoading || !c.fontCache}
                    onClick={() => c.controller.changed((c.currentTab = tab))}
                    className={['min-h-11'].filter(Boolean).join(' ')}
                  >
                    {tab === 'Add' ? 'Add font' : 'Stored fonts'}
                  </Button>
                </React.Fragment>
              ))}
            </Dom>
            {c.error ? (
              <>
                <Dom
                  as="p"
                  role={'alert'}
                  className={['text-sm break-words text-destructive'].filter(Boolean).join(' ')}
                >
                  {c.error}
                </Dom>
              </>
            ) : null}
            {!c.cacheLoaded ? (
              <>
                <Dom
                  as="p"
                  role={'status'}
                  className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}
                >
                  {'Checking font storage…'}
                </Dom>
              </>
            ) : (
              <>
                {' '}
                {!c.fontCache ? (
                  <>
                    <Dom
                      as="p"
                      className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}
                    >
                      {'Your saved font list has not been changed.'}
                    </Dom>
                    <Button variant={'outline'} onClick={c.loadCache}>
                      {'Retry font storage'}
                    </Button>
                  </>
                ) : (
                  <>
                    {' '}
                    {c.currentTab === 'Stored' ? (
                      <>
                        {c.$userFonts$.length ? (
                          <>
                            <Dom
                              as="ul"
                              aria-label={'Stored custom fonts'}
                              className={['divide-y divide-border'].filter(Boolean).join(' ')}
                            >
                              {(c.$userFonts$ ?? []).map((userFont, _index1) => (
                                <React.Fragment key={userFont.path}>
                                  <Dom
                                    as="li"
                                    className={['flex min-w-0 flex-wrap items-center gap-3 py-3']
                                      .filter(Boolean)
                                      .join(' ')}
                                  >
                                    <Dom
                                      as="div"
                                      className={['min-w-0 flex-1 basis-40']
                                        .filter(Boolean)
                                        .join(' ')}
                                    >
                                      <Dom
                                        as="p"
                                        className={['font-medium break-words']
                                          .filter(Boolean)
                                          .join(' ')}
                                      >
                                        {userFont.name}
                                      </Dom>
                                      <Dom
                                        as="p"
                                        className={['text-xs break-words text-muted-foreground']
                                          .filter(Boolean)
                                          .join(' ')}
                                      >
                                        {userFont.fileName}
                                      </Dom>
                                      {!c.availablePaths.has(userFont.path) ? (
                                        <>
                                          <Dom
                                            as="p"
                                            className={['mt-1 text-xs text-muted-foreground']
                                              .filter(Boolean)
                                              .join(' ')}
                                          >
                                            {
                                              ' File unavailable. Remove this entry, then add the file again. '
                                            }
                                          </Dom>
                                        </>
                                      ) : null}
                                    </Dom>
                                    <Dom
                                      as="div"
                                      className={['flex flex-wrap gap-2'].filter(Boolean).join(' ')}
                                    >
                                      <Button
                                        variant={'outline'}
                                        disabled={
                                          c.isLoading || !c.availablePaths.has(userFont.path)
                                        }
                                        aria-label={`Use ${userFont.name}`}
                                        onClick={() => c.selectFont(userFont)}
                                        className={['min-h-11'].filter(Boolean).join(' ')}
                                      >
                                        {'Use font'}
                                      </Button>
                                      <Button
                                        variant={'destructive'}
                                        disabled={c.isLoading}
                                        aria-label={`Remove ${userFont.name}`}
                                        onClick={() => c.removeFont(userFont.path)}
                                        className={['min-h-11'].filter(Boolean).join(' ')}
                                      >
                                        {'Remove'}
                                      </Button>
                                    </Dom>
                                  </Dom>
                                </React.Fragment>
                              ))}
                            </Dom>
                          </>
                        ) : (
                          <>
                            {' '}
                            <Dom
                              as="p"
                              className={['rounded-2xl bg-muted p-4 text-sm text-muted-foreground']
                                .filter(Boolean)
                                .join(' ')}
                            >
                              {' No custom fonts yet. Add a font file to make it available here. '}
                            </Dom>
                          </>
                        )}
                        {c.isLoading ? (
                          <>
                            <Dom
                              as="p"
                              role={'status'}
                              className={['text-sm text-muted-foreground']
                                .filter(Boolean)
                                .join(' ')}
                            >
                              {'Updating fonts…'}
                            </Dom>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {' '}
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
                        ></SettingsUserFontAdd>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </Dom>
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
