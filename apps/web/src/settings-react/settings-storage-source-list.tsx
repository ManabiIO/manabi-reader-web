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
  Popover,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import {
  createSettingsStorageSourceList,
  type SettingsStorageSourceListProps
} from './settings-storage-source-list-controller';

import { isAppDefault, setStorageSourceDefault } from '$lib/data/storage/storage-source-manager';

import { getStorageIconData } from '$lib/data/storage/storage-view';
import { syncTarget$ } from '$lib/data/store';
import { AutoReplicationType } from '$lib/functions/replication/replication-options';

const faCircleQuestion = 'faCircleQuestion';
const faCloudArrowUp = 'faCloudArrowUp';
const faPenToSquare = 'faPenToSquare';
const faPlus = 'faPlus';
const faSpinner = 'faSpinner';
const faTableList = 'faTableList';
const faTrash = 'faTrash';
const faTriangleExclamation = 'faTriangleExclamation';
export function SettingsStorageSourceList(
  props: Partial<SettingsStorageSourceListProps> &
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
      createSettingsStorageSourceList(
        props as SettingsStorageSourceListProps,
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
      <div className="react-settings-settings-storage-source-list" style={{ display: 'contents' }}>
        <Dom
          as="div"
          className={['mb-8 min-w-0 sm:col-span-2 lg:col-span-3'].filter(Boolean).join(' ')}
        >
          <Dom
            as="div"
            className={['flex flex-wrap items-center justify-between gap-2']
              .filter(Boolean)
              .join(' ')}
          >
            <Dom as="div" className={['flex min-w-0 items-center gap-1'].filter(Boolean).join(' ')}>
              <Popover contentText={c.listTooltip} contentStyles={'padding: 0.5rem;'}>
                <AppIcon
                  icon={faCircleQuestion}
                  slot={'icon'}
                  className={['mx-1'].filter(Boolean).join(' ')}
                ></AppIcon>
              </Popover>
              {c.$autoReplication$ !== AutoReplicationType.Off && !c.$syncTarget$ ? (
                <>
                  <Popover
                    contentText={
                      'Auto import/export enabled but no source as sync target from list selected'
                    }
                    contentStyles={'padding: 0.25rem;'}
                  >
                    <AppIcon
                      icon={faTriangleExclamation}
                      slot={'icon'}
                      className={['mx-1'].filter(Boolean).join(' ')}
                    ></AppIcon>
                  </Popover>
                </>
              ) : null}
            </Dom>
            <Button
              variant={'outline'}
              disabled={!c.storageSources}
              onClick={() => {
                c.modifyStorageSource();
              }}
            >
              <AppIcon icon={faPlus}></AppIcon>
              <Dom as="span">{'Add source'}</Dom>
            </Button>
          </Dom>
          <Dom as="div" className={['mt-6'].filter(Boolean).join(' ')}>
            {!c.listLoading && c.storageSources ? (
              <>
                <Dom
                  as="div"
                  className={['grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {(c.storageSources ?? []).map((storageSource, _index0) => (
                    <React.Fragment key={storageSource.name}>
                      {(() => {
                        const icon = getStorageIconData(storageSource.type);
                        const isDefault = isAppDefault(storageSource.name);
                        const storageSourceIsSyncTarget = c.isSyncTarget(
                          storageSource.name,
                          c.$syncTarget$
                        );
                        const storageSourceIsSourceDefault = c.isStorageSourceDefault(
                          storageSource.name,
                          storageSource.type,
                          [c.$gDriveStorageSource$, c.$oneDriveStorageSource$, c.$fsStorageSource$]
                        );
                        return (
                          <>
                            <Dom
                              as="article"
                              className={['grid min-w-0 gap-3 rounded-xl border border-border p-3']
                                .filter(Boolean)
                                .join(' ')}
                            >
                              <Dom
                                as="div"
                                className={['flex min-w-0 items-center gap-3']
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                <Dom
                                  as="svg"
                                  xmlns={'http://www.w3.org/2000/svg'}
                                  viewBox={icon.viewBox}
                                  aria-hidden={'true'}
                                  className={['inline-block size-6 shrink-0 self-center']
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  <Dom
                                    as="path"
                                    d={icon.d}
                                    className={['fill-current'].filter(Boolean).join(' ')}
                                  ></Dom>
                                </Dom>
                                <Dom
                                  as="div"
                                  className={['min-w-0 font-medium break-words']
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  {storageSource.name}
                                </Dom>
                              </Dom>
                              <Dom
                                as="div"
                                className={['flex flex-wrap gap-2'].filter(Boolean).join(' ')}
                              >
                                {!isDefault ? (
                                  <>
                                    <Button
                                      variant={'ghost'}
                                      size={'sm'}
                                      onClick={() => c.modifyStorageSource(storageSource)}
                                    >
                                      <AppIcon icon={faPenToSquare}></AppIcon>
                                      <Dom as="span">{'Edit'}</Dom>
                                    </Button>
                                  </>
                                ) : null}
                                <Button
                                  variant={storageSourceIsSyncTarget ? 'secondary' : 'ghost'}
                                  size={'sm'}
                                  aria-pressed={storageSourceIsSyncTarget}
                                  onClick={() =>
                                    syncTarget$.next(
                                      c.$syncTarget$ === storageSource.name
                                        ? ''
                                        : storageSource.name
                                    )
                                  }
                                >
                                  <AppIcon icon={faCloudArrowUp}></AppIcon>
                                  <Dom as="span">{'Sync target'}</Dom>
                                </Button>
                                <Button
                                  variant={storageSourceIsSourceDefault ? 'secondary' : 'ghost'}
                                  size={'sm'}
                                  aria-pressed={storageSourceIsSourceDefault}
                                  onClick={() =>
                                    setStorageSourceDefault(
                                      storageSourceIsSourceDefault ? '' : storageSource.name,
                                      storageSource.type
                                    )
                                  }
                                >
                                  <AppIcon icon={faTableList}></AppIcon>
                                  <Dom as="span">{'Use by default'}</Dom>
                                </Button>
                                {!isDefault ? (
                                  <>
                                    <Button
                                      variant={'destructive'}
                                      size={'sm'}
                                      onClick={() =>
                                        c.deleteStorageSource(
                                          storageSource,
                                          storageSourceIsSyncTarget,
                                          storageSourceIsSourceDefault
                                        )
                                      }
                                    >
                                      <AppIcon icon={faTrash}></AppIcon>
                                      <Dom as="span">{'Remove'}</Dom>
                                    </Button>
                                  </>
                                ) : null}
                              </Dom>
                            </Dom>
                          </>
                        );
                      })()}
                    </React.Fragment>
                  ))}
                </Dom>
              </>
            ) : (
              <>
                {' '}
                <Dom
                  as="div"
                  role={'status'}
                  aria-label={'Loading storage sources'}
                  className={['text-xl'].filter(Boolean).join(' ')}
                >
                  <AppIcon icon={faSpinner} spin={true}></AppIcon>
                </Dom>
              </>
            )}
          </Dom>
        </Dom>
      </div>
    </SettingsContext.Provider>
  );
}
