/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import {
  Dom,
  AppIcon,
  Button,
  Input,
  DialogTemplate,
  useLatest,
  useReaderBindings,
  Slot,
  type ReaderViewProps
} from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import {
  createSettingsStorageSource,
  type SettingsStorageSourceProps
} from './settings-storage-source-controller';

import { StorageKey } from '$lib/data/storage/storage-types';

const faTriangleExclamation = 'faTriangleExclamation';
export function SettingsStorageSource(
  props: Partial<SettingsStorageSourceProps> &
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
      createSettingsStorageSource(
        props as SettingsStorageSourceProps,
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
      <div className="react-settings-settings-storage-source" style={{ display: 'contents' }}>
        <DialogTemplate>
          <Slot name="header">
            {c.configuredName ? 'Edit storage source' : 'Add storage source'}
          </Slot>

          <Dom
            as="form"
            id={'storage-source-form'}
            slot={'content'}
            elementRef={(value: typeof c.containerElm) => {
              c.controller.changed((c.containerElm = value));
            }}
            aria-busy={c.saving || c.selectingDirectory}
            className={['min-w-0'].filter(Boolean).join(' ')}
            events={{
              submit: (event: Event & { currentTarget: HTMLFormElement }) => {
                event.preventDefault();
                Reflect.apply(c.save, undefined, [event]);
              },
              input: c.resetCustomValidity,
              keydown: (event: KeyboardEvent & { currentTarget: HTMLFormElement }) => {
                if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229))
                  event.preventDefault();
              }
            }}
          >
            <Dom
              as="fieldset"
              disabled={c.saving || c.selectingDirectory}
              className={['grid min-w-0 gap-4 border-0 p-0'].filter(Boolean).join(' ')}
            >
              <Dom as="p" className={['text-sm'].filter(Boolean).join(' ')}>
                {' Advanced Ttu Ebook Reader storage. These sources use '}
                <Dom as="code">{'ttu-reader-data'}</Dom>
                {' and its book, bookmark and statistics format. For ordinary Manabi folders, use '}
                <Dom as="strong">{'Accounts and libraries'}</Dom>
                {'. '}
              </Dom>
              <Dom
                as="label"
                className={['grid gap-2 text-sm font-medium'].filter(Boolean).join(' ')}
              >
                <Dom as="span">{'Name'}</Dom>
                <Input
                  required={true}
                  type={'text'}
                  placeholder={'Name'}
                  value={c.storageSourceName}
                  ref={c.nameElm}
                  bindings={{
                    value: (value: typeof c.storageSourceName) => {
                      c.controller.changed((c.storageSourceName = value));
                    },
                    ref: (value: typeof c.nameElm) => {
                      c.controller.changed((c.nameElm = value));
                    }
                  }}
                ></Input>
              </Dom>
              <Dom
                as="div"
                className={['flex flex-wrap gap-x-5 gap-y-3'].filter(Boolean).join(' ')}
              >
                <Dom
                  as="label"
                  className={['flex min-h-11 items-center gap-2 text-sm'].filter(Boolean).join(' ')}
                >
                  <Dom
                    as="input"
                    id={'cbx-source'}
                    type={'checkbox'}
                    checked={c.storageSourceIsSyncTarget}
                    className={['size-5 shrink-0 accent-primary'].filter(Boolean).join(' ')}
                    bindings={{
                      checked: (value: typeof c.storageSourceIsSyncTarget) => {
                        c.controller.changed((c.storageSourceIsSyncTarget = value));
                      }
                    }}
                  />
                  <Dom as="span">{'Is Sync Target'}</Dom>
                </Dom>
                <Dom
                  as="label"
                  className={['flex min-h-11 items-center gap-2 text-sm'].filter(Boolean).join(' ')}
                >
                  <Dom
                    as="input"
                    id={'cbx-manager'}
                    type={'checkbox'}
                    checked={c.storageSourceIsSourceDefault}
                    className={['size-5 shrink-0 accent-primary'].filter(Boolean).join(' ')}
                    bindings={{
                      checked: (value: typeof c.storageSourceIsSourceDefault) => {
                        c.controller.changed((c.storageSourceIsSourceDefault = value));
                      }
                    }}
                  />
                  <Dom as="span">{'Is Source Default'}</Dom>
                </Dom>
              </Dom>
              <Dom
                as="label"
                className={['grid gap-2 text-sm font-medium'].filter(Boolean).join(' ')}
              >
                <Dom as="span">{'Storage type'}</Dom>
                <Dom
                  as="select"
                  value={c.storageSourceType}
                  className={[
                    'min-h-11 min-w-0 rounded-[10px] border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm'
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  events={{
                    change: () => {
                      if (c.storageSourceType === StorageKey.FS) {
                        c.controller.changed((c.storageSourceClientId = ''));
                        c.controller.changed((c.storageSourceClientSecret = ''));
                        c.controller.changed((c.storageSourceStoredInManager = false));
                        c.controller.changed((c.storageSourceEncryptionDisabled = false));
                      } else {
                        c.controller.changed((c.directoryHandle = undefined));
                        c.controller.changed((c.handleFsPath = ''));
                      }
                    }
                  }}
                  bindings={{
                    value: (value: typeof c.storageSourceType) => {
                      c.controller.changed((c.storageSourceType = value));
                    }
                  }}
                >
                  {(c.storageSourceTypes ?? []).map((sourceType, _index0) => (
                    <React.Fragment key={sourceType.key}>
                      <Dom as="option" value={sourceType.key}>
                        {sourceType.label}
                      </Dom>
                    </React.Fragment>
                  ))}
                </Dom>
              </Dom>
              {c.storageSourceType === StorageKey.FS ? (
                <>
                  <Button variant={'outline'} onClick={c.selectDirectory}>
                    {'Select Directory'}
                  </Button>
                  <Dom
                    as="div"
                    className={['text-center text-sm text-muted-foreground']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {c.handleFsPath || 'Nothing selected'}
                  </Dom>
                </>
              ) : (
                <>
                  {' '}
                  <Dom
                    as="label"
                    className={['grid gap-2 text-sm font-medium'].filter(Boolean).join(' ')}
                  >
                    <Dom as="span">{'Client ID'}</Dom>
                    <Input
                      required={true}
                      type={'text'}
                      value={c.storageSourceClientId}
                      bindings={{
                        value: (value: typeof c.storageSourceClientId) => {
                          c.controller.changed((c.storageSourceClientId = value));
                        }
                      }}
                    ></Input>
                  </Dom>
                  <Dom
                    as="label"
                    className={['grid gap-2 text-sm font-medium'].filter(Boolean).join(' ')}
                  >
                    <Dom as="span">{'Client Secret'}</Dom>
                    <Input
                      type={'text'}
                      value={c.storageSourceClientSecret}
                      bindings={{
                        value: (value: typeof c.storageSourceClientSecret) => {
                          c.controller.changed((c.storageSourceClientSecret = value));
                        }
                      }}
                    ></Input>
                  </Dom>
                  <Dom
                    as="label"
                    className={['grid gap-2 text-sm font-medium'].filter(Boolean).join(' ')}
                  >
                    <Dom as="span">{'Password'}</Dom>
                    <Input
                      type={'password'}
                      required={!c.storageSourceEncryptionDisabled}
                      disabled={c.storageSourceEncryptionDisabled}
                      value={c.password}
                      bindings={{
                        value: (value: typeof c.password) => {
                          c.controller.changed((c.password = value));
                        }
                      }}
                    ></Input>
                  </Dom>
                  <Dom
                    as="label"
                    className={['grid gap-2 text-sm font-medium'].filter(Boolean).join(' ')}
                  >
                    <Dom as="span">{'Confirm Password'}</Dom>
                    <Input
                      type={'password'}
                      required={!c.storageSourceEncryptionDisabled}
                      disabled={c.storageSourceEncryptionDisabled}
                      value={c.confirmedPassword}
                      ref={c.pwConfirmElm}
                      bindings={{
                        value: (value: typeof c.confirmedPassword) => {
                          c.controller.changed((c.confirmedPassword = value));
                        },
                        ref: (value: typeof c.pwConfirmElm) => {
                          c.controller.changed((c.pwConfirmElm = value));
                        }
                      }}
                    ></Input>
                  </Dom>
                  {c.passwordManagerAvailable ? (
                    <>
                      <Dom
                        as="label"
                        className={['flex min-h-11 items-center gap-2 text-sm']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <Dom
                          as="input"
                          id={'cbx-store-in-manager'}
                          type={'checkbox'}
                          checked={c.storageSourceStoredInManager}
                          className={['size-5 shrink-0 accent-primary'].filter(Boolean).join(' ')}
                          events={{
                            change: () => {
                              if (
                                c.storageSourceStoredInManager &&
                                c.storageSourceEncryptionDisabled
                              ) {
                                c.controller.changed((c.storageSourceEncryptionDisabled = false));
                              }
                            }
                          }}
                          bindings={{
                            checked: (value: typeof c.storageSourceStoredInManager) => {
                              c.controller.changed((c.storageSourceStoredInManager = value));
                            }
                          }}
                        />
                        <Dom as="span">{'Store in Password Manager'}</Dom>
                      </Dom>
                    </>
                  ) : null}
                  <Dom
                    as="label"
                    className={['flex min-h-11 items-center gap-2 text-sm']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <Dom
                      as="input"
                      id={'cbx-disable-encryption'}
                      type={'checkbox'}
                      checked={c.storageSourceEncryptionDisabled}
                      className={['size-5 shrink-0 accent-primary'].filter(Boolean).join(' ')}
                      events={{
                        change: () => {
                          if (c.storageSourceEncryptionDisabled) {
                            c.controller.changed((c.storageSourceStoredInManager = false));
                            c.controller.changed((c.password = ''));
                            c.controller.changed((c.confirmedPassword = ''));
                          }
                        }
                      }}
                      bindings={{
                        checked: (value: typeof c.storageSourceEncryptionDisabled) => {
                          c.controller.changed((c.storageSourceEncryptionDisabled = value));
                        }
                      }}
                    />
                    <Dom as="span">{'Disable Password Encryption'}</Dom>
                  </Dom>
                </>
              )}
              {c.storageSourceStoredInManager || c.storageSourceEncryptionDisabled ? (
                <>
                  <Dom
                    as="div"
                    className={['flex max-w-sm items-start gap-2 rounded-xl bg-muted p-3 text-sm']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <AppIcon
                      icon={faTriangleExclamation}
                      className={['mt-0.5 shrink-0'].filter(Boolean).join(' ')}
                    ></AppIcon>
                    <Dom as="span">
                      {' Make sure to understand the '}
                      <Dom
                        as="a"
                        href={
                          'https://github.com/ManabiIO/Manabi-Reader-Web?tab=readme-ov-file#security-considerations'
                        }
                        target={'_blank'}
                        rel={'noopener noreferrer'}
                        className={['text-primary underline underline-offset-2']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {' implications '}
                      </Dom>
                      {' of these settings. '}
                    </Dom>
                  </Dom>
                </>
              ) : null}
            </Dom>
            {c.error ? (
              <>
                <Dom
                  as="div"
                  role={'alert'}
                  className={['mt-4 text-sm text-destructive'].filter(Boolean).join(' ')}
                >
                  {'Error: '}
                  {c.error}
                </Dom>
              </>
            ) : null}
          </Dom>
          <Dom
            as="div"
            slot={'footer'}
            className={['mt-4 flex grow flex-wrap justify-between gap-2'].filter(Boolean).join(' ')}
          >
            <Button
              variant={'ghost'}
              disabled={c.saving || c.selectingDirectory}
              onClick={() => c.closeDialog()}
            >
              {'Cancel'}
            </Button>
            <Button
              variant={'default'}
              type={'submit'}
              form={'storage-source-form'}
              disabled={c.saving || c.selectingDirectory}
            >
              {c.saving ? 'Saving…' : 'Save'}
            </Button>
          </Dom>
        </DialogTemplate>
      </div>
    </SettingsContext.Provider>
  );
}
