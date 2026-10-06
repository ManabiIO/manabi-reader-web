/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import {
  Dom,
  Icon,
  Button,
  Input,
  ReaderScope,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './primitives';
import {
  createDestinationPicker,
  type DestinationPickerProps
} from './destination-picker-controller';
import { resolve } from '$app/paths';

export function DestinationPicker(props: DestinationPickerProps & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createDestinationPicker(props as DestinationPickerProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-snippets-destination-picker">
      <Dom
        scopeClass="snippet-scope-destination-picker"
        as="div"
        className={['destination-picker'].filter(Boolean).join(' ')}
      >
        <Dom scopeClass="snippet-scope-destination-picker" as="p">
          {
            ' Save the document in one connected location. Collections and reading history stay attached when it moves. '
          }
        </Dom>
        <Dom scopeClass="snippet-scope-destination-picker" as="label">
          {'Storage source '}
          <Dom
            scopeClass="snippet-scope-destination-picker"
            as="select"
            aria-label={'Storage source'}
            disabled={c.granting}
            value={c.selected ? c.identity(c.selected) : ''}
            onChange={(event) => {
              const source = c.sources.find(
                (item) => c.identity(item) === event.currentTarget.value
              );
              if (source) void c.browse(source, source.root, source.name, true);
            }}
            className={['control-select min-h-11'].filter(Boolean).join(' ')}
          >
            <Dom
              scopeClass="snippet-scope-destination-picker"
              as="option"
              value={''}
              disabled={true}
            >
              {'Choose a source'}
            </Dom>
            {(c.sources ?? []).length
              ? (c.sources ?? []).map((source, _index0) => (
                  <React.Fragment key={c.identity(source)}>
                    <Dom
                      scopeClass="snippet-scope-destination-picker"
                      as="option"
                      value={c.identity(source)}
                    >
                      {c.providerName(source.provider)}
                      {' · '}
                      {source.name}
                    </Dom>
                  </React.Fragment>
                ))
              : null}
          </Dom>
        </Dom>
        {c.selected ? (
          <>
            <Dom
              scopeClass="snippet-scope-destination-picker"
              as="nav"
              aria-label={'Destination folder'}
              elementRef={(value) => {
                c.trailNav = value;
              }}
              className={['breadcrumbs'].filter(Boolean).join(' ')}
            >
              {(c.trail ?? []).length
                ? (c.trail ?? []).map((part, index) => (
                    <React.Fragment key={part.id}>
                      <Button
                        variant={'link'}
                        size={'sm'}
                        aria-current={index === c.trail.length - 1 ? 'page' : undefined}
                        disabled={c.busy}
                        onClick={() => {
                          c.trail = c.trail.slice(0, index);
                          void c.navigate(c.selected!, part.id, part.name);
                        }}
                        className={['min-h-11 px-1'].filter(Boolean).join(' ')}
                      >
                        {part.name || 'Root'}
                      </Button>
                      {index < c.trail.length - 1 ? (
                        <>
                          <Dom
                            scopeClass="snippet-scope-destination-picker"
                            as="span"
                            aria-hidden={'true'}
                          >
                            {'›'}
                          </Dom>
                        </>
                      ) : null}
                    </React.Fragment>
                  ))
                : null}
            </Dom>
            <Dom
              scopeClass="snippet-scope-destination-picker"
              as="div"
              aria-busy={c.busy}
              className={['folder-list'].filter(Boolean).join(' ')}
            >
              {(c.entries ?? []).length ? (
                (c.entries ?? []).map((folder, _index1) => (
                  <React.Fragment key={folder.id}>
                    <Button
                      variant={'ghost'}
                      shape={'rounded'}
                      disabled={c.busy}
                      onClick={() => c.navigate(c.selected!, folder.id, folder.name)}
                      className={['min-h-11 w-full justify-start px-3 text-left']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <Icon
                        name="FolderOpen"
                        aria-hidden={'true'}
                        className={['size-4 shrink-0'].filter(Boolean).join(' ')}
                      ></Icon>
                      <Dom
                        scopeClass="snippet-scope-destination-picker"
                        as="span"
                        className={['min-w-0 break-words'].filter(Boolean).join(' ')}
                      >
                        {folder.name}
                      </Dom>
                    </Button>
                  </React.Fragment>
                ))
              ) : (
                <>
                  {' '}
                  <Dom scopeClass="snippet-scope-destination-picker" as="p">
                    {c.busy
                      ? 'Loading folders…'
                      : c.ready
                        ? 'No subfolders.'
                        : 'This folder could not be loaded.'}
                  </Dom>
                </>
              )}
            </Dom>
            {c.selected.provider === 'local' ? (
              <>
                <Dom scopeClass="snippet-scope-destination-picker" as="p">
                  {
                    ' Close other applications editing these files before saving. This browser cannot lock out external file editors. '
                  }
                </Dom>
              </>
            ) : null}
            {c.capabilities?.write && c.ready ? (
              <>
                <Dom
                  scopeClass="snippet-scope-destination-picker"
                  as="form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void c.mkdir();
                  }}
                >
                  <Input
                    aria-label={'New folder name'}
                    placeholder={'New folder name'}
                    value={c.newName}
                    maxLength={100}
                    className={['min-h-11'].filter(Boolean).join(' ')}
                    bindings={{
                      value: (value) => {
                        c.newName = value;
                      }
                    }}
                  ></Input>
                  <Button
                    type={'submit'}
                    variant={'secondary'}
                    disabled={c.busy || !c.newName.trim()}
                  >
                    {'Create folder'}
                  </Button>
                </Dom>
                <Dom
                  scopeClass="snippet-scope-destination-picker"
                  as="label"
                  className={['remember'].filter(Boolean).join(' ')}
                >
                  <Dom
                    scopeClass="snippet-scope-destination-picker"
                    as="input"
                    type={'checkbox'}
                    checked={c.remember}
                    className={['size-5 accent-primary'].filter(Boolean).join(' ')}
                    bindings={{
                      checked: (value) => {
                        c.remember = value;
                      }
                    }}
                  />
                  {' Use this location for new snippets'}
                </Dom>
                <Button disabled={c.busy} onClick={c.useFolder}>
                  {'Use this folder'}
                </Button>
              </>
            ) : (
              <>
                {' '}
                {c.capabilities && !c.capabilities.write ? (
                  <>
                    <Dom scopeClass="snippet-scope-destination-picker" as="p">
                      {c.capabilities.reason ||
                        'This source is read-only. Authorize document editing to save here.'}
                    </Dom>
                    {c.selected.provider !== 'webdav' &&
                    !c.capabilities.reason &&
                    !c.permissionRequired ? (
                      <>
                        <Button disabled={c.busy} onClick={c.grant}>
                          {'Allow document editing'}
                        </Button>
                      </>
                    ) : null}
                    {c.selected.provider === 'google' ? (
                      <>
                        <Dom scopeClass="snippet-scope-destination-picker" as="p">
                          {
                            ' Google will request access to files in your Drive so Manabi can edit documents inside your selected library folders. '
                          }
                        </Dom>
                      </>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </>
        ) : null}
        {c.permissionRequired ? (
          <>
            <Button disabled={c.busy} onClick={c.grant}>
              {'Allow folder access'}
            </Button>
          </>
        ) : null}
        {c.error && c.selected && !c.permissionRequired ? (
          <>
            <Button
              variant={'secondary'}
              disabled={c.busy}
              onClick={() => c.browse(c.selected!, c.parent, c.trail.at(-1)?.name, true)}
            >
              {' Retry folder '}
            </Button>
          </>
        ) : null}
        {c.allowDevice ? (
          <>
            <Button variant={'ghost'} onClick={() => c.choose(undefined, false)}>
              {'Keep on this device only'}
            </Button>
          </>
        ) : null}
        {c.allowUnsetDefault ? (
          <>
            <Button variant={'ghost'} onClick={() => c.choose(undefined, false)}>
              {'Clear default location'}
            </Button>
          </>
        ) : null}
        <Button
          href={resolve('/connections')}
          variant={'link'}
          size={'sm'}
          className={['min-h-11 justify-start px-0'].filter(Boolean).join(' ')}
        >
          {'Manage connected libraries'}
        </Button>
        {c.error ? (
          <>
            <Dom scopeClass="snippet-scope-destination-picker" as="p" role={'alert'}>
              {c.error}
            </Dom>
          </>
        ) : null}
      </Dom>
    </ReaderScope>
  );
}
