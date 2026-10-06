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
  Input,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createDavConnections, type DavConnectionsProps } from './dav-connections-controller';

import { davSource, davSources, disconnectDav } from '../lib/webdav/source';
export function DavConnections(
  props: Partial<DavConnectionsProps> &
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
      createDavConnections(
        props as DavConnectionsProps,
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
      <div className="react-settings-dav-connections" style={{ display: 'contents' }}>
        <Dom
          as="section"
          aria-labelledby={'webdav-heading'}
          className={['dav-settings'].filter(Boolean).join(' ')}
        >
          <Dom as="h2" id={'webdav-heading'}>
            {'WebDAV'}
          </Dom>
          <Dom as="p">
            {
              'Connect directly to your HTTPS WebDAV folder. No Manabi account or proxy is required.'
            }
          </Dom>
          <Dom as="p" className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}>
            {
              ' The server must allow this reader’s origin through CORS, including PROPFIND, GET, MKCOL and PUT, and expose a strong ETag header for reading-data sync. A successful read test does not verify write permission. '
            }
          </Dom>
          <Dom as="div" className={['flex flex-wrap gap-2'].filter(Boolean).join(' ')}>
            <Button variant={'secondary'} disabled={!c.mounted || c.busy} onClick={() => c.edit()}>
              {'Add WebDAV folder'}
            </Button>
            <Button
              variant={'ghost'}
              disabled={!c.mounted || c.busy}
              onClick={() =>
                c.run(async () => {
                  const latest = await davSources();
                  if (!c.mounted) return;
                  c.operationController?.abort();
                  c.controller.changed((c.sources = latest));
                  c.controller.changed((c.editing = null));
                  c.controller.changed((c.expectedConfiguration = null));
                  c.controller.changed((c.password = ''));
                })
              }
            >
              {'Reload WebDAV connections'}
            </Button>
          </Dom>
          {c.message ? (
            <>
              <Dom as="p" role={'status'}>
                {c.message}
              </Dom>
            </>
          ) : null}
          {c.editing ? (
            <>
              <Dom
                as="form"
                aria-label={'WebDAV connection'}
                onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  void c.run(c.save);
                }}
              >
                <Dom as="label">
                  {'Name'}
                  <Input
                    required={true}
                    maxLength={240}
                    value={c.name}
                    disabled={c.busy}
                    bindings={{
                      value: (value: typeof c.name) => {
                        c.controller.changed((c.name = value));
                      }
                    }}
                  ></Input>
                </Dom>
                <Dom as="label">
                  {'WebDAV folder URL'}
                  <Input
                    required={true}
                    type={'url'}
                    value={c.url}
                    disabled={c.busy || c.existing}
                    placeholder={'https://cloud.example/remote.php/dav/files/name/Books/'}
                    bindings={{
                      value: (value: typeof c.url) => {
                        c.controller.changed((c.url = value));
                      }
                    }}
                  ></Input>
                </Dom>
                <Dom as="label">
                  {'Username'}
                  <Input
                    autoComplete={'username'}
                    value={c.username}
                    disabled={c.busy || c.existing}
                    bindings={{
                      value: (value: typeof c.username) => {
                        c.controller.changed((c.username = value));
                      }
                    }}
                  ></Input>
                </Dom>
                {c.existing ? (
                  <>
                    <Dom
                      as="p"
                      className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}
                    >
                      {
                        ' Folder and username identify this connection. Add a new connection to change either; importing the same book can reuse its existing local copy and reading history. '
                      }
                    </Dom>
                  </>
                ) : null}
                <Dom as="label">
                  {'Password or app password'}
                  <Input
                    type={'password'}
                    autoComplete={'current-password'}
                    value={c.password}
                    disabled={c.busy}
                    bindings={{
                      value: (value: typeof c.password) => {
                        c.controller.changed((c.password = value));
                      }
                    }}
                  ></Input>
                </Dom>
                <Dom as="label" className={['choice'].filter(Boolean).join(' ')}>
                  <Dom
                    as="input"
                    type={'checkbox'}
                    checked={c.remember}
                    disabled={c.busy}
                    bindings={{
                      checked: (value: typeof c.remember) => {
                        c.controller.changed((c.remember = value));
                      }
                    }}
                  />
                  {' Remember password on this device'}
                </Dom>
                <Dom as="p" className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}>
                  {
                    ' Otherwise the password is kept only for this tab. A remembered password is stored in this site’s browser database, not encrypted with a separate key. Use a limited app password. Credentials are not exported or sent to Manabi. '
                  }
                </Dom>
                <Dom as="label" className={['choice'].filter(Boolean).join(' ')}>
                  <Dom
                    as="input"
                    type={'checkbox'}
                    checked={c.writable}
                    disabled={c.busy}
                    bindings={{
                      checked: (value: typeof c.writable) => {
                        c.controller.changed((c.writable = value));
                      }
                    }}
                  />
                  {' Allow reading-data write-back in .manabi-reader'}
                </Dom>
                <Dom as="p" className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}>
                  {
                    ' Original books are never modified. Enabling permission does not start sync; enable it for individual books below. '
                  }
                </Dom>
                <Dom as="div" className={['flex flex-wrap gap-2'].filter(Boolean).join(' ')}>
                  <Button type={'submit'} disabled={c.busy}>
                    {'Test and save WebDAV'}
                  </Button>
                  <Button
                    type={'button'}
                    variant={'ghost'}
                    onClick={() => {
                      c.operationController?.abort();
                      c.controller.changed((c.editing = null));
                      c.controller.changed((c.password = ''));
                    }}
                  >
                    {'Cancel'}
                  </Button>
                </Dom>
              </Dom>
            </>
          ) : null}
          {(c.sources ?? []).map((item, _index0) => (
            <React.Fragment key={item.id}>
              <Dom as="article" aria-label={`WebDAV ${item.name}`}>
                <Dom as="h3">{item.name}</Dom>
                <Dom as="p" className={['text-sm break-all'].filter(Boolean).join(' ')}>
                  {item.url}
                </Dom>
                <Dom as="div" className={['flex flex-wrap gap-2'].filter(Boolean).join(' ')}>
                  <Button
                    variant={'secondary'}
                    disabled={c.busy}
                    onClick={() => c.run(async () => c.onbrowse(await davSource(item.id)))}
                  >
                    {'Browse '}
                    {item.name}
                  </Button>
                  <Button variant={'outline'} disabled={c.busy} onClick={() => c.edit(item)}>
                    {'Unlock or edit '}
                    {item.name}
                  </Button>
                  <Button
                    variant={'destructive'}
                    disabled={c.busy}
                    onClick={() =>
                      c.run(async () => {
                        await disconnectDav(item.id);
                        await c.onchange(item.id);
                        c.controller.changed((c.sources = await davSources()));
                      })
                    }
                  >
                    {'Disconnect '}
                    {item.name}
                  </Button>
                </Dom>
              </Dom>
            </React.Fragment>
          ))}
        </Dom>
      </div>
    </SettingsContext.Provider>
  );
}
